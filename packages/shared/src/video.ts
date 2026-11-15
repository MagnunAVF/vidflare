import { z } from 'zod'

// Tuples are exported too so the DB schema can share the exact same values.
export const VIDEO_STATUSES = ['uploading', 'processing', 'ready', 'error'] as const
export const videoStatus = z.enum(VIDEO_STATUSES)
export type VideoStatus = z.infer<typeof videoStatus>

export const VIDEO_VISIBILITIES = ['public', 'unlisted'] as const
export const videoVisibility = z.enum(VIDEO_VISIBILITIES)
export type VideoVisibility = z.infer<typeof videoVisibility>
