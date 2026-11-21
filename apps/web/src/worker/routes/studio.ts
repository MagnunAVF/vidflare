import { cursorQuery, FEED_PAGE_SIZE, type Page, videoIdParam } from '@vidflare/shared'
import { and, desc, eq, sql } from 'drizzle-orm'
import { Hono } from 'hono'

import { getDb } from '../db/client'
import { videos } from '../db/schema'
import { decodeCursor, encodeCursor } from '../lib/cursor'
import { ApiError } from '../lib/errors'
import { channelStorage } from '../lib/storage'
import { syncWithStream } from '../lib/stream-sync'
import { requireUser } from '../middleware/session'
import { validate } from '../middleware/validate'
import type { AppEnv } from '../types'

// The creator studio: the signed-in user's own videos. Owner-only by construction: every query
// is scoped to c.var.user.channel.id.
export const studio = new Hono<AppEnv>()
  // The creator's video storage budget: used, limit and the longest next upload (0: full).
  .get('/storage', requireUser, async (c) =>
    c.json(await channelStorage(getDb(c.env.DB), c.var.user.channel.id), 200),
  )
  // Every status and visibility, newest upload first (videos_studio_idx), keyset-paginated
  // on (created_at, id).
  .get('/videos', requireUser, validate('query', cursorQuery), async (c) => {
    const { cursor } = c.req.valid('query')
    const after = cursor === undefined ? null : decodeCursor(cursor)
    if (cursor !== undefined && !after) throw new ApiError(400, 'invalid_cursor')

    const rows = await getDb(c.env.DB)
      .select({
        id: videos.id,
        title: videos.title,
        description: videos.description,
        status: videos.status,
        visibility: videos.visibility,
        durationS: videos.durationS,
        thumbnailUrl: videos.thumbnailUrl,
        viewCount: videos.viewCount,
        likeCount: videos.likeCount,
        commentCount: videos.commentCount,
        createdAt: videos.createdAt,
        publishedAt: videos.publishedAt,
      })
      .from(videos)
      .where(
        and(
          eq(videos.channelId, c.var.user.channel.id),
          after ? sql`(${videos.createdAt}, ${videos.id}) < (${after.at}, ${after.id})` : undefined,
        ),
      )
      .orderBy(desc(videos.createdAt), desc(videos.id))
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
  // Re-check a stuck video against the Stream API: the fallback when a webhook never arrived
  // (always the case in local dev). Same code as the nightly reconcile (lib/stream-sync.ts).
  .post('/videos/:id/recheck', requireUser, validate('param', videoIdParam), async (c) => {
    const { id } = c.req.valid('param')
    const db = getDb(c.env.DB)
    const owned = and(eq(videos.id, id), eq(videos.channelId, c.var.user.channel.id))
    const row = await db
      .select({ status: videos.status, streamUid: videos.streamUid })
      .from(videos)
      .where(owned)
      .get()
    if (!row) throw new ApiError(404, 'not_found')
    // Nothing to learn from Stream: ready is final, and without a uid there's nothing to ask.
    if (row.status === 'ready' || !row.streamUid) {
      return c.json({ id, status: row.status, streamState: null }, 200)
    }

    const { streamState } = await syncWithStream(c.env, db, { id, streamUid: row.streamUid })
    const current = await db.select({ status: videos.status }).from(videos).where(owned).get()
    return c.json({ id, status: current?.status ?? row.status, streamState }, 200)
  })
