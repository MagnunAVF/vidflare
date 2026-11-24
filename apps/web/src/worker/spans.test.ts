import { runDurableObjectAlarm } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getDb } from './db/client'
import { videos } from './db/schema'
import { uuidv7 } from './lib/id'
import { telemetry } from './lib/telemetry'
import { handleStreamEvents } from './queue/stream-events'
import { callApi, mockFetch, postJson, signUp, STREAM_API_URL, TURNSTILE_URL } from './test/helpers'

type SpanOptions = { name: string; op?: string; attributes?: Record<string, unknown> }

// Records the spans opened from now on; they still run for real. Call it after signUp(), which
// restores all mocks.
function recordSpans() {
  const spy = vi.spyOn(telemetry, 'startSpan')
  return (name: string) =>
    (spy.mock.calls as unknown as [SpanOptions][])
      .map(([options]) => options)
      .filter((o) => o.name === name)
}

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

async function insertVideo(status: 'processing' | 'ready', viewCount = 0) {
  const { channelId } = await signUp()
  const id = uuidv7()
  await getDb(env.DB)
    .insert(videos)
    .values({
      id,
      channelId,
      streamUid: `span-${id}`,
      title: 'Span',
      status,
      viewCount,
      createdAt: Date.now(),
    })
  return id
}

describe('custom spans', () => {
  it('stream.create_upload wraps the Stream call when an upload starts', async () => {
    const { cookie } = await signUp()
    const spanNamed = recordSpans()
    const uid = `span-${Date.now()}`
    mockFetch({
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
    const body = {
      title: 'Span',
      description: '',
      visibility: 'public',
      sizeBytes: 1000,
      turnstileToken: 't',
    }
    const res = await postJson('/api/videos/uploads', body, { cookie })
    expect(res.status).toBe(201)
    const { videoId } = await res.json<{ videoId: string }>()

    expect(spanNamed('stream.create_upload')).toEqual([
      expect.objectContaining({
        op: 'http.client',
        attributes: expect.objectContaining({ 'video.id': videoId, 'upload.size_bytes': 1000 }),
      }),
    ])
  })

  it('queue.stream_event wraps each queue message, with the video id', async () => {
    const id = await insertVideo('processing')
    const spanNamed = recordSpans()
    const ready = {
      uid: `span-${id}`,
      videoId: id,
      env: 'local',
      state: 'ready',
      durationS: 10,
      thumbnailUrl: null,
      errorReasonCode: null,
    }
    const message = (n: number) => ({
      id: `m${n}`,
      timestamp: new Date(),
      attempts: 1,
      body: ready,
      ack: vi.fn(),
      retry: vi.fn(),
    })
    const batch = { queue: 'stream-events', messages: [message(1), message(2)] }
    await handleStreamEvents(batch as unknown as MessageBatch, env)

    const queueSpans = spanNamed('queue.stream_event')
    expect(queueSpans).toHaveLength(2)
    expect(queueSpans[0]?.attributes).toMatchObject({ 'video.id': id, 'stream.state': 'ready' })
  })

  it('names each request by its route pattern, not its URL', async () => {
    const id = await insertVideo('ready')
    const nameRequest = vi.spyOn(telemetry, 'nameRequest')
    await callApi(`/api/videos/${id}`)
    await callApi(`/api/search?q=private`)
    expect(nameRequest.mock.calls).toEqual([
      ['GET', '/api/videos/:id'],
      ['GET', '/api/search'],
    ])
  })

  it('stats.flush wraps the Durable Object’s write to D1', async () => {
    const id = await insertVideo('ready', 5)
    const spanNamed = recordSpans()
    const stub = env.VIDEO_STATS.get(env.VIDEO_STATS.idFromName(id))
    await stub.recordView({ videoId: id, viewerKey: 'span-viewer', baseViewCount: 5 })
    expect(await runDurableObjectAlarm(stub)).toBe(true)

    expect(spanNamed('stats.flush')).toEqual([
      expect.objectContaining({ attributes: expect.objectContaining({ 'video.id': id }) }),
    ])
  })
})
