import { avatarUploadInput, updateProfileInput } from '@vidflare/shared'
import { and, eq, ne } from 'drizzle-orm'
import { Hono } from 'hono'

import { getDb } from '../db/client'
import { channels } from '../db/schema'
import { channelCacheKeys, purgeCache } from '../lib/cache'
import { ApiError } from '../lib/errors'
import { uuidv7 } from '../lib/id'
import { IMAGE_EXTENSIONS, sniffImageType } from '../lib/images'
import { toMeResponse } from '../lib/me'
import { requireUser } from '../middleware/session'
import { validate } from '../middleware/validate'
import type { AppEnv } from '../types'

// Avatar objects never change: every upload gets a new key, so they can be cached forever.
const AVATAR_CACHE_CONTROL = 'public, max-age=31536000, immutable'

// A concurrent rename that won the unique handle index answers like the pre-check.
const isHandleConflict = (err: unknown) =>
  err instanceof Error && `${err.message} ${String(err.cause ?? '')}`.includes('channels.handle')

export const me = new Hono<AppEnv>()
  .get('/', requireUser, (c) => c.json(toMeResponse(c.var.user), 200))
  // Change the channel's name and/or handle. A handle someone else has is a 409. A new
  // handle changes the channel's URL (/c/$handle); old links stop working.
  .patch('/', requireUser, validate('json', updateProfileInput), async (c) => {
    const changes = c.req.valid('json')
    const user = c.var.user
    const db = getDb(c.env.DB)

    if (changes.handle !== undefined && changes.handle !== user.channel.handle) {
      const taken = await db
        .select({ id: channels.id })
        .from(channels)
        .where(and(eq(channels.handle, changes.handle), ne(channels.id, user.channel.id)))
        .get()
      if (taken) throw new ApiError(409, 'handle_taken')
    }

    let updated
    try {
      updated = await db
        .update(channels)
        .set(changes)
        .where(eq(channels.id, user.channel.id))
        .returning({ handle: channels.handle, name: channels.name })
        .get()
    } catch (err) {
      if (isHandleConflict(err)) throw new ApiError(409, 'handle_taken')
      throw err
    }
    if (!updated) throw new ApiError(404, 'not_found')
    // Both handles: the old one's pages must stop answering, the new one's must not be stale.
    await purgeCache(c.env.CACHE, [
      ...channelCacheKeys(user.channel.handle),
      ...channelCacheKeys(updated.handle),
    ])
    return c.json(toMeResponse({ ...user, channel: { ...user.channel, ...updated } }), 200)
  })
  // Replace the channel's avatar: store the image in R2 under a fresh key
  // (avatars/<channelId>/<uuid>.<ext>), point the channel at it, then delete the old object.
  .post('/avatar', requireUser, validate('form', avatarUploadInput), async (c) => {
    const { file } = c.req.valid('form')
    // zod types File structurally ({ type, size }) under the Workers types; at runtime it is the
    // multipart File (a Blob).
    const bytes = new Uint8Array(await (file as unknown as Blob).arrayBuffer())
    const type = sniffImageType(bytes)
    if (!type) throw new ApiError(400, 'unsupported_image')

    const user = c.var.user
    const key = `avatars/${user.channel.id}/${uuidv7()}.${IMAGE_EXTENSIONS[type]}`
    await c.env.MEDIA.put(key, bytes, {
      httpMetadata: { contentType: type, cacheControl: AVATAR_CACHE_CONTROL },
    })
    try {
      await getDb(c.env.DB)
        .update(channels)
        .set({ avatarKey: key })
        .where(eq(channels.id, user.channel.id))
    } catch (err) {
      // Nothing points at the new object: don't leave it behind.
      await c.env.MEDIA.delete(key).catch(() => {})
      throw err
    }
    await purgeCache(c.env.CACHE, channelCacheKeys(user.channel.handle))
    // Best effort: a leftover old object is only wasted storage.
    if (user.channel.avatarKey) await c.env.MEDIA.delete(user.channel.avatarKey).catch(() => {})

    return c.json(toMeResponse({ ...user, channel: { ...user.channel, avatarKey: key } }), 200)
  })
  // Remove the avatar (back to the channel's initial). Repeat calls are harmless.
  .delete('/avatar', requireUser, async (c) => {
    const user = c.var.user
    await getDb(c.env.DB)
      .update(channels)
      .set({ avatarKey: null })
      .where(eq(channels.id, user.channel.id))
    await purgeCache(c.env.CACHE, channelCacheKeys(user.channel.handle))
    if (user.channel.avatarKey) await c.env.MEDIA.delete(user.channel.avatarKey).catch(() => {})
    return c.json(toMeResponse({ ...user, channel: { ...user.channel, avatarKey: null } }), 200)
  })
