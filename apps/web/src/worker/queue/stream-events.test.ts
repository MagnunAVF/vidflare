import { env } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getDb } from '../db/client'
import { videos } from '../db/schema'
import { uuidv7 } from '../lib/id'
import type { StreamEvent } from '../lib/stream-events'
import { signUp } from '../test/helpers'
import { applyStreamEvent, handleStreamEvents } from './stream-events'

const db = getDb(env.DB)

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

let seq = 0
async function insertVideo(status: 'uploading' | 'processing' | 'ready' | 'error' = 'processing') {
  const { channelId } = await signUp()
  const id = uuidv7()
  const uid = `uid${Date.now().toString(36)}${(seq++).toString(36)}`
  await db
    .insert(videos)
    .values({ id, channelId, streamUid: uid, title: 'Clip', status, createdAt: 1 })
  return { id, uid }
}

const readyEvent = (uid: string, videoId: string | null): StreamEvent => ({
  uid,
  videoId,
  env: 'local',
  state: 'ready',
  durationS: 312,
  thumbnailUrl: `https://customer-example.cloudflarestream.com/${uid}/thumbnails/thumbnail.jpg`,
  errorReasonCode: null,
})
const errorEvent = (uid: string, videoId: string | null): StreamEvent => ({
  ...readyEvent(uid, videoId),
  state: 'error',
  durationS: null,
  thumbnailUrl: null,
  errorReasonCode: 'ERR_NON_VIDEO',
})

const getVideo = (id: string) => db.select().from(videos).where(eq(videos.id, id)).get()

describe('applyStreamEvent', () => {
  it('marks a processing video ready with duration, thumbnail and published_at', async () => {
    const { id, uid } = await insertVideo('processing')

    expect(await applyStreamEvent(db, readyEvent(uid, id), 1_800_000_000_000)).toBe('applied')

    expect(await getVideo(id)).toMatchObject({
      status: 'ready',
      durationS: 312,
      thumbnailUrl: readyEvent(uid, id).thumbnailUrl,
      publishedAt: 1_800_000_000_000,
    })
  })

  it('also handles a ready event that arrives before the browser reported the upload', async () => {
    const { id, uid } = await insertVideo('uploading')
    expect(await applyStreamEvent(db, readyEvent(uid, id))).toBe('applied')
    expect((await getVideo(id))?.status).toBe('ready')
  })

  it('is idempotent: a redelivered ready event changes nothing', async () => {
    const { id, uid } = await insertVideo('processing')
    await applyStreamEvent(db, readyEvent(uid, id), 1_000)

    expect(await applyStreamEvent(db, readyEvent(uid, id), 2_000)).toBe('unchanged')
    expect((await getVideo(id))?.publishedAt).toBe(1_000)
  })

  it('marks a failed video as error, but never a ready one', async () => {
    const failing = await insertVideo('processing')
    expect(await applyStreamEvent(db, errorEvent(failing.uid, failing.id))).toBe('applied')
    expect(await getVideo(failing.id)).toMatchObject({ status: 'error', publishedAt: null })

    const ready = await insertVideo('ready')
    expect(await applyStreamEvent(db, errorEvent(ready.uid, ready.id))).toBe('unchanged')
    expect((await getVideo(ready.id))?.status).toBe('ready')
  })

  it('ignores a uid this environment does not know', async () => {
    expect(await applyStreamEvent(db, readyEvent('not-in-this-d1', null))).toBe('unknown_uid')
  })

  it('ignores an event whose meta.videoId names another row', async () => {
    const { id, uid } = await insertVideo('processing')
    expect(await applyStreamEvent(db, readyEvent(uid, uuidv7()))).toBe('video_mismatch')
    expect((await getVideo(id))?.status).toBe('processing')
  })
})

// A batch with recorded ack/retry calls, as the Queues runtime would hand it over.
function batchOf(...bodies: unknown[]) {
  const messages = bodies.map((body, i) => ({
    id: `m${i}`,
    timestamp: new Date(),
    attempts: 1,
    body,
    ack: vi.fn(),
    retry: vi.fn(),
  }))
  const batch = {
    queue: 'stream-events',
    messages,
    ackAll: vi.fn(),
    retryAll: vi.fn(),
  } as unknown as MessageBatch<unknown>
  return { batch, messages }
}

describe('handleStreamEvents', () => {
  it('applies each message and acks it, including unknown uids and malformed bodies', async () => {
    const { id, uid } = await insertVideo('processing')
    const { batch, messages } = batchOf(readyEvent(uid, id), readyEvent('unknown-uid', null), {
      not: 'an event',
    })

    await handleStreamEvents(batch, env)

    expect((await getVideo(id))?.status).toBe('ready')
    for (const m of messages) {
      expect(m.ack).toHaveBeenCalledOnce()
      expect(m.retry).not.toHaveBeenCalled()
    }
  })

  it('retries a message when D1 fails, and only that one', async () => {
    const { batch, messages } = batchOf(readyEvent('any-uid', null))
    const brokenDb = {
      ...env,
      DB: {
        prepare: () => {
          throw new Error('D1 unavailable')
        },
      },
    } as unknown as Env

    await handleStreamEvents(batch, brokenDb)

    expect(messages[0]!.retry).toHaveBeenCalledOnce()
    expect(messages[0]!.ack).not.toHaveBeenCalled()
  })
})
