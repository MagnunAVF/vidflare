import { channelHandleParam, channelIdParam, cursorQuery } from '@vidflare/shared'
import { and, eq, ne, sql } from 'drizzle-orm'
import { type Context, Hono } from 'hono'

import { getDb } from '../db/client'
import { channels, subscriptions, videos } from '../db/schema'
import { cached, cacheKeys } from '../lib/cache'
import { ApiError } from '../lib/errors'
import { publicVideoPage } from '../lib/feed'
import { subscribedBy } from '../lib/subscriptions'
import { requireUser } from '../middleware/session'
import { validate } from '../middleware/validate'
import type { AppEnv } from '../types'

// subscriber_count recomputed from the subscriptions rows (subscriptions_channel_idx). Runs in
// the same batch as the row change, so repeat requests are harmless and the count can't drift.
const recountSubscribers = (db: ReturnType<typeof getDb>, channelId: string) =>
  db
    .update(channels)
    .set({
      subscriberCount: sql`(select count(*) from ${subscriptions} where ${subscriptions.channelId} = ${channelId})`,
    })
    .where(eq(channels.id, channelId))

// After a subscribe/unsubscribe batch: 404 for a missing channel, 400 for one's own channel
// (the write already skipped it), else the new state.
function subscribeResult(
  row: { userId: string; subscriberCount: number } | undefined,
  userId: string,
  subscribed: boolean,
) {
  if (!row) throw new ApiError(404, 'not_found')
  if (row.userId === userId) throw new ApiError(400, 'cannot_subscribe_to_own_channel')
  return { subscribed, subscriberCount: row.subscriberCount }
}

// A channel page's header data for the current viewer, or a 404 ApiError.
async function channelInfo(c: Context<AppEnv>, handle: string) {
  const channel = await getDb(c.env.DB)
    .select({
      id: channels.id,
      handle: channels.handle,
      name: channels.name,
      avatarKey: channels.avatarKey,
      subscriberCount: channels.subscriberCount,
      createdAt: channels.createdAt,
      subscribedByMe: subscribedBy(c.var.user?.id),
    })
    .from(channels)
    .where(eq(channels.handle, handle))
    .get()
  if (!channel) throw new ApiError(404, 'not_found')
  return {
    ...channel,
    subscribedByMe: Boolean(channel.subscribedByMe),
    isOwner: c.var.user?.channel.id === channel.id,
  }
}

// Public channel pages, by handle (/c/$handle), and subscribing, by channel id.
export const channelRoutes = new Hono<AppEnv>()
  // Signed-out visitors all get the same response, so theirs comes from KV.
  .get('/:handle', validate('param', channelHandleParam), async (c) => {
    const { handle } = c.req.valid('param')
    const load = () => channelInfo(c, handle)
    const channel = c.var.user ? await load() : await cached(c, cacheKeys.channel(handle), load)
    return c.json(channel, 200)
  })
  // The channel's public, ready videos, newest first (videos_channel_idx). The owner sees the
  // same list as everyone; their other videos are in the studio. The first page is the same
  // for every viewer and comes from KV; later pages read D1.
  .get(
    '/:handle/videos',
    validate('param', channelHandleParam),
    validate('query', cursorQuery),
    async (c) => {
      const { handle } = c.req.valid('param')
      const { cursor } = c.req.valid('query')
      const db = getDb(c.env.DB)
      const load = async () => {
        const channel = await db
          .select({ id: channels.id })
          .from(channels)
          .where(eq(channels.handle, handle))
          .get()
        if (!channel) throw new ApiError(404, 'not_found')
        return publicVideoPage(db, cursor, eq(videos.channelId, channel.id))
      }
      const page =
        cursor === undefined ? await cached(c, cacheKeys.channelVideos(handle), load) : await load()
      return c.json(page, 200)
    },
  )
  .put('/:id/subscribe', requireUser, validate('param', channelIdParam), async (c) => {
    const { id } = c.req.valid('param')
    const userId = c.var.user.id
    const db = getDb(c.env.DB)

    const [, , channel] = await db.batch([
      // INSERT ... SELECT: a missing channel inserts nothing (no foreign-key error), and the
      // `user_id <> me` condition keeps users from subscribing to their own channel in SQL.
      db
        .insert(subscriptions)
        .select(
          db
            .select({
              subscriberId: sql<string>`${userId}`.as('subscriber_id'),
              channelId: channels.id,
              createdAt: sql<number>`${Date.now()}`.as('created_at'),
            })
            .from(channels)
            .where(and(eq(channels.id, id), ne(channels.userId, userId))),
        )
        .onConflictDoNothing(),
      recountSubscribers(db, id),
      db
        .select({ userId: channels.userId, subscriberCount: channels.subscriberCount })
        .from(channels)
        .where(eq(channels.id, id)),
    ])
    return c.json(subscribeResult(channel[0], userId, true), 200)
  })
  .delete('/:id/subscribe', requireUser, validate('param', channelIdParam), async (c) => {
    const { id } = c.req.valid('param')
    const userId = c.var.user.id
    const db = getDb(c.env.DB)

    const [, , channel] = await db.batch([
      db
        .delete(subscriptions)
        .where(and(eq(subscriptions.subscriberId, userId), eq(subscriptions.channelId, id))),
      recountSubscribers(db, id),
      db
        .select({ userId: channels.userId, subscriberCount: channels.subscriberCount })
        .from(channels)
        .where(eq(channels.id, id)),
    ])
    return c.json(subscribeResult(channel[0], userId, false), 200)
  })
