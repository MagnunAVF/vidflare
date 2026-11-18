import { cursorQuery } from '@vidflare/shared'
import { eq, inArray } from 'drizzle-orm'
import { Hono } from 'hono'

import { getDb } from '../db/client'
import { subscriptions, videos } from '../db/schema'
import { publicVideoPage } from '../lib/feed'
import { requireUser } from '../middleware/session'
import { validate } from '../middleware/validate'
import type { AppEnv } from '../types'

// Personal feeds, mounted under /feed.
export const feedRoutes = new Hono<AppEnv>()
  // The latest public, ready videos from the channels the user subscribes to, newest first,
  // with the same cursor as every other listing.
  .get('/subscriptions', requireUser, validate('query', cursorQuery), async (c) => {
    const { cursor } = c.req.valid('query')
    const db = getDb(c.env.DB)
    const subscribed = db
      .select({ channelId: subscriptions.channelId })
      .from(subscriptions)
      .where(eq(subscriptions.subscriberId, c.var.user.id))
    return c.json(await publicVideoPage(db, cursor, inArray(videos.channelId, subscribed)), 200)
  })
