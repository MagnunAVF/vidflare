import { createUploadInput, cursorQuery, updateVideoInput, videoIdParam } from '@vidflare/shared'
import { and, eq, sql } from 'drizzle-orm'
import { type Context, Hono } from 'hono'

import { getDb } from '../db/client'
import { channels, likes, videos } from '../db/schema'
import { cached, cacheKeys, purgeCache, videoCacheKeys } from '../lib/cache'
import { ApiError } from '../lib/errors'
import { publicVideoPage } from '../lib/feed'
import { channelStorage } from '../lib/storage'
import { subscribedBy } from '../lib/subscriptions'
import { telemetry } from '../lib/telemetry'
import { uuidv7 } from '../lib/id'
import { byUser, rateLimit } from '../middleware/rate-limit'
import { requireUser } from '../middleware/session'
import { validate } from '../middleware/validate'
import { createDirectUpload, deleteVideo, streamConfig, streamPlayerUrl } from '../services/stream'
import { verifyTurnstile } from '../services/turnstile'
import type { AppEnv } from '../types'

export const videoRoutes = new Hono<AppEnv>()
  // Home feed: the latest public, ready videos, newest first. Keyset pagination on
  // (published_at, id), served by videos_home_feed_idx; never OFFSET.
  .get('/', validate('query', cursorQuery), async (c) => {
    const { cursor } = c.req.valid('query')
    const db = getDb(c.env.DB)
    // Only the first page is cached: it's the one everybody opens, and a single key keeps the
    // purge on writes to one delete. Later pages read D1.
    const page =
      cursor === undefined
        ? await cached(c, cacheKeys.homeFeed(), () => publicVideoPage(db, undefined))
        : await publicVideoPage(db, cursor)
    return c.json(page, 200)
  })
  .post(
    '/uploads',
    requireUser,
    rateLimit('UPLOAD_LIMITER', byUser),
    validate('json', createUploadInput),
    async (c) => {
      const input = c.req.valid('json')

      // The creator's storage budget, before Turnstile and Stream. The upload may be at most
      // what's left (and never over UPLOAD_MAX_DURATION_S): Stream enforces it as
      // maxDurationSeconds and fails a longer video. Checked, not reserved: two uploads started
      // at once can each see the same room, which the upload rate limit keeps small.
      const storage = await channelStorage(getDb(c.env.DB), c.var.user.channel.id)
      if (storage.maxUploadS === 0) throw new ApiError(403, 'storage_quota_exceeded')

      const human = await verifyTurnstile(
        c.env.TURNSTILE_SECRET,
        input.turnstileToken,
        c.req.header('CF-Connecting-IP'),
      )
      if (!human) throw new ApiError(403, 'turnstile_failed')

      // The id exists before the Stream video so the upload can carry it in meta.videoId, and
      // the row is written once, already linked to its stream_uid. meta.env lets production's
      // webhook handler route Stream's events back to this environment.
      const now = Date.now()
      const videoId = uuidv7(now)
      const stream = streamConfig(c.env)
      // Its own span: the Stream API call is the slow, external part of starting an upload.
      const upload = await telemetry.startSpan(
        {
          name: 'stream.create_upload',
          op: 'http.client',
          attributes: {
            'video.id': videoId,
            'upload.size_bytes': input.sizeBytes,
            'upload.max_duration_s': storage.maxUploadS,
          },
        },
        () =>
          createDirectUpload(stream, {
            sizeBytes: input.sizeBytes,
            maxDurationSeconds: storage.maxUploadS,
            meta: { env: c.env.ENVIRONMENT, videoId },
          }),
      )

      try {
        await getDb(c.env.DB).insert(videos).values({
          id: videoId,
          channelId: c.var.user.channel.id,
          streamUid: upload.uid,
          title: input.title,
          description: input.description,
          visibility: input.visibility,
          status: 'uploading',
          createdAt: now,
        })
      } catch (err) {
        // No row means nobody will ever use or clean up this Stream video: remove it now.
        await deleteVideo(stream, upload.uid).catch(() => {})
        throw err
      }

      telemetry.count('upload.started')
      return c.json({ videoId, uploadUrl: upload.uploadUrl }, 201)
    },
  )
  // The browser finished sending the bytes: uploading → processing. Only from `uploading`, so
  // a webhook that already set `ready` or `error` is never overwritten. Owner check in SQL.
  // Repeat calls are harmless and return the current status.
  .post('/:id/uploaded', requireUser, validate('param', videoIdParam), async (c) => {
    const { id } = c.req.valid('param')
    const db = getDb(c.env.DB)
    const owned = and(eq(videos.id, id), eq(videos.channelId, c.var.user.channel.id))

    const moved = await db
      .update(videos)
      .set({ status: 'processing' })
      .where(and(owned, eq(videos.status, 'uploading')))
      .returning({ id: videos.id, status: videos.status })
      .get()
    if (moved) return c.json(moved, 200)

    const current = await db
      .select({ id: videos.id, status: videos.status })
      .from(videos)
      .where(owned)
      .get()
    // Someone else's video answers like a missing one.
    if (!current) throw new ApiError(404, 'not_found')
    return c.json(current, 200)
  })
  // The upload page polls this until `ready` or `error`. Owner only: a video that isn't ready
  // (or is unlisted) must not be discoverable by id through this route.
  .get('/:id/status', requireUser, validate('param', videoIdParam), async (c) => {
    const { id } = c.req.valid('param')
    const video = await getDb(c.env.DB)
      .select({ id: videos.id, status: videos.status })
      .from(videos)
      .where(and(eq(videos.id, id), eq(videos.channelId, c.var.user.channel.id)))
      .get()
    if (!video) throw new ApiError(404, 'not_found')
    return c.json(video, 200)
  })
  // Watch page data: the video, its channel and counters. A ready video (public or unlisted)
  // is visible to anyone with the link; one that isn't ready yet only to its owner.
  // Signed-out visitors all get the same response, so theirs comes from KV (a video that
  // isn't ready is a 404 for them, which is never cached).
  .get('/:id', validate('param', videoIdParam), async (c) => {
    const { id } = c.req.valid('param')
    const load = () => videoDetail(c, id)
    const video = c.var.user ? await load() : await cached(c, cacheKeys.video(id), load)
    return c.json(video, 200)
  })
  // Edit title, description or visibility. Owner check in the SQL WHERE: someone else's video
  // updates nothing and answers 404, like a missing one.
  .patch(
    '/:id',
    requireUser,
    validate('param', videoIdParam),
    validate('json', updateVideoInput),
    async (c) => {
      const { id } = c.req.valid('param')
      const updated = await getDb(c.env.DB)
        .update(videos)
        .set(c.req.valid('json'))
        .where(and(eq(videos.id, id), eq(videos.channelId, c.var.user.channel.id)))
        .returning({
          id: videos.id,
          title: videos.title,
          description: videos.description,
          visibility: videos.visibility,
          status: videos.status,
        })
        .get()
      if (!updated) throw new ApiError(404, 'not_found')
      await purgeCache(c.env.CACHE, videoCacheKeys(id, c.var.user.channel.handle))
      return c.json(updated, 200)
    },
  )
  // Delete in Stream, then in D1 (likes and comments cascade). Stream first: if it fails,
  // nothing is deleted and the request can be retried; the other order could leave a Stream
  // video nobody owns. Owner-scoped in SQL.
  .delete('/:id', requireUser, validate('param', videoIdParam), async (c) => {
    const { id } = c.req.valid('param')
    const db = getDb(c.env.DB)
    const owned = and(eq(videos.id, id), eq(videos.channelId, c.var.user.channel.id))
    const video = await db.select({ streamUid: videos.streamUid }).from(videos).where(owned).get()
    if (!video) throw new ApiError(404, 'not_found')

    // Already gone in Stream counts as deleted.
    if (video.streamUid) await deleteVideo(streamConfig(c.env), video.streamUid)
    await db.delete(videos).where(owned)
    await purgeCache(c.env.CACHE, videoCacheKeys(id, c.var.user.channel.handle))
    return c.body(null, 204)
  })

