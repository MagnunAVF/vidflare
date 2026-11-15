import { env } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getDb } from '../db/client'
import { videos } from '../db/schema'
import { uuidv7 } from '../lib/id'
import {
  callApi,
  mockFetch,
  postJson,
  signUp,
  STREAM_API_URL,
  TURNSTILE_URL,
} from '../test/helpers'

const db = getDb(env.DB)

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

const uploadBody = (overrides: Record<string, unknown> = {}) => ({
  title: ' A short clip ',
  description: 'About the clip',
  visibility: 'public',
  sizeBytes: 10 * 1024 * 1024,
  turnstileToken: 'test-token',
  ...overrides,
})

let uidSeq = 0
const nextUid = () => `uid${Date.now().toString(36)}${(uidSeq++).toString(36)}`

// Stream answers tus creation with the upload URL and uid in headers.
const streamCreated = (uid: string) => () =>
  new Response(null, {
    status: 201,
    headers: { Location: `https://upload.videodelivery.net/tus/${uid}`, 'stream-media-id': uid },
  })

const metadata = (req: Request) =>
  Object.fromEntries(
    (req.headers.get('Upload-Metadata') ?? '').split(',').map((pair) => {
      const [key, value = ''] = pair.split(' ')
      return [key, atob(value)]
    }),
  )

describe('POST /api/videos/uploads', () => {
  it('requires a session', async () => {
    const res = await postJson('/api/videos/uploads', uploadBody())
    expect(res.status).toBe(401)
  })

  it('creates the row and a tagged Stream upload, and returns the tus URL', async () => {
    const { cookie, channelId } = await signUp()
    const uid = nextUid()
    const requests = mockFetch({
      [TURNSTILE_URL]: () => Response.json({ success: true }),
      [STREAM_API_URL]: streamCreated(uid),
    })

    const res = await postJson('/api/videos/uploads', uploadBody(), { cookie })

    expect(res.status).toBe(201)
    const body = await res.json<{ videoId: string; uploadUrl: string }>()
    expect(body.uploadUrl).toBe(`https://upload.videodelivery.net/tus/${uid}`)

    const row = await db.select().from(videos).where(eq(videos.id, body.videoId)).get()
    expect(row).toMatchObject({
      channelId,
      streamUid: uid,
      title: 'A short clip',
      description: 'About the clip',
      visibility: 'public',
      status: 'uploading',
      publishedAt: null,
    })

    const create = requests.find((r) => r.url.startsWith(STREAM_API_URL))!
    expect(create.url).toContain('/stream?direct_user=true')
    expect(create.headers.get('Upload-Length')).toBe(String(10 * 1024 * 1024))
    expect(metadata(create)).toEqual({
      maxDurationSeconds: '900',
      env: 'local',
      videoId: body.videoId,
    })
  })

  it('rejects invalid input before calling Turnstile or Stream', async () => {
    const { cookie } = await signUp()
    const requests = mockFetch({})

    const res = await postJson('/api/videos/uploads', uploadBody({ title: '' }), { cookie })

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'invalid_request' })
    expect(requests).toHaveLength(0)
  })

  it('rejects a failed Turnstile check without creating anything', async () => {
    const { cookie, channelId } = await signUp()
    const requests = mockFetch({ [TURNSTILE_URL]: () => Response.json({ success: false }) })

    const res = await postJson('/api/videos/uploads', uploadBody(), { cookie })

    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: 'turnstile_failed' })
    expect(requests.some((r) => r.url.startsWith(STREAM_API_URL))).toBe(false)
    expect(await db.select().from(videos).where(eq(videos.channelId, channelId)).all()).toEqual([])
  })

  it('creates no row when Stream fails', async () => {
    const { cookie, channelId } = await signUp()
    mockFetch({
      [TURNSTILE_URL]: () => Response.json({ success: true }),
      [STREAM_API_URL]: () => Response.json({ errors: [{ code: 10000 }] }, { status: 500 }),
    })

    const res = await postJson('/api/videos/uploads', uploadBody(), { cookie })

    expect(res.status).toBe(500)
    expect(await db.select().from(videos).where(eq(videos.channelId, channelId)).all()).toEqual([])
  })

  it('deletes the Stream video when the row cannot be written', async () => {
    const { cookie } = await signUp()
    // A uid that's already taken makes the insert fail on the unique stream_uid.
    const uid = nextUid()
    mockFetch({
      [TURNSTILE_URL]: () => Response.json({ success: true }),
      [STREAM_API_URL]: streamCreated(uid),
    })
    expect((await postJson('/api/videos/uploads', uploadBody(), { cookie })).status).toBe(201)
    vi.restoreAllMocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const requests = mockFetch({
      [TURNSTILE_URL]: () => Response.json({ success: true }),
      [STREAM_API_URL]: (req) =>
        req.method === 'DELETE' ? new Response(null, { status: 200 }) : streamCreated(uid)(),
    })
    const res = await postJson('/api/videos/uploads', uploadBody(), { cookie })

    expect(res.status).toBe(500)
    const deleted = requests.find((r) => r.method === 'DELETE')
    expect(deleted?.url).toMatch(new RegExp(`/stream/${uid}$`))
  })
})

