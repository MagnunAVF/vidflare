import { videoIdParam } from '@vidflare/shared'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'

import { getDb } from '../db/client'
import { videos } from '../db/schema'
import { isAvailable } from '../lib/availability'
import { ApiError } from '../lib/errors'
import { viewerKey } from '../lib/viewer'
import { byIp, rateLimit } from '../middleware/rate-limit'
import { validate } from '../middleware/validate'
import type { AppEnv } from '../types'

// Views, mounted under /videos. The player posts once per page load after ~10 s of playback.
// No D1 write here: the video's VideoStats Durable Object dedupes and counts, and flushes the
// total to D1 on its own alarm.
export const viewRoutes = new Hono<AppEnv>().post(
  '/:id/view',
  // Per IP: dropping the viewer cookie gets a new dedupe key, but not a new IP.
  rateLimit('VIEW_LIMITER', byIp),
  validate('param', videoIdParam),
  async (c) => {
    const { id } = c.req.valid('param')
    // Only a playable video counts views; anything else never reaches (or creates) an object.
    const video = await getDb(c.env.DB)
      .select({
        status: videos.status,
        takenDownAt: videos.takenDownAt,
        viewCount: videos.viewCount,
      })
      .from(videos)
      .where(eq(videos.id, id))
      .get()
    if (!video || !isAvailable(video)) throw new ApiError(404, 'not_found')

    const stats = c.env.VIDEO_STATS.get(c.env.VIDEO_STATS.idFromName(id))
    const result = await stats.recordView({
      videoId: id,
      viewerKey: await viewerKey(c),
      baseViewCount: video.viewCount,
    })
    return c.json({ recorded: result.recorded, viewCount: result.viewCount }, 200)
  },
)
