import { env } from 'cloudflare:workers'
import {
  CREATOR_STORAGE_MAX_S,
  UPLOAD_MAX_DURATION_S,
  UPLOAD_MIN_REMAINING_S,
} from '@vidflare/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getDb } from '../db/client'
import { videos } from '../db/schema'
import {
  callApi,
  mockFetch,
  postJson,
  signUp,
  STREAM_API_URL,
  TURNSTILE_URL,
} from '../test/helpers'
import { uuidv7 } from './id'
import { channelStorage, IN_FLIGHT_RESERVE_MS } from './storage'

const db = getDb(env.DB)
afterEach(() => vi.restoreAllMocks())

const NOW = 1_900_000_000_000
type Status = 'uploading' | 'processing' | 'ready' | 'error'

// One video per entry: [status, duration (ready only), age in ms].
async function addVideos(channelId: string, entries: [Status, number | null, number][]) {
  for (const [status, durationS, ageMs] of entries) {
    const id = uuidv7()
    await db.insert(videos).values({
      id,
      channelId,
      streamUid: `storage-${id}`,
      title: 'Clip',
      status,
      durationS,
      createdAt: NOW - ageMs,
      publishedAt: status === 'ready' ? NOW - ageMs : null,
    })
  }
}

const uploadBody = () => ({
  title: 'A short clip',
  description: '',
  visibility: 'public',
  sizeBytes: 1024 * 1024,
  turnstileToken: 'token',
})

describe('channelStorage', () => {
  it('counts ready durations and recent in-flight uploads at the per-upload maximum', async () => {
    const { channelId } = await signUp()
    const other = await signUp()
    await addVideos(channelId, [
      ['ready', 600, 0],
      ['ready', 300, 0],
      ['uploading', null, 60_000], // recent: holds 15 min
      ['processing', null, 60_000], // recent: holds 15 min
      ['processing', null, IN_FLIGHT_RESERVE_MS + 1], // stale: holds nothing
      ['error', null, 0], // failed: nothing stored
    ])
    await addVideos(other.channelId, [['ready', 3000, 0]]) // someone else's

    const used = 600 + 300 + 2 * UPLOAD_MAX_DURATION_S
    expect(await channelStorage(db, channelId, NOW)).toEqual({
      usedS: used,
      limitS: CREATOR_STORAGE_MAX_S,
      remainingS: CREATOR_STORAGE_MAX_S - used,
      maxUploadS: UPLOAD_MAX_DURATION_S,
    })
  })

  it('shrinks the next upload to what is left, then refuses it', async () => {
    const { channelId } = await signUp()
    await addVideos(channelId, [['ready', CREATOR_STORAGE_MAX_S - 300, 0]])
    expect((await channelStorage(db, channelId, NOW)).maxUploadS).toBe(300)

    await addVideos(channelId, [['ready', 300 - UPLOAD_MIN_REMAINING_S + 1, 0]])
    const full = await channelStorage(db, channelId, NOW)
    expect(full.remainingS).toBe(UPLOAD_MIN_REMAINING_S - 1)
    expect(full.maxUploadS).toBe(0)
  })
})

describe('GET /api/studio/storage', () => {
  it('returns the signed-in creator’s budget', async () => {
    const { cookie, channelId } = await signUp()
    await addVideos(channelId, [['ready', 120, 0]])
    const res = await callApi('/api/studio/storage', { headers: { cookie } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      usedS: 120,
      limitS: CREATOR_STORAGE_MAX_S,
      remainingS: CREATOR_STORAGE_MAX_S - 120,
      maxUploadS: UPLOAD_MAX_DURATION_S,
    })
  })

  it('requires a session', async () => {
    expect((await callApi('/api/studio/storage')).status).toBe(401)
  })
})

describe('POST /api/videos/uploads and the storage budget', () => {
  it('refuses a full creator before Turnstile and Stream', async () => {
    const { cookie, channelId } = await signUp()
    await addVideos(channelId, [['ready', CREATOR_STORAGE_MAX_S, 0]])
    const requests = mockFetch({})
    const res = await postJson('/api/videos/uploads', uploadBody(), { cookie })
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: 'storage_quota_exceeded' })
    expect(requests).toHaveLength(0)
  })

  it('caps the Stream upload at what is left', async () => {
    const { cookie, channelId } = await signUp()
    await addVideos(channelId, [['ready', CREATOR_STORAGE_MAX_S - 300, 0]])
    const uid = `storage-uid-${Date.now()}`
    const requests = mockFetch({
      [TURNSTILE_URL]: () => Response.json({ success: true }),
      [STREAM_API_URL]: () =>
        new Response(null, {
          status: 201,
          headers: {
            Location: `https://upload.videodelivery.net/tus/${uid}`,
            'stream-media-id': uid,
          },
        }),
    })
    const res = await postJson('/api/videos/uploads', uploadBody(), { cookie })
    expect(res.status).toBe(201)

    const create = requests.find((r) => r.url.startsWith(STREAM_API_URL))!
    const metadata = create.headers.get('Upload-Metadata') ?? ''
    const maxDuration = metadata
      .split(',')
      .map((pair) => pair.split(' '))
      .find(([key]) => key === 'maxDurationSeconds')
    expect(atob(maxDuration![1]!)).toBe('300')
  })
})
