import {
  FEED_PAGE_SIZE,
  moderationReportsQuery,
  type Page,
  reportIdParam,
  videoIdParam,
} from '@vidflare/shared'
import { and, desc, eq, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'

import { getDb } from '../db/client'
import { channels, reports, videos } from '../db/schema'
import { purgeCache, videoCacheKeys } from '../lib/cache'
import { decodeCursor, encodeCursor } from '../lib/cursor'
import { utf8 } from '../lib/encoding'
import { ApiError } from '../lib/errors'
import { validate } from '../middleware/validate'
import { setRequireSignedUrls, streamConfig } from '../services/stream'
import type { AppEnv } from '../types'

// The manual takedown flow (docs/Moderation.md): an operator reviews reports and takes videos
// down or restores them by calling these routes with MODERATION_TOKEN as a bearer token. There
// is no moderation UI in the MVP. With no MODERATION_TOKEN set, every route answers 404.

const sha256 = async (text: string) => crypto.subtle.digest('SHA-256', utf8(text))

const requireModerator = createMiddleware<AppEnv>(async (c, next) => {
  const expected = c.env.MODERATION_TOKEN
  if (!expected) throw new ApiError(404, 'not_found')
  const header = c.req.header('Authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : ''
  // Equal-length digests, compared in constant time.
  const ok =
    token !== '' && crypto.subtle.timingSafeEqual(await sha256(token), await sha256(expected))
  if (!ok) {
    console.warn(JSON.stringify({ msg: 'moderation.unauthorized', requestId: c.var.requestId }))
    throw new ApiError(401, 'unauthorized')
  }
  await next()
})

const log = (msg: string, fields: Record<string, unknown>) =>
  console.info(JSON.stringify({ msg, ...fields }))

// The video and its channel's handle (for the cache purge), or a 404.
async function videoForModeration(db: ReturnType<typeof getDb>, id: string) {
  const row = await db
    .select({ id: videos.id, streamUid: videos.streamUid, handle: channels.handle })
    .from(videos)
    .innerJoin(channels, eq(channels.id, videos.channelId))
    .where(eq(videos.id, id))
    .get()
  if (!row) throw new ApiError(404, 'not_found')
  return row
}

export const moderationRoutes = new Hono<AppEnv>()
  .use(requireModerator)
  // The report queue, newest first (reports_status_idx), keyset-paginated on (created_at, id).
  .get('/reports', validate('query', moderationReportsQuery), async (c) => {
    const { status, cursor } = c.req.valid('query')
    const after = cursor === undefined ? null : decodeCursor(cursor)
    if (cursor !== undefined && !after) throw new ApiError(400, 'invalid_cursor')

    const rows = await getDb(c.env.DB)
      .select({
        id: reports.id,
        reason: reports.reason,
        details: reports.details,
        status: reports.status,
        createdAt: reports.createdAt,
        resolvedAt: reports.resolvedAt,
        reporterId: reports.reporterId,
        video: {
          id: videos.id,
          title: videos.title,
          status: videos.status,
          visibility: videos.visibility,
          takenDownAt: videos.takenDownAt,
          channelHandle: channels.handle,
        },
      })
      .from(reports)
      .innerJoin(videos, eq(videos.id, reports.videoId))
      .innerJoin(channels, eq(channels.id, videos.channelId))
      .where(
        and(
          eq(reports.status, status),
          after
            ? sql`(${reports.createdAt}, ${reports.id}) < (${after.at}, ${after.id})`
            : undefined,
        ),
      )
      .orderBy(desc(reports.createdAt), desc(reports.id))
      .limit(FEED_PAGE_SIZE + 1)
      .all()

    const items = rows.slice(0, FEED_PAGE_SIZE)
    const last = items.at(-1)
    const nextCursor =
      rows.length > FEED_PAGE_SIZE && last
        ? encodeCursor({ at: last.createdAt, id: last.id })
        : null
    return c.json({ items, nextCursor } satisfies Page<(typeof items)[number]>, 200)
  })
  // Take a video down: hidden from every listing and its watch page (404 for everyone, the
  // owner included), its open reports marked actioned, and public playback blocked in Stream.
  // D1 first, so the app stops showing it at once; the Stream call last. Idempotent: if Stream
  // fails, the request errors and can simply be repeated.
  .post('/videos/:id/takedown', validate('param', videoIdParam), async (c) => {
    const { id } = c.req.valid('param')
    const db = getDb(c.env.DB)
    const video = await videoForModeration(db, id)
    const now = Date.now()

    const [, , current] = await db.batch([
      db
        .update(videos)
        .set({ takenDownAt: sql`coalesce(${videos.takenDownAt}, ${now})` })
        .where(eq(videos.id, id)),
      db
        .update(reports)
        .set({ status: 'actioned', resolvedAt: now })
        .where(and(eq(reports.videoId, id), eq(reports.status, 'open'))),
      db.select({ takenDownAt: videos.takenDownAt }).from(videos).where(eq(videos.id, id)),
    ])
    await purgeCache(c.env.CACHE, videoCacheKeys(id, video.handle))
    if (video.streamUid) await setRequireSignedUrls(streamConfig(c.env), video.streamUid, true)

    log('video.taken_down', { videoId: id })
    return c.json({ id, takenDownAt: current[0]?.takenDownAt ?? now }, 200)
  })
  // Undo a takedown. Stream first, so the video is never listed while its player is blocked.
  // Reports stay as they are (actioned).
  .post('/videos/:id/restore', validate('param', videoIdParam), async (c) => {
    const { id } = c.req.valid('param')
    const db = getDb(c.env.DB)
    const video = await videoForModeration(db, id)

    if (video.streamUid) await setRequireSignedUrls(streamConfig(c.env), video.streamUid, false)
    await db.update(videos).set({ takenDownAt: null }).where(eq(videos.id, id))
    await purgeCache(c.env.CACHE, videoCacheKeys(id, video.handle))

    log('video.restored', { videoId: id })
    return c.json({ id, takenDownAt: null }, 200)
  })
  // Close a report that needs no action. Only an open report changes; repeats are harmless.
  .post('/reports/:id/dismiss', validate('param', reportIdParam), async (c) => {
    const { id } = c.req.valid('param')
    const db = getDb(c.env.DB)
    await db
      .update(reports)
      .set({ status: 'dismissed', resolvedAt: Date.now() })
      .where(and(eq(reports.id, id), eq(reports.status, 'open')))
    const report = await db
      .select({ id: reports.id, status: reports.status, resolvedAt: reports.resolvedAt })
      .from(reports)
      .where(eq(reports.id, id))
      .get()
    if (!report) throw new ApiError(404, 'not_found')
    return c.json(report, 200)
  })
