import { videoIdParam } from '@vidflare/shared'
import { and, eq, sql } from 'drizzle-orm'
import { Hono } from 'hono'

import { getDb } from '../db/client'
import { likes, videos } from '../db/schema'
import { ApiError } from '../lib/errors'
import { requireUser } from '../middleware/session'
import { validate } from '../middleware/validate'
import type { AppEnv } from '../types'

// Likes on a video, mounted under /videos. Each write is one db.batch(): the likes row change
// and the like_count bump commit together. like_count moves by changes(), the number of rows the
// previous statement in the batch actually inserted or deleted, so repeat likes and unlikes
// leave the counter alone (the likes PK plus ON CONFLICT DO NOTHING keeps the row unique).
export const likeRoutes = new Hono<AppEnv>()
  .put('/:id/like', requireUser, validate('param', videoIdParam), async (c) => {
    const { id } = c.req.valid('param')
    const db = getDb(c.env.DB)
    const now = Date.now()

    const [, , video] = await db.batch([
      // INSERT ... SELECT: only a ready video can be liked, and a missing one inserts nothing
      // instead of failing on the foreign key.
      db
        .insert(likes)
        .select(
          db
            .select({
              userId: sql<string>`${c.var.user.id}`.as('user_id'),
              videoId: videos.id,
              createdAt: sql<number>`${now}`.as('created_at'),
            })
            .from(videos)
            .where(and(eq(videos.id, id), eq(videos.status, 'ready'))),
        )
        .onConflictDoNothing(),
      db
        .update(videos)
        .set({ likeCount: sql`${videos.likeCount} + changes()` })
        .where(eq(videos.id, id)),
      db
        .select({ status: videos.status, likeCount: videos.likeCount })
        .from(videos)
        .where(eq(videos.id, id)),
    ])

    const row = video[0]
    if (!row || row.status !== 'ready') throw new ApiError(404, 'not_found')
    return c.json({ liked: true, likeCount: row.likeCount }, 200)
  })
  .delete('/:id/like', requireUser, validate('param', videoIdParam), async (c) => {
    const { id } = c.req.valid('param')
    const db = getDb(c.env.DB)

    const [, , video] = await db.batch([
      db.delete(likes).where(and(eq(likes.userId, c.var.user.id), eq(likes.videoId, id))),
      db
        .update(videos)
        .set({ likeCount: sql`max(${videos.likeCount} - changes(), 0)` })
        .where(eq(videos.id, id)),
      db
        .select({ status: videos.status, likeCount: videos.likeCount })
        .from(videos)
        .where(eq(videos.id, id)),
    ])

    const row = video[0]
    if (!row || row.status !== 'ready') throw new ApiError(404, 'not_found')
    return c.json({ liked: false, likeCount: row.likeCount }, 200)
  })
