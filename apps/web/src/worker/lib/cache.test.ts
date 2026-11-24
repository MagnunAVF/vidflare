import { env } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getDb } from '../db/client'
import { channels, videos } from '../db/schema'
import { handleStreamEvents } from '../queue/stream-events'
import { callApi, signUp } from '../test/helpers'
import { cacheKeys } from './cache'
import { encodeCursor } from './cursor'
import { uuidv7 } from './id'

const db = getDb(env.DB)

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

// A signed-up creator with one video (ready and public unless overridden).
async function creatorWithVideo(overrides: Partial<typeof videos.$inferInsert> = {}) {
  const user = await signUp()
  const channel = await db
    .select({ handle: channels.handle })
    .from(channels)
    .where(eq(channels.id, user.channelId))
    .get()
  const id = uuidv7()
  await db.insert(videos).values({
    id,
    channelId: user.channelId,
    streamUid: `cache-${id}`,
    title: 'Original title',
    status: 'ready',
    visibility: 'public',
    createdAt: Date.now(),
    publishedAt: Date.now(),
    ...overrides,
  })
  return { ...user, handle: channel!.handle, videoId: id, streamUid: `cache-${id}` }
}

// The KV write runs after the response (waitUntil), so wait for it.
const stored = (key: string) =>
  vi.waitFor(async () => {
    const value = await env.CACHE.get(key, 'json')
    if (value === null) throw new Error(`${key} not cached yet`)
    return value
  })

const titleOf = async (res: Response) => (await res.json<{ title: string }>()).title
const feedIds = async (res: Response) =>
  (await res.json<{ items: { id: string }[] }>()).items.map((v) => v.id)

describe('KV cache', () => {
  it('serves a signed-out watch page from KV after the first request', async () => {
    const { videoId } = await creatorWithVideo()
    const first = await callApi(`/api/videos/${videoId}`)
    expect(first.headers.get('X-Cache')).toBe('MISS')
    expect(await stored(cacheKeys.video(videoId))).toMatchObject({ id: videoId, isOwner: false })

    // Even a D1 change the API didn't make is hidden until the entry expires or is purged.
    await db.update(videos).set({ title: 'Changed behind the API' }).where(eq(videos.id, videoId))
    const second = await callApi(`/api/videos/${videoId}`)
    expect(second.headers.get('X-Cache')).toBe('HIT')
    expect(await titleOf(second)).toBe('Original title')
  })

  it('never caches per-viewer responses or videos that are not ready', async () => {
    const { videoId, cookie } = await creatorWithVideo({ status: 'processing', publishedAt: null })
    // The owner sees the processing video, straight from D1.
    const own = await callApi(`/api/videos/${videoId}`, { headers: { cookie } })
    expect(own.status).toBe(200)
    expect(own.headers.get('X-Cache')).toBeNull()
    // Everyone else gets a 404, which isn't stored.
    expect((await callApi(`/api/videos/${videoId}`)).status).toBe(404)
    expect(await env.CACHE.get(cacheKeys.video(videoId))).toBeNull()
  })

  it('caches only the first page of a listing', async () => {
    const { handle } = await creatorWithVideo()
    expect((await callApi('/api/videos')).headers.get('X-Cache')).toBe('MISS')
    await stored(cacheKeys.homeFeed())
    expect((await callApi('/api/videos')).headers.get('X-Cache')).toBe('HIT')

    const channelPage = await callApi(`/api/channels/${handle}/videos`)
    expect(channelPage.headers.get('X-Cache')).toBe('MISS')
    await stored(cacheKeys.channelVideos(handle))
    expect((await callApi(`/api/channels/${handle}/videos`)).headers.get('X-Cache')).toBe('HIT')

    const cursor = encodeCursor({ at: Date.now(), id: uuidv7() })
    const later = await callApi(`/api/videos?cursor=${cursor}`)
    expect(later.status).toBe(200)
    expect(later.headers.get('X-Cache')).toBeNull()
  })

  it('purges the watch page and listings when the owner edits or deletes a video', async () => {
    const { videoId, handle, cookie } = await creatorWithVideo()
    await callApi(`/api/videos/${videoId}`)
    await callApi('/api/videos')
    await callApi(`/api/channels/${handle}/videos`)
    await stored(cacheKeys.video(videoId))
    await stored(cacheKeys.homeFeed())
    await stored(cacheKeys.channelVideos(handle))

    const edit = await callApi(`/api/videos/${videoId}`, {
      method: 'PATCH',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Edited title', visibility: 'unlisted' }),
    })
    expect(edit.status).toBe(200)
    const watch = await callApi(`/api/videos/${videoId}`)
    expect(watch.headers.get('X-Cache')).toBe('MISS')
    expect(await titleOf(watch)).toBe('Edited title')
    // Now unlisted: gone from both listings at once.
    expect(await feedIds(await callApi('/api/videos'))).not.toContain(videoId)
    expect(await feedIds(await callApi(`/api/channels/${handle}/videos`))).not.toContain(videoId)

    await stored(cacheKeys.video(videoId))
    const del = await callApi(`/api/videos/${videoId}`, { method: 'DELETE', headers: { cookie } })
    expect(del.status).toBe(204)
    expect((await callApi(`/api/videos/${videoId}`)).status).toBe(404)
  })

  it('purges the listings when the queue consumer publishes a video', async () => {
    const { videoId, streamUid, handle } = await creatorWithVideo({
      status: 'processing',
      publishedAt: null,
    })
    await callApi('/api/videos')
    await callApi(`/api/channels/${handle}/videos`)
    await stored(cacheKeys.homeFeed())
    await stored(cacheKeys.channelVideos(handle))

    const message = {
      id: 'm1',
      timestamp: new Date(),
      attempts: 1,
      body: {
        uid: streamUid,
        videoId,
        env: 'local',
        state: 'ready',
        durationS: 60,
        thumbnailUrl: null,
        errorReasonCode: null,
      },
      ack: vi.fn(),
      retry: vi.fn(),
    }
    const batch = { queue: 'stream-events', messages: [message] } as unknown as MessageBatch
    await handleStreamEvents(batch, env)
    expect(message.ack).toHaveBeenCalled()

    expect(await feedIds(await callApi('/api/videos'))).toContain(videoId)
    expect(await feedIds(await callApi(`/api/channels/${handle}/videos`))).toContain(videoId)
  })

  it('purges both handles on a channel rename', async () => {
    const { handle, cookie } = await creatorWithVideo()
    expect((await callApi(`/api/channels/${handle}`)).headers.get('X-Cache')).toBe('MISS')
    await stored(cacheKeys.channel(handle))

    const newHandle = `${handle.slice(0, 20)}_new`
    const rename = await callApi('/api/me', {
      method: 'PATCH',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ handle: newHandle, name: 'Renamed' }),
    })
    expect(rename.status).toBe(200)
    expect((await callApi(`/api/channels/${handle}`)).status).toBe(404)
    const renamed = await callApi(`/api/channels/${newHandle}`)
    expect(renamed.status).toBe(200)
    expect((await renamed.json<{ name: string }>()).name).toBe('Renamed')
  })
})
