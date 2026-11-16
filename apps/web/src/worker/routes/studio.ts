import { cursorQuery, FEED_PAGE_SIZE, type Page } from '@vidflare/shared'
import { and, desc, eq, sql } from 'drizzle-orm'
import { Hono } from 'hono'

import { getDb } from '../db/client'
import { videos } from '../db/schema'
import { decodeCursor, encodeCursor } from '../lib/cursor'
import { ApiError } from '../lib/errors'
import { requireUser } from '../middleware/session'
import { validate } from '../middleware/validate'
import type { AppEnv } from '../types'

// The creator studio: the signed-in user's own videos. Owner-only by construction: every query
// is scoped to c.var.user.channel.id.
export const studio = new Hono<AppEnv>()
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
