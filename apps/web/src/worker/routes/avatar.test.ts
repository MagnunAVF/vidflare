import { AVATAR_MAX_BYTES } from '@vidflare/shared'
import { env } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { getDb } from '../db/client'
import { channels } from '../db/schema'
import { sniffImageType } from '../lib/images'
import { callApi, signUp } from '../test/helpers'

const db = getDb(env.DB)

// Smallest valid-looking files: the magic bytes followed by padding.
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG = [0xff, 0xd8, 0xff, 0xe0]
const WEBP = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]
const image = (magic: number[], size = 64) => {
  const bytes = new Uint8Array(size)
  bytes.set(magic)
  return bytes
}

const upload = (cookie: string | undefined, bytes: Uint8Array, type: string, name = 'a.png') => {
  const form = new FormData()
  form.append('file', new File([bytes], name, { type }))
  return callApi('/api/me/avatar', {
    method: 'POST',
    headers: cookie ? { cookie } : {},
    body: form,
  })
}

const avatarKeyOf = async (channelId: string) =>
  (
    await db
      .select({ k: channels.avatarKey })
      .from(channels)
      .where(eq(channels.id, channelId))
      .get()
  )?.k

describe('sniffImageType', () => {
  it('recognizes PNG, JPEG and WebP by their bytes only', () => {
    expect(sniffImageType(image(PNG))).toBe('image/png')
    expect(sniffImageType(image(JPEG))).toBe('image/jpeg')
    expect(sniffImageType(image(WEBP))).toBe('image/webp')
    expect(
      sniffImageType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg">')),
    ).toBe(null)
    expect(sniffImageType(new Uint8Array())).toBe(null)
  })
})

describe('POST /api/me/avatar', () => {
  it('requires a session', async () => {
    expect((await upload(undefined, image(PNG), 'image/png')).status).toBe(401)
  })

  it('stores the image in R2 under a fresh key and points the channel at it', async () => {
    const { cookie, channelId } = await signUp()

    const res = await upload(cookie, image(PNG), 'image/png')

    expect(res.status).toBe(200)
    const body = await res.json<{ channel: { avatarKey: string } }>()
    expect(body.channel.avatarKey).toMatch(new RegExp(`^avatars/${channelId}/[0-9a-f-]{36}\\.png$`))
    expect(await avatarKeyOf(channelId)).toBe(body.channel.avatarKey)
    const object = await env.MEDIA.get(body.channel.avatarKey)
    expect(object?.httpMetadata?.contentType).toBe('image/png')
    expect(new Uint8Array(await object!.arrayBuffer())).toEqual(image(PNG))
  })

  it('replaces the previous avatar and deletes its object', async () => {
    const { cookie, channelId } = await signUp()
    const first = (
      await (
        await upload(cookie, image(PNG), 'image/png')
      ).json<{
        channel: { avatarKey: string }
      }>()
    ).channel.avatarKey

    const res = await upload(cookie, image(WEBP), 'image/webp', 'b.webp')
    const second = (await res.json<{ channel: { avatarKey: string } }>()).channel.avatarKey

    expect(second).not.toBe(first)
    expect(second).toMatch(/\.webp$/)
    expect(await avatarKeyOf(channelId)).toBe(second)
    expect(await env.MEDIA.head(first)).toBeNull()
    expect(await env.MEDIA.head(second)).not.toBeNull()
  })

  it('uses the sniffed type, not the declared one', async () => {
    const { cookie } = await signUp()
    // A JPEG sent as image/png is stored as a JPEG.
    const res = await upload(cookie, image(JPEG), 'image/png')
    expect((await res.json<{ channel: { avatarKey: string } }>()).channel.avatarKey).toMatch(
      /\.jpg$/,
    )
  })

  it('rejects files that only claim to be images', async () => {
    const { cookie, channelId } = await signUp()
    const html = new TextEncoder().encode('<html><script>alert(1)</script></html>')
    const res = await upload(cookie, html, 'image/png')
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'unsupported_image' })
    expect(await avatarKeyOf(channelId)).toBeNull()
  })

  it.each([
    ['a GIF', image([0x47, 0x49, 0x46, 0x38]), 'image/gif'],
    ['an SVG', new TextEncoder().encode('<svg/>'), 'image/svg+xml'],
    ['an empty file', new Uint8Array(), 'image/png'],
    ['a file over the size limit', image(PNG, AVATAR_MAX_BYTES + 1), 'image/png'],
  ])('rejects %s', async (_label, bytes, type) => {
    const { cookie } = await signUp()
    const res = await upload(cookie, bytes, type)
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'invalid_request' })
  })
})

describe('DELETE /api/me/avatar', () => {
  it('clears the avatar and deletes the object; repeats are harmless', async () => {
    const { cookie, channelId } = await signUp()
    const key = (
      await (
        await upload(cookie, image(PNG), 'image/png')
      ).json<{
        channel: { avatarKey: string }
      }>()
    ).channel.avatarKey

    const res = await callApi('/api/me/avatar', { method: 'DELETE', headers: { cookie } })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ channel: { avatarKey: null } })
    expect(await avatarKeyOf(channelId)).toBeNull()
    expect(await env.MEDIA.head(key)).toBeNull()

    expect(
      (await callApi('/api/me/avatar', { method: 'DELETE', headers: { cookie } })).status,
    ).toBe(200)
  })

  it('requires a session', async () => {
    expect((await callApi('/api/me/avatar', { method: 'DELETE' })).status).toBe(401)
  })
})

describe('GET /api/media/avatars/:channelId/:file', () => {
  it('serves the stored image publicly with safe, long-lived caching headers', async () => {
    const { cookie } = await signUp()
    const key = (
      await (
        await upload(cookie, image(PNG), 'image/png')
      ).json<{
        channel: { avatarKey: string }
      }>()
    ).channel.avatarKey

    const res = await callApi(`/api/media/${key}`)

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('etag')).toBeTruthy()
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(image(PNG))
  })

  it('answers 404 for a missing object and 400 for keys it never writes', async () => {
    const { channelId } = await signUp()
    expect(
      (await callApi(`/api/media/avatars/${channelId}/01a0f9e9-2000-7000-8000-000000000007.png`))
        .status,
    ).toBe(404)
    expect((await callApi(`/api/media/avatars/${channelId}/secret.txt`)).status).toBe(400)
    expect((await callApi('/api/media/avatars/not-a-uuid/x.png')).status).toBe(400)
  })
})
