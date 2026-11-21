import { env } from 'cloudflare:workers'
import { eq, inArray } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getDb } from '../db/client'
import { videos } from '../db/schema'
import { mockFetch, signUp, STREAM_API_URL } from '../test/helpers'
import { uuidv7 } from './id'
import {
  ABANDONED_AFTER_MS,
  ORPHAN_AFTER_MS,
  reconcileVideos,
  STUCK_AFTER_MS,
  STUCK_BATCH,
} from './reconcile'

const db = getDb(env.DB)
const NOW = 1_900_000_000_000
const HOUR = 60 * 60 * 1000

beforeEach(async () => {
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  // D1 rows outlive a test within this file: settle earlier tests' in-flight rows so each test
  // sees only its own stuck videos.
  await db
    .update(videos)
    .set({ status: 'error' })
    .where(inArray(videos.status, ['uploading', 'processing']))
})
afterEach(() => vi.restoreAllMocks())

type Status = 'uploading' | 'processing' | 'ready' | 'error'
let seq = 0
async function addVideo(channelId: string, status: Status, ageMs: number) {
  const id = uuidv7()
  const uid = `rec${(seq++).toString(36)}${id.slice(-8)}`
  await db.insert(videos).values({
    id,
    channelId,
    streamUid: uid,
    title: 'Clip',
    status,
    createdAt: NOW - ageMs,
  })
  return { id, uid }
}

const statusOf = async (id: string) =>
  (await db.select({ status: videos.status }).from(videos).where(eq(videos.id, id)).get())?.status

// A fake Stream API: per-uid video states (missing uid → 404, 'fail' → 500), a library
// listing, and recorded deletes.
function fakeStream(opts: {
  states?: Record<string, string>
  library?: { uid: string; created: string; meta: Record<string, unknown> }[]
}) {
  const deleted: string[] = []
  const listCalls: string[] = []
  const requests = mockFetch({
    [STREAM_API_URL]: (req) => {
      const url = new URL(req.url)
      const uid = decodeURIComponent(url.pathname.split('/stream/')[1] ?? '')
      if (!uid) {
        listCalls.push(url.search)
        return Response.json({ success: true, result: opts.library ?? [] })
      }
      if (req.method === 'DELETE') {
        deleted.push(uid)
        return Response.json({ success: true })
      }
      const state = opts.states?.[uid]
      if (state === undefined) return Response.json({ success: false }, { status: 404 })
      if (state === 'fail') return Response.json({ success: false }, { status: 500 })
      return Response.json({
        success: true,
        result: {
          uid,
          status: { state },
          readyToStream: state === 'ready',
          duration: 42,
          thumbnail: `https://example.com/${uid}.jpg`,
          meta: {},
        },
      })
    },
  })
  return { deleted, listCalls, requests }
}

describe('reconcileVideos', () => {
  it('applies Stream’s state to videos stuck for over an hour, and leaves recent ones', async () => {
    const { channelId } = await signUp()
    const ready = await addVideo(channelId, 'processing', 2 * HOUR)
    const failed = await addVideo(channelId, 'processing', 2 * HOUR)
    const gone = await addVideo(channelId, 'uploading', 2 * HOUR)
    const encoding = await addVideo(channelId, 'uploading', 2 * HOUR)
    const recent = await addVideo(channelId, 'processing', STUCK_AFTER_MS - 60_000)
    const { requests } = fakeStream({
      states: { [ready.uid]: 'ready', [failed.uid]: 'error', [encoding.uid]: 'inprogress' },
    })

    const report = await reconcileVideos(env, NOW)

    expect(await statusOf(ready.id)).toBe('ready')
    expect(await statusOf(failed.id)).toBe('error')
    expect(await statusOf(gone.id)).toBe('error') // Stream no longer has it
    expect(await statusOf(encoding.id)).toBe('processing') // bytes are in: catch up
    expect(await statusOf(recent.id)).toBe('processing')
    expect(requests.some((r) => r.url.includes(recent.uid))).toBe(false)
    expect(report).toMatchObject({ checked: 4, updated: 4, abandoned: 0, failed: 0 })
  })

  it('deletes uploads never sent after a day and marks them failed', async () => {
    const { channelId } = await signUp()
    const abandoned = await addVideo(channelId, 'uploading', ABANDONED_AFTER_MS + HOUR)
    const slow = await addVideo(channelId, 'uploading', 2 * HOUR)
    const { deleted } = fakeStream({
      states: { [abandoned.uid]: 'pendingupload', [slow.uid]: 'pendingupload' },
    })

    const report = await reconcileVideos(env, NOW)

    expect(deleted).toEqual([abandoned.uid])
    expect(await statusOf(abandoned.id)).toBe('error')
    expect(await statusOf(slow.id)).toBe('uploading')
    expect(report).toMatchObject({ checked: 2, abandoned: 1 })
  })

  it(`checks at most ${STUCK_BATCH} videos per run, oldest first`, async () => {
    const { channelId } = await signUp()
    const rows = []
    for (let i = 0; i < STUCK_BATCH + 3; i++) {
      rows.push(await addVideo(channelId, 'processing', 2 * HOUR + i * 1000))
    }
    const { requests } = fakeStream({})
    const report = await reconcileVideos(env, NOW)

    expect(report.checked).toBe(STUCK_BATCH)
    // The three youngest wait for the next night.
    for (const young of rows.slice(0, 3)) {
      expect(requests.some((r) => r.url.includes(young.uid))).toBe(false)
    }
  })

  it('keeps going after one video fails, then fails the run', async () => {
    const { channelId } = await signUp()
    const broken = await addVideo(channelId, 'processing', 3 * HOUR)
    const fine = await addVideo(channelId, 'processing', 2 * HOUR)
    fakeStream({ states: { [broken.uid]: 'fail', [fine.uid]: 'ready' } })

    await expect(reconcileVideos(env, NOW)).rejects.toThrow('1 step(s) failed')
    expect(await statusOf(fine.id)).toBe('ready')
    expect(await statusOf(broken.id)).toBe('processing')
  })

  it('never lists the library outside stage', async () => {
    const { listCalls } = fakeStream({})
    await reconcileVideos(env, NOW)
    expect(listCalls).toEqual([])
  })

  it('on stage, deletes old stage-tagged Stream videos that have no row, and nothing else', async () => {
    const { channelId } = await signUp()
    const known = await addVideo(channelId, 'ready', 3 * 24 * HOUR)
    const old = new Date(NOW - ORPHAN_AFTER_MS - HOUR).toISOString()
    const fresh = new Date(NOW - HOUR).toISOString()
    const { deleted } = fakeStream({
      library: [
        { uid: 'orphan-stage', created: old, meta: { env: 'stage' } },
        { uid: known.uid, created: old, meta: { env: 'stage' } },
        { uid: 'fresh-stage', created: fresh, meta: { env: 'stage' } },
        { uid: 'prod-video', created: old, meta: { env: 'production' } },
        { uid: 'local-video', created: old, meta: { env: 'local' } },
        { uid: 'untagged', created: old, meta: {} },
      ],
    })

    const report = await reconcileVideos({ ...env, ENVIRONMENT: 'stage' }, NOW)

    expect(deleted).toEqual(['orphan-stage'])
    expect(report.orphansDeleted).toBe(1)
  })
})
