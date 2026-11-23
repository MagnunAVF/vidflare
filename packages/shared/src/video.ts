import { z } from 'zod'

import { UPLOAD_MAX_BYTES, VIDEO_DESCRIPTION_MAX, VIDEO_TITLE_MAX } from './limits'
import { turnstileToken } from './turnstile'

// Tuples are exported too so the DB schema can share the exact same values.
export const VIDEO_STATUSES = ['uploading', 'processing', 'ready', 'error'] as const
export const videoStatus = z.enum(VIDEO_STATUSES)
export type VideoStatus = z.infer<typeof videoStatus>

export const VIDEO_VISIBILITIES = ['public', 'unlisted'] as const
export const videoVisibility = z.enum(VIDEO_VISIBILITIES)
export type VideoVisibility = z.infer<typeof videoVisibility>

// Title, description and visibility: set on upload, edited later in the studio.
export const videoMetadataInput = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Enter a title')
    .max(VIDEO_TITLE_MAX, `At most ${VIDEO_TITLE_MAX} characters`),
  description: z
    .string()
    .trim()
    .max(VIDEO_DESCRIPTION_MAX, `At most ${VIDEO_DESCRIPTION_MAX} characters`),
  visibility: videoVisibility,
})
export type VideoMetadataInput = z.input<typeof videoMetadataInput>

// PATCH /api/videos/:id: any subset of the metadata, but at least one field.
export const updateVideoInput = videoMetadataInput
  .partial()
  .refine((v) => Object.values(v).some((value) => value !== undefined), {
    message: 'Nothing to update',
  })
export type UpdateVideoInput = z.input<typeof updateVideoInput>

// POST /api/videos/uploads. The size is the file's byte length: Stream needs it to create
// the resumable (tus) upload before the browser sends any bytes.
export const createUploadInput = videoMetadataInput.extend({
  sizeBytes: z
    .number()
    .int()
    .positive('The file is empty')
    .max(UPLOAD_MAX_BYTES, `The file is larger than ${UPLOAD_MAX_BYTES / 1024 ** 3} GB`),
  turnstileToken,
})
export type CreateUploadInput = z.input<typeof createUploadInput>

// Route params for /api/videos/:id/...
export const videoIdParam = z.object({ id: z.uuid() })
