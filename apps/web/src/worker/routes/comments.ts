import {
  type CommentItem,
  commentIdParam,
  COMMENTS_PAGE_SIZE,
  createCommentInput,
  cursorQuery,
  type Page,
  videoIdParam,
} from '@vidflare/shared'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { Hono } from 'hono'

import { getDb } from '../db/client'
import { channels, comments, videos } from '../db/schema'
import { decodeCursor, encodeCursor } from '../lib/cursor'
import { ApiError } from '../lib/errors'
import { uuidv7 } from '../lib/id'
import { requireUser } from '../middleware/session'
import { validate } from '../middleware/validate'
import { verifyTurnstile } from '../services/turnstile'
import type { AppEnv } from '../types'

// Comments on a video, mounted under /videos. Flat (replies are post-MVP), newest first.
// Every write that adds or removes a visible comment moves videos.comment_count in the same
// db.batch(), by changes(): the rows the previous statement actually wrote.
export const videoCommentRoutes = new Hono<AppEnv>()
  // Same visibility as the watch page: a ready video's comments are readable by anyone with
  // the link; a video that isn't ready answers 404 except to its owner. Soft-deleted comments
  // are left out. Keyset pagination on (created_at, id) over comments_video_idx.
  .get(
    '/:id/comments',
    validate('param', videoIdParam),
    validate('query', cursorQuery),
    async (c) => {
      const { id } = c.req.valid('param')
      const { cursor } = c.req.valid('query')
      const after = cursor === undefined ? null : decodeCursor(cursor)
      if (cursor !== undefined && !after) throw new ApiError(400, 'invalid_cursor')

      const db = getDb(c.env.DB)
      const video = await db
        .select({ status: videos.status, channelId: videos.channelId })
        .from(videos)
        .where(eq(videos.id, id))
        .get()
      const isOwner = video !== undefined && c.var.user?.channel.id === video.channelId
      if (!video || (video.status !== 'ready' && !isOwner)) throw new ApiError(404, 'not_found')

      const rows = await db
        .select({
          id: comments.id,
          body: comments.body,
          createdAt: comments.createdAt,
          userId: comments.userId,
          author: { handle: channels.handle, name: channels.name, avatarKey: channels.avatarKey },
        })
        .from(comments)
        // One channel per user: the author is shown by their channel.
        .innerJoin(channels, eq(channels.userId, comments.userId))
        .where(
          and(
            eq(comments.videoId, id),
            isNull(comments.deletedAt),
            after
              ? sql`(${comments.createdAt}, ${comments.id}) < (${after.at}, ${after.id})`
              : undefined,
          ),
        )
        .orderBy(desc(comments.createdAt), desc(comments.id))
        .limit(COMMENTS_PAGE_SIZE + 1)
        .all()

      const items = rows
        .slice(0, COMMENTS_PAGE_SIZE)
        .map(({ userId, ...row }): CommentItem => ({ ...row, isMine: userId === c.var.user?.id }))
      const last = items.at(-1)
      const nextCursor =
        rows.length > COMMENTS_PAGE_SIZE && last
          ? encodeCursor({ at: last.createdAt, id: last.id })
          : null
      return c.json({ items, nextCursor } satisfies Page<CommentItem>, 200)
    },
  )
  .post(
    '/:id/comments',
    requireUser,
    validate('param', videoIdParam),
    validate('json', createCommentInput),
    async (c) => {
      const { id } = c.req.valid('param')
      const input = c.req.valid('json')

      const human = await verifyTurnstile(
        c.env.TURNSTILE_SECRET,
        input.turnstileToken,
        c.req.header('CF-Connecting-IP'),
      )
      if (!human) throw new ApiError(403, 'turnstile_failed')

      const db = getDb(c.env.DB)
      const user = c.var.user
      const now = Date.now()
      const commentId = uuidv7(now)

      const [inserted] = await db.batch([
        // INSERT ... SELECT: only a ready video takes comments; a missing one inserts nothing
        // (and so bumps nothing) instead of failing on the foreign key.
        db
          .insert(comments)
          .select(
            db
              .select({
                id: sql<string>`${commentId}`.as('id'),
                videoId: videos.id,
                userId: sql<string>`${user.id}`.as('user_id'),
                body: sql<string>`${input.body}`.as('body'),
                createdAt: sql<number>`${now}`.as('created_at'),
                deletedAt: sql<null>`null`.as('deleted_at'),
              })
              .from(videos)
              .where(and(eq(videos.id, id), eq(videos.status, 'ready'))),
          )
          .returning({ id: comments.id }),
        db
          .update(videos)
          .set({ commentCount: sql`${videos.commentCount} + changes()` })
          .where(eq(videos.id, id)),
      ])
      if (inserted.length === 0) throw new ApiError(404, 'not_found')

      const { handle, name, avatarKey } = user.channel
      return c.json(
        {
          id: commentId,
          body: input.body,
          createdAt: now,
          author: { handle, name, avatarKey },
          isMine: true,
        } satisfies CommentItem,
        201,
      )
    },
  )

// /comments/:id
export const commentRoutes = new Hono<AppEnv>()
  // Soft delete, author only: the owner check is in the UPDATE's WHERE. comment_count drops in
  // the same batch only if this request is the one that hid the comment, so a repeat delete
  // changes nothing and still answers 204. Someone else's comment answers 404, like a missing one.
  .delete('/:id', requireUser, validate('param', commentIdParam), async (c) => {
    const { id } = c.req.valid('param')
    const db = getDb(c.env.DB)
    const own = and(eq(comments.id, id), eq(comments.userId, c.var.user.id))

    const [deleted] = await db.batch([
      db
        .update(comments)
        .set({ deletedAt: Date.now() })
        .where(and(own, isNull(comments.deletedAt)))
        .returning({ id: comments.id }),
      db
        .update(videos)
        .set({ commentCount: sql`max(${videos.commentCount} - changes(), 0)` })
        .where(
          eq(
            videos.id,
            sql`(select ${comments.videoId} from ${comments} where ${comments.id} = ${id})`,
          ),
        ),
    ])

    if (deleted.length === 0) {
      const existing = await db.select({ id: comments.id }).from(comments).where(own).get()
      if (!existing) throw new ApiError(404, 'not_found')
    }
    return c.body(null, 204)
  })
