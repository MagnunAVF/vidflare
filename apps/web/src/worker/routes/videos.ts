import { createUploadInput, UPLOAD_MAX_DURATION_S } from '@vidflare/shared'
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

export const videoRoutes = new Hono<AppEnv>().post(
  '/uploads',
  requireUser,
  validate('json', createUploadInput),
  async (c) => {
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
  },
)