// A video row in any status, owned by the given channel.
async function insertVideo(
  channelId: string,
  status: 'uploading' | 'processing' | 'ready' | 'error',
) {
  const id = uuidv7()
  await db.insert(videos).values({
    id,
    channelId,
    streamUid: nextUid(),
    title: 'Clip',
    status,
    createdAt: Date.now(),
  })
  return id
}

describe('POST /api/videos/:id/uploaded', () => {
  it('moves an uploading video to processing', async () => {
    const { cookie, channelId } = await signUp()
    const id = await insertVideo(channelId, 'uploading')

    const res = await postJson(`/api/videos/${id}/uploaded`, {}, { cookie })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id, status: 'processing' })
    expect((await db.select().from(videos).where(eq(videos.id, id)).get())?.status).toBe(
      'processing',
    )
  })

  it('never overwrites a status the webhook already set, and repeats are harmless', async () => {
    const { cookie, channelId } = await signUp()
    for (const status of ['processing', 'ready', 'error'] as const) {
      const id = await insertVideo(channelId, status)
      const res = await postJson(`/api/videos/${id}/uploaded`, {}, { cookie })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ id, status })
    }
  })

  it("answers 404 for someone else's video and leaves it alone", async () => {
    const owner = await signUp()
    const other = await signUp()
    const id = await insertVideo(owner.channelId, 'uploading')

    const res = await postJson(`/api/videos/${id}/uploaded`, {}, { cookie: other.cookie })

    expect(res.status).toBe(404)
    expect((await db.select().from(videos).where(eq(videos.id, id)).get())?.status).toBe(
      'uploading',
    )
  })

  it('answers 404 for an unknown id, 400 for a malformed one, 401 when signed out', async () => {
    const { cookie } = await signUp()
    expect((await postJson(`/api/videos/${uuidv7()}/uploaded`, {}, { cookie })).status).toBe(404)
    expect((await postJson('/api/videos/nope/uploaded', {}, { cookie })).status).toBe(400)
    expect((await postJson(`/api/videos/${uuidv7()}/uploaded`, {})).status).toBe(401)
  })
})

describe('GET /api/videos/:id/status', () => {
  it("returns the owner's video status", async () => {
    const { cookie, channelId } = await signUp()
    const id = await insertVideo(channelId, 'processing')

    const res = await callApi(`/api/videos/${id}/status`, { headers: { cookie } })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id, status: 'processing' })
  })

  it("answers 404 for someone else's video and 401 when signed out", async () => {
    const owner = await signUp()
    const other = await signUp()
    const id = await insertVideo(owner.channelId, 'ready')

    expect(
      (await callApi(`/api/videos/${id}/status`, { headers: { cookie: other.cookie } })).status,
    ).toBe(404)
    expect((await callApi(`/api/videos/${id}/status`)).status).toBe(401)
  })
})
