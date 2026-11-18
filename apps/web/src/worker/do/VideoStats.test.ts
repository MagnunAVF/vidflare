import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { getDb } from '../db/client'
import { videos } from '../db/schema'
import { uuidv7 } from '../lib/id'
import { signUp } from '../test/helpers'
import { VIEW_DEDUPE_WINDOW_MS, VIEW_FLUSH_INTERVAL_MS } from './VideoStats'

const db = getDb(env.DB)

let seq = 0
async function insertVideo(viewCount = 0) {
  const { channelId } = await signUp()
  const id = uuidv7()
  await db.insert(videos).values({
    id,
    channelId,
    streamUid: `statsuid${Date.now().toString(36)}${(seq++).toString(36)}`,
    title: 'Clip',
    status: 'ready',
    viewCount,
    createdAt: Date.now(),
    publishedAt: Date.now(),
  })
  return id
}

const statsFor = (videoId: string) => env.VIDEO_STATS.get(env.VIDEO_STATS.idFromName(videoId))
const viewCountInD1 = async (id: string) =>
  (await db.select({ n: videos.viewCount }).from(videos).where(eq(videos.id, id)).get())?.n

describe('VideoStats.recordView', () => {
  it('starts from the D1 count and counts each viewer once', async () => {
    const id = await insertVideo(41)
    const stub = statsFor(id)

    expect(await stub.recordView({ videoId: id, viewerKey: 'a', baseViewCount: 41 })).toEqual({
      recorded: true,
      viewCount: 42,
    })
    expect(await stub.recordView({ videoId: id, viewerKey: 'a', baseViewCount: 41 })).toEqual({
      recorded: false,
      viewCount: 42,
    })
    expect(await stub.recordView({ videoId: id, viewerKey: 'b', baseViewCount: 41 })).toEqual({
      recorded: true,
      viewCount: 43,
    })
  })

  it('counts the same viewer again once the dedupe window has passed', async () => {
    const id = await insertVideo()
    const stub = statsFor(id)
    const t0 = Date.now()
    await runInDurableObject(stub, async (instance) => {
      const input = { videoId: id, viewerKey: 'a', baseViewCount: 0 }
      expect((await instance.recordView(input, t0)).recorded).toBe(true)
      expect((await instance.recordView(input, t0 + VIEW_DEDUPE_WINDOW_MS - 1)).recorded).toBe(
        false,
      )
      expect(await instance.recordView(input, t0 + VIEW_DEDUPE_WINDOW_MS + 1)).toEqual({
        recorded: true,
        viewCount: 2,
      })
    })
  })

  it('never counts below a D1 total that moved ahead', async () => {
    const id = await insertVideo(5)
    const stub = statsFor(id)
    await stub.recordView({ videoId: id, viewerKey: 'a', baseViewCount: 5 })
    expect(await stub.recordView({ videoId: id, viewerKey: 'b', baseViewCount: 100 })).toEqual({
      recorded: true,
      viewCount: 101,
    })
  })

  it('schedules one flush alarm about a minute out', async () => {
    const id = await insertVideo()
    const stub = statsFor(id)
    const before = Date.now()
    await stub.recordView({ videoId: id, viewerKey: 'a', baseViewCount: 0 })
    const first = await runInDurableObject(stub, (_i, state) => state.storage.getAlarm())
    await stub.recordView({ videoId: id, viewerKey: 'b', baseViewCount: 0 })
    const second = await runInDurableObject(stub, (_i, state) => state.storage.getAlarm())

    expect(first).toBeGreaterThanOrEqual(before + VIEW_FLUSH_INTERVAL_MS)
    expect(first).toBeLessThanOrEqual(Date.now() + VIEW_FLUSH_INTERVAL_MS)
    expect(second).toBe(first)
  })
})

describe('VideoStats alarm (flush to D1)', () => {
  it('writes the total to D1 only on flush, and a repeat flush changes nothing', async () => {
    const id = await insertVideo(10)
    const stub = statsFor(id)
    await stub.recordView({ videoId: id, viewerKey: 'a', baseViewCount: 10 })
    await stub.recordView({ videoId: id, viewerKey: 'b', baseViewCount: 10 })
    expect(await viewCountInD1(id)).toBe(10)

    expect(await runDurableObjectAlarm(stub)).toBe(true)
    expect(await viewCountInD1(id)).toBe(12)

    // Nothing new: no alarm left, and forcing a flush again keeps the count.
    expect(await runDurableObjectAlarm(stub)).toBe(false)
    await runInDurableObject(stub, (instance) => instance.alarm())
    expect(await viewCountInD1(id)).toBe(12)
  })

  it('keeps counting after a flush and flushes the new total next time', async () => {
    const id = await insertVideo()
    const stub = statsFor(id)
    await stub.recordView({ videoId: id, viewerKey: 'a', baseViewCount: 0 })
    await runDurableObjectAlarm(stub)
    await stub.recordView({ videoId: id, viewerKey: 'b', baseViewCount: 1 })
    await stub.recordView({ videoId: id, viewerKey: 'c', baseViewCount: 1 })
    expect(await viewCountInD1(id)).toBe(1)

    expect(await runDurableObjectAlarm(stub)).toBe(true)
    expect(await viewCountInD1(id)).toBe(3)
  })

  it('never lowers a D1 count that is already higher', async () => {
    const id = await insertVideo()
    const stub = statsFor(id)
    await stub.recordView({ videoId: id, viewerKey: 'a', baseViewCount: 0 })
    await db.update(videos).set({ viewCount: 50 }).where(eq(videos.id, id))

    await runDurableObjectAlarm(stub)
    expect(await viewCountInD1(id)).toBe(50)
  })

  it('clears its storage when the video was deleted', async () => {
    const id = await insertVideo()
    const stub = statsFor(id)
    await stub.recordView({ videoId: id, viewerKey: 'a', baseViewCount: 0 })
    await db.delete(videos).where(eq(videos.id, id))

    await runDurableObjectAlarm(stub)
    const counts = await runInDurableObject(stub, (_i, state) => ({
      viewers: state.storage.sql.exec('SELECT count(*) AS n FROM viewers').one().n,
      stats: state.storage.sql.exec('SELECT count(*) AS n FROM stats').one().n,
    }))
    expect(counts).toEqual({ viewers: 0, stats: 0 })
    expect(await runInDurableObject(stub, (_i, state) => state.storage.getAlarm())).toBeNull()
  })

  it('prunes viewers older than the dedupe window on flush', async () => {
    const id = await insertVideo()
    const stub = statsFor(id)
    const old = Date.now() - VIEW_DEDUPE_WINDOW_MS - 1000
    await runInDurableObject(stub, async (instance) => {
      await instance.recordView({ videoId: id, viewerKey: 'old', baseViewCount: 0 }, old)
      await instance.recordView({ videoId: id, viewerKey: 'new', baseViewCount: 0 })
    })

    await runDurableObjectAlarm(stub)
    const keys = await runInDurableObject(stub, (_i, state) =>
      state.storage.sql
        .exec<{ key: string }>('SELECT key FROM viewers ORDER BY key')
        .toArray()
        .map((r) => r.key),
    )
    expect(keys).toEqual(['new'])
    expect(await viewCountInD1(id)).toBe(2)
  })
})
