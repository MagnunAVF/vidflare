import { z } from 'zod'

export const videoStatus = z.enum(['uploading', 'processing', 'ready', 'error'])
export type VideoStatus = z.infer<typeof videoStatus>

export const videoVisibility = z.enum(['public', 'unlisted'])
export type VideoVisibility = z.infer<typeof videoVisibility>