// The watch page response for the current viewer, or a 404 ApiError.
async function videoDetail(c: Context<AppEnv>, id: string) {
  const userId = c.var.user?.id
  const row = await getDb(c.env.DB)
    .select({
      id: videos.id,
      streamUid: videos.streamUid,
      title: videos.title,
      description: videos.description,
      status: videos.status,
      visibility: videos.visibility,
      durationS: videos.durationS,
      thumbnailUrl: videos.thumbnailUrl,
      viewCount: videos.viewCount,
      likeCount: videos.likeCount,
      commentCount: videos.commentCount,
      publishedAt: videos.publishedAt,
      takenDownAt: videos.takenDownAt,
      // The viewer's own like, for the LikeButton's initial state (likes PK lookup).
      likedByMe: userId
        ? sql<number>`exists(select 1 from ${likes} where ${likes.userId} = ${userId} and ${likes.videoId} = ${videos.id})`
        : sql<number>`0`,
      channel: {
        id: channels.id,
        handle: channels.handle,
        name: channels.name,
        avatarKey: channels.avatarKey,
        subscriberCount: channels.subscriberCount,
        subscribedByMe: subscribedBy(userId),
      },
    })
    .from(videos)
    .innerJoin(channels, eq(channels.id, videos.channelId))
    .where(eq(videos.id, id))
    .get()

  const isOwner = row !== undefined && c.var.user?.channel.id === row.channel.id
  // Taken down by a moderator: gone for everyone, the owner included (the studio shows why).
  if (!row || row.takenDownAt !== null || (row.status !== 'ready' && !isOwner)) {
    throw new ApiError(404, 'not_found')
  }

  const { streamUid, likedByMe, takenDownAt: _takenDownAt, ...video } = row
  return {
    ...video,
    channel: { ...video.channel, subscribedByMe: Boolean(video.channel.subscribedByMe) },
    likedByMe: Boolean(likedByMe),
    isOwner,
    // Null until Stream has a playable video.
    playerUrl:
      row.status === 'ready' && streamUid
        ? streamPlayerUrl(c.env.STREAM_CUSTOMER_CODE, streamUid)
        : null,
  }
}
