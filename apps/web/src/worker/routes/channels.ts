import { channelHandleParam, cursorQuery } from '@vidflare/shared'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'

import { getDb } from '../db/client'
import { channels, videos } from '../db/schema'
import { ApiError } from '../lib/errors'
import { publicVideoPage } from '../lib/feed'
import { validate } from '../middleware/validate'
import type { AppEnv } from '../types'

// Public channel pages, by handle (/c/$handle).
export const channelRoutes = new Hono<AppEnv>()
  .get('/:handle', validate('param', channelHandleParam), async (c) => {
    const { handle } = c.req.valid('param')
    const channel = await getDb(c.env.DB)
      .select({
        id: channels.id,
        handle: channels.handle,
        name: channels.name,
        avatarKey: channels.avatarKey,
        subscriberCount: channels.subscriberCount,
        createdAt: channels.createdAt,
      })
      .from(channels)
      .where(eq(channels.handle, handle))
      .get()
    if (!channel) throw new ApiError(404, 'not_found')
    return c.json({ ...channel, isOwner: c.var.user?.channel.id === channel.id }, 200)
  })
  // The channel's public, ready videos, newest first (videos_channel_idx). The owner sees the
  // same list as everyone; their other videos are in the studio.
  .get(
    '/:handle/videos',
    validate('param', channelHandleParam),
    validate('query', cursorQuery),
    async (c) => {
      const { handle } = c.req.valid('param')
      const { cursor } = c.req.valid('query')
      const db = getDb(c.env.DB)
      const channel = await db
        .select({ id: channels.id })
        .from(channels)
        .where(eq(channels.handle, handle))
        .get()
      if (!channel) throw new ApiError(404, 'not_found')
      return c.json(await publicVideoPage(db, cursor, eq(videos.channelId, channel.id)), 200)
    },
  )
