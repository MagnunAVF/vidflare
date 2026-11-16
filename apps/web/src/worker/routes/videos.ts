import {
  createUploadInput,
  cursorQuery,
  FEED_PAGE_SIZE,
  type Page,
  UPLOAD_MAX_DURATION_S,
  videoIdParam,
} from '@vidflare/shared'
import { and, desc, eq, isNotNull, sql } from 'drizzle-orm'
import { Hono } from 'hono'

import { getDb } from '../db/client'
import { channels, videos } from '../db/schema'
import { decodeCursor, encodeCursor } from '../lib/cursor'
import { ApiError } from '../lib/errors'
import { uuidv7 } from '../lib/id'
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
    const after = cursor === undefined ? null : decodeCursor(cursor)
    if (cursor !== undefined && !after) throw new ApiError(400, 'invalid_cursor')

    const rows = await getDb(c.env.DB)
      .select({
        id: videos.id,
        title: videos.title,
        thumbnailUrl: videos.thumbnailUrl,
        durationS: videos.durationS,
        viewCount: videos.viewCount,
        publishedAt: videos.publishedAt,
        channel: { handle: channels.handle, name: channels.name, avatarKey: channels.avatarKey },
      })
      .from(videos)
      .innerJoin(channels, eq(channels.id, videos.channelId))
      .where(
        and(
          eq(videos.status, 'ready'),
          eq(videos.visibility, 'public'),
          isNotNull(videos.publishedAt),
          after
            ? sql`(${videos.publishedAt}, ${videos.id}) < (${after.publishedAt}, ${after.id})`
            : undefined,
        ),
      )
      .orderBy(desc(videos.publishedAt), desc(videos.id))
      // One extra row tells whether there is a next page.
      .limit(FEED_PAGE_SIZE + 1)
      .all()

    const items = rows.slice(0, FEED_PAGE_SIZE).map((row) => ({
      ...row,
      publishedAt: row.publishedAt ?? 0,
    }))
    const last = items.at(-1)
    const nextCursor =
      rows.length > FEED_PAGE_SIZE && last
        ? encodeCursor({ publishedAt: last.publishedAt, id: last.id })
        : null
    return c.json({ items, nextCursor } satisfies Page<(typeof items)[number]>, 200)
  })
  .post('/uploads', requireUser, validate('json', createUploadInput), async (c) => {
    const input = c.req.valid('json')

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
    const upload = await createDirectUpload(stream, {
      sizeBytes: input.sizeBytes,
      maxDurationSeconds: UPLOAD_MAX_DURATION_S,
      meta: { env: c.env.ENVIRONMENT, videoId },
    })

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

    return c.json({ videoId, uploadUrl: upload.uploadUrl }, 201)
  })
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
  .get('/:id', validate('param', videoIdParam), async (c) => {
    const { id } = c.req.valid('param')
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
        channel: {
          id: channels.id,
          handle: channels.handle,
          name: channels.name,
          avatarKey: channels.avatarKey,
          subscriberCount: channels.subscriberCount,
        },
      })
      .from(videos)
      .innerJoin(channels, eq(channels.id, videos.channelId))
      .where(eq(videos.id, id))
      .get()

    const isOwner = row !== undefined && c.var.user?.channel.id === row.channel.id
    if (!row || (row.status !== 'ready' && !isOwner)) throw new ApiError(404, 'not_found')

    const { streamUid, ...video } = row
    return c.json(
      {
        ...video,
        isOwner,
        // Null until Stream has a playable video.
        playerUrl:
          row.status === 'ready' && streamUid
            ? streamPlayerUrl(c.env.STREAM_CUSTOMER_CODE, streamUid)
            : null,
      },
      200,
    )
  })
