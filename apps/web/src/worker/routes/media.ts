import { Hono } from 'hono'
import { z } from 'zod'

import { ApiError } from '../lib/errors'
import { validate } from '../middleware/validate'
import type { AppEnv } from '../types'

// Exactly the keys POST /api/me/avatar writes: avatars/<channel uuid>/<uuid>.<ext>. Internal to
// this route (it's a storage key, not an API input), so it isn't in @vidflare/shared.
const avatarParam = z.object({
  channelId: z.uuid(),
  file: z.string().regex(/^[0-9a-f-]{36}\.(png|jpg|webp)$/),
})

// Public images from R2, mounted under /media. Same origin as the app, so <img> tags need no
// CORS. The client builds these URLs from a channel's avatarKey.
export const mediaRoutes = new Hono<AppEnv>().get(
  '/avatars/:channelId/:file',
  validate('param', avatarParam),
  async (c) => {
    const { channelId, file } = c.req.valid('param')
    const object = await c.env.MEDIA.get(`avatars/${channelId}/${file}`)
    if (!object) throw new ApiError(404, 'not_found')

    const headers = new Headers()
    object.writeHttpMetadata(headers)
    headers.set('etag', object.httpEtag)
    // Stored with a sniffed image type; never let a browser second-guess it, and never let
    // the response run anything if opened directly.
    headers.set('x-content-type-options', 'nosniff')
    headers.set('content-security-policy', "default-src 'none'; sandbox")
    return new Response(object.body, { headers })
  },
)
