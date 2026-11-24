import { env } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getDb } from './db/client'
import { videos } from './db/schema'
import { onError } from './lib/errors'
import { handleStreamEvents } from './queue/stream-events'
import { webhooks } from './routes/webhooks'
import errorFixture from './test/fixtures/stream-webhook-error.json'
import readyFixture from './test/fixtures/stream-webhook-ready.json'
import {
  callApi,
  mockFetch,
  postJson,
  signStreamWebhook,
  signUp,
  STREAM_API_URL,
  TURNSTILE_URL,
} from './test/helpers'
import type { AppEnv } from './types'

// One video through the whole pipeline, each step through the real code: the upload routes,
// the signed webhook handler (with a stand-in queue that keeps what it was sent), the queue
// consumer, and the public API. The unit tests cover each step on its own; this covers the
// hand-offs between them.

const db = getDb(env.DB)
const SECRET = 'lifecycle-webhook-secret'

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

const statusOf = async (id: string) =>
  db
    .select({ status: videos.status, publishedAt: videos.publishedAt })
    .from(videos)
    .where(eq(videos.id, id))
    .get()

// Creates an upload through the API (Stream and Turnstile stubbed) and returns its ids.
async function startUpload(title: string) {
  const user = await signUp()
  const uid = `life${crypto.randomUUID().replaceAll('-', '')}`.slice(0, 32)
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
  const res = await postJson(
    '/api/videos/uploads',
    { title, description: '', visibility: 'public', sizeBytes: 72169, turnstileToken: 't' },
    { cookie: user.cookie },
  )
  vi.restoreAllMocks()
  expect(res.status).toBe(201)
  const { videoId } = await res.json<{ videoId: string }>()
  return { ...user, videoId, uid }
}

// Stream's webhook for this video (a recorded payload, re-tagged), signed and delivered to the
// real handler. Returns the queue messages it produced.
async function deliverWebhook(
  fixture: typeof readyFixture | typeof errorFixture,
  video: { uid: string; videoId: string },
) {
  const sent: unknown[] = []
  const bindings = {
    ...env,
    ENVIRONMENT: 'local',
    STREAM_WEBHOOK_SECRET: SECRET,
    EVENTS: { send: async (body: unknown) => void sent.push(body) },
  } as unknown as Env
  const app = new Hono<AppEnv>().onError(onError).route('/', webhooks)
  const body = JSON.stringify({
    ...fixture,
    uid: video.uid,
    meta: { env: 'local', videoId: video.videoId },
  })
  const res = await app.request(
    '/stream',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'Webhook-Signature': await signStreamWebhook(SECRET, body),
      },
      body,
    },
    bindings,
  )
  expect(res.status).toBe(200)
  return sent
}

// Runs the consumer on the messages, as the Queues runtime would; returns their ack/retry calls.
async function consume(bodies: unknown[]) {
  const messages = bodies.map((body, i) => ({
    id: `m${i}`,
    timestamp: new Date(),
    attempts: 1,
    body,
    ack: vi.fn(),
    retry: vi.fn(),
  }))
  await handleStreamEvents({ queue: 'stream-events', messages } as unknown as MessageBatch, env)
  return messages
}

const ids = async (path: string) =>
  (await (await callApi(path)).json<{ items: { id: string }[] }>()).items.map((v) => v.id)

describe('video lifecycle, end to end', () => {
  it('goes uploading → processing → ready, and only then shows up in public', async () => {
    const title = `Lifecycle harborlight ${Date.now()}`
    const video = await startUpload(title)
    const owner = { headers: { cookie: video.cookie } }

    // uploading: the owner sees it, nobody else does.
    expect(await statusOf(video.videoId)).toMatchObject({ status: 'uploading', publishedAt: null })
    expect((await callApi(`/api/videos/${video.videoId}`)).status).toBe(404)
    expect((await callApi(`/api/videos/${video.videoId}`, owner)).status).toBe(200)

    // The browser reports the bytes are in: processing.
    const uploaded = await postJson(
      `/api/videos/${video.videoId}/uploaded`,
      {},
      { cookie: video.cookie },
    )
    expect(await uploaded.json()).toMatchObject({ status: 'processing' })
    expect((await callApi(`/api/videos/${video.videoId}`)).status).toBe(404)

    // Stream's webhook → queue → consumer: ready.
    const messages = await deliverWebhook(readyFixture, video)
    expect(messages).toHaveLength(1)
    const [handled] = await consume(messages)
    expect(handled!.ack).toHaveBeenCalled()
    expect(handled!.retry).not.toHaveBeenCalled()

    const ready = await statusOf(video.videoId)
    expect(ready).toMatchObject({ status: 'ready' })
    expect(ready!.publishedAt).not.toBeNull()

    // Now public: watch page (with a player), home feed, search and the studio.
    const watch = await callApi(`/api/videos/${video.videoId}`)
    expect(watch.status).toBe(200)
    expect(await watch.json()).toMatchObject({
      status: 'ready',
      durationS: readyFixture.duration,
      playerUrl: expect.stringContaining(video.uid),
    })
    expect(await ids('/api/videos')).toContain(video.videoId)
    expect(await ids('/api/search?q=harborlight')).toContain(video.videoId)
    const studio = await callApi('/api/studio/videos', owner)
    expect(
      (await studio.json<{ items: { id: string; status: string }[] }>()).items.find(
        (v) => v.id === video.videoId,
      ),
    ).toMatchObject({ status: 'ready' })

    // Stream redelivers the same webhook: acked, nothing moves (published_at included).
    const [again] = await consume(await deliverWebhook(readyFixture, video))
    expect(again!.ack).toHaveBeenCalled()
    expect(await statusOf(video.videoId)).toEqual(ready)
  })

  it('ends in error when encoding fails, and a later ready event still wins', async () => {
    const video = await startUpload(`Lifecycle failure ${Date.now()}`)
    await postJson(`/api/videos/${video.videoId}/uploaded`, {}, { cookie: video.cookie })

    await consume(await deliverWebhook(errorFixture, video))
    expect(await statusOf(video.videoId)).toMatchObject({ status: 'error', publishedAt: null })
    expect((await callApi(`/api/videos/${video.videoId}`)).status).toBe(404)

    // A redelivered error changes nothing.
    await consume(await deliverWebhook(errorFixture, video))
    expect((await statusOf(video.videoId))?.status).toBe('error')

    // Stream re-encoded it after all: ready beats an earlier error.
    await consume(await deliverWebhook(readyFixture, video))
    expect((await statusOf(video.videoId))?.status).toBe('ready')
    expect((await callApi(`/api/videos/${video.videoId}`)).status).toBe(200)

    // A late "uploaded" from the browser never moves it back.
    const late = await postJson(
      `/api/videos/${video.videoId}/uploaded`,
      {},
      { cookie: video.cookie },
    )
    expect(await late.json()).toMatchObject({ status: 'ready' })
  })
})
