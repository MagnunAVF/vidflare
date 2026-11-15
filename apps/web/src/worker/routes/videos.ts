import { createUploadInput, UPLOAD_MAX_DURATION_S, videoIdParam } from '@vidflare/shared'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'

import { getDb } from '../db/client'
import { videos } from '../db/schema'
import { ApiError } from '../lib/errors'
import { uuidv7 } from '../lib/id'
import { requireUser } from '../middleware/session'
import { validate } from '../middleware/validate'
import { createDirectUpload, deleteVideo, streamConfig } from '../services/stream'
import { verifyTurnstile } from '../services/turnstile'
import type { AppEnv } from '../types'

export const videoRoutes = new Hono<AppEnv>()
  .post('/uploads', requireUser, validate('json', createUploadInput), async (c) => {
    const input = c.req.valid('json')

    const human = await verifyTurnstile(
      c.env.TURNSTILE_SECRET,
      input.turnstileToken,
      c.req.header('CF-Connecting-IP'),
    )
    if (!human) throw new ApiError(403, 'turnstile_failed')

    // The id exists before the Stream video so the upload can carry it in meta.videoId, and
    // the row is written once, already linked to its stream_uid. meta.env lets production's
    // webhook handler route Stream's events back to this environment.
    const now = Date.now()
    const videoId = uuidv7(now)
    const stream = streamConfig(c.env)
    const upload = await createDirectUpload(stream, {
      sizeBytes: input.sizeBytes,
      maxDurationSeconds: UPLOAD_MAX_DURATION_S,
      meta: { env: c.env.ENVIRONMENT, videoId },
    })

    try {
      await getDb(c.env.DB).insert(videos).values({
        id: videoId,
        channelId: c.var.user.channel.id,
        streamUid: upload.uid,
        title: input.title,
        description: input.description,
        visibility: input.visibility,
        status: 'uploading',
        createdAt: now,
      })
    } catch (err) {
      // No row means nobody will ever use or clean up this Stream video: remove it now.
      await deleteVideo(stream, upload.uid).catch(() => {})
      throw err
    }

    return c.json({ videoId, uploadUrl: upload.uploadUrl }, 201)
  })
  // The browser finished sending the bytes: uploading → processing. Only from `uploading`, so
  // a webhook that already set `ready` or `error` is never overwritten. Owner check in SQL.
  // Repeat calls are harmless and return the current status.
  .post('/:id/uploaded', requireUser, validate('param', videoIdParam), async (c) => {
    const { id } = c.req.valid('param')
    const db = getDb(c.env.DB)
    const owned = and(eq(videos.id, id), eq(videos.channelId, c.var.user.channel.id))

    const moved = await db
      .update(videos)
      .set({ status: 'processing' })
      .where(and(owned, eq(videos.status, 'uploading')))
      .returning({ id: videos.id, status: videos.status })
      .get()
    if (moved) return c.json(moved, 200)

    const current = await db
      .select({ id: videos.id, status: videos.status })
      .from(videos)
      .where(owned)
      .get()
    // Someone else's video answers like a missing one.
    if (!current) throw new ApiError(404, 'not_found')
    return c.json(current, 200)
  })
  // The upload page polls this until `ready` or `error`. Owner only: a video that isn't ready
  // (or is unlisted) must not be discoverable by id through this route.
  .get('/:id/status', requireUser, validate('param', videoIdParam), async (c) => {
    const { id } = c.req.valid('param')
    const video = await getDb(c.env.DB)
      .select({ id: videos.id, status: videos.status })
      .from(videos)
      .where(and(eq(videos.id, id), eq(videos.channelId, c.var.user.channel.id)))
      .get()
    if (!video) throw new ApiError(404, 'not_found')
    return c.json(video, 200)
  })
