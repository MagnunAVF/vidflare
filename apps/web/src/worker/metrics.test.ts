import { runDurableObjectAlarm } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getDb } from './db/client'
import { videos } from './db/schema'
import { uuidv7 } from './lib/id'
import { telemetry } from './lib/telemetry'
import { handleStreamEvents } from './queue/stream-events'
import { callApi, mockFetch, postJson, signUp, STREAM_API_URL, TURNSTILE_URL } from './test/helpers'

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

// Records metrics from now on (call after signUp(), which restores all mocks).
function recordMetrics() {
  const count = vi.spyOn(telemetry, 'count')
  const distribution = vi.spyOn(telemetry, 'distribution')
  return {
    counts: () => count.mock.calls.map(([name, attributes]) => ({ name, attributes })),
    distributions: () =>
      distribution.mock.calls.map(([name, value, unit, attributes]) => ({
        name,
        value,
        unit,
        attributes,
      })),
  }
}

async function insertVideo(status: 'uploading' | 'processing' | 'ready', createdAt = Date.now()) {
  const { channelId, cookie } = await signUp()
  const id = uuidv7()
  await getDb(env.DB)
    .insert(videos)
    .values({
      id,
      channelId,
      streamUid: `metric-${id}`,
      title: 'Metrics',
      status,
      createdAt,
    })
  return { id, uid: `metric-${id}`, cookie }
}

const queueBatch = (...bodies: unknown[]) =>
  ({
    queue: 'stream-events',
    messages: bodies.map((body, i) => ({
      id: `m${i}`,
      timestamp: new Date(),
      attempts: 1,
      body,
      ack: vi.fn(),
      retry: vi.fn(),
    })),
  }) as unknown as MessageBatch

const streamEvent = (uid: string, videoId: string, state: 'ready' | 'error') => ({
  uid,
  videoId,
  env: 'local',
  state,
  durationS: state === 'ready' ? 30 : null,
  thumbnailUrl: null,
  errorReasonCode: state === 'error' ? 'ERR_NON_VIDEO' : null,
})

describe('metrics', () => {
  it('upload.started counts uploads that begin, not refused ones', async () => {
    const { cookie } = await signUp()
    const m = recordMetrics()
    const uid = `metric-up-${Date.now()}`
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
      title: 'Metric',
      description: '',
      visibility: 'public',
      sizeBytes: 1000,
      turnstileToken: 't',
    }
    expect((await postJson('/api/videos/uploads', body, { cookie })).status).toBe(201)
    expect((await postJson('/api/videos/uploads', {}, { cookie })).status).toBe(400)
    expect(m.counts()).toEqual([{ name: 'upload.started', attributes: undefined }])
  })

  it('upload.ready with video.processing_time, and upload.failed with the reason, once each', async () => {
    const ready = await insertVideo('processing', Date.now() - 90_000)
    const failed = await insertVideo('processing')
    const m = recordMetrics()
    const readyEvent = streamEvent(ready.uid, ready.id, 'ready')
    // The redelivered ready event changes nothing and must not count again.
    await handleStreamEvents(
      queueBatch(readyEvent, readyEvent, streamEvent(failed.uid, failed.id, 'error')),
      env,
    )

    expect(m.counts()).toEqual([
      { name: 'upload.ready', attributes: { source: 'webhook' } },
      { name: 'upload.failed', attributes: { source: 'webhook', reason: 'ERR_NON_VIDEO' } },
    ])
    const [processing] = m.distributions()
    expect(processing).toMatchObject({
      name: 'video.processing_time',
      unit: 'millisecond',
      attributes: { source: 'webhook' },
    })
    expect(processing!.value).toBeGreaterThanOrEqual(90_000)
  })

  it('counts outcomes found by the studio re-check as source recheck', async () => {
    const video = await insertVideo('processing')
    const m = recordMetrics()
    mockFetch({
      [STREAM_API_URL]: () =>
        Response.json({
          success: true,
          result: { uid: video.uid, status: { state: 'ready' }, readyToStream: true, duration: 30 },
        }),
    })
    const res = await callApi(`/api/studio/videos/${video.id}/recheck`, {
      method: 'POST',
      headers: { cookie: video.cookie },
    })
    expect(res.status).toBe(200)
    expect(m.counts()).toEqual([{ name: 'upload.ready', attributes: { source: 'recheck' } }])
  })

  it('webhook.signature_invalid counts unsigned webhooks', async () => {
    const m = recordMetrics()
    const res = await callApi('/api/webhooks/stream', {
      method: 'POST',
      headers: { 'Webhook-Signature': 'time=1,sig1=nope', 'content-type': 'application/json' },
      body: '{}',
    })
    expect(res.status).toBe(401)
    expect(m.counts()).toEqual([{ name: 'webhook.signature_invalid', attributes: undefined }])
  })

  it('auth.login_failed counts wrong credentials and rate-limited attempts', async () => {
    const m = recordMetrics()
    const ip = `10.${Array.from(crypto.getRandomValues(new Uint8Array(3))).join('.')}`
    for (let i = 0; i < 11; i++) {
      await postJson(
        '/api/auth/login',
        { email: `nobody_${i}_${Date.now()}@example.com`, password: 'wrong-password' },
        { 'CF-Connecting-IP': ip },
      )
    }
    const reasons = m.counts().map((c) => c.attributes?.reason)
    expect(reasons.filter((r) => r === 'invalid_credentials')).toHaveLength(10)
    expect(reasons.filter((r) => r === 'rate_limited')).toHaveLength(1)
    expect(new Set(m.counts().map((c) => c.name))).toEqual(new Set(['auth.login_failed']))
  })

  it('video.view_recorded counts deduped views, and stats.flush_rows the views each flush wrote', async () => {
    const video = await insertVideo('ready')
    const m = recordMetrics()
    const stub = env.VIDEO_STATS.get(env.VIDEO_STATS.idFromName(video.id))
    await stub.recordView({ videoId: video.id, viewerKey: 'a', baseViewCount: 0 })
    await stub.recordView({ videoId: video.id, viewerKey: 'a', baseViewCount: 0 }) // deduped
    await stub.recordView({ videoId: video.id, viewerKey: 'b', baseViewCount: 0 })
    expect(await runDurableObjectAlarm(stub)).toBe(true)

    expect(m.counts()).toEqual([
      { name: 'video.view_recorded', attributes: undefined },
      { name: 'video.view_recorded', attributes: undefined },
    ])
    expect(m.distributions()).toEqual([
      { name: 'stats.flush_rows', value: 2, unit: 'none', attributes: undefined },
    ])
  })
})
