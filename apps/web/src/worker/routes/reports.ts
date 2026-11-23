import { createReportInput, videoIdParam } from '@vidflare/shared'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'

import { getDb } from '../db/client'
import { reports, videos } from '../db/schema'
import { isAvailable } from '../lib/availability'
import { ApiError } from '../lib/errors'
import { uuidv7 } from '../lib/id'
import { requireUser } from '../middleware/session'
import { validate } from '../middleware/validate'
import type { AppEnv } from '../types'

// Viewer reports, mounted under /videos. Reports wait for a person to review them (see
// docs/Moderation.md); nothing is hidden automatically.
export const reportRoutes = new Hono<AppEnv>().post(
  '/:id/report',
  requireUser,
  validate('param', videoIdParam),
  validate('json', createReportInput),
  async (c) => {
    const { id } = c.req.valid('param')
    const { reason, details } = c.req.valid('json')
    const user = c.var.user
    const db = getDb(c.env.DB)

    const video = await db
      .select({
        channelId: videos.channelId,
        status: videos.status,
        takenDownAt: videos.takenDownAt,
      })
      .from(videos)
      .where(eq(videos.id, id))
      .get()
    // Only what viewers can see can be reported; anything else answers like a missing video.
    if (!video || !isAvailable(video)) throw new ApiError(404, 'not_found')
    if (video.channelId === user.channel.id) throw new ApiError(400, 'cannot_report_own_video')

    const now = Date.now()
    // One report per user and video: a repeat is a no-op with the same answer.
    const inserted = await db
      .insert(reports)
      .values({
        id: uuidv7(now),
        videoId: id,
        reporterId: user.id,
        reason,
        details,
        createdAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: reports.id })
      .get()
    if (inserted) {
      // The reason is a fixed code; the free-text details never go to logs.
      console.info(JSON.stringify({ msg: 'video.reported', videoId: id, reason, userId: user.id }))
    }
    return c.json({ reported: true }, 200)
  },
)
