import { env } from 'cloudflare:workers'
import { and, eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getDb } from '../db/client'
import { likes, videos } from '../db/schema'
import { uuidv7 } from '../lib/id'
import { callApi, signUp } from '../test/helpers'

const db = getDb(env.DB)

afterEach(() => vi.restoreAllMocks())

let seq = 0
async function insertVideo(
  channelId: string,
  status: 'uploading' | 'processing' | 'ready' | 'error' = 'ready',
) {
  const id = uuidv7()
  await db.insert(videos).values({
    id,
    channelId,
    streamUid: `likeuid${Date.now().toString(36)}${(seq++).toString(36)}`,
    title: 'Clip',
    status,
    createdAt: Date.now(),
    publishedAt: status === 'ready' ? Date.now() : null,
  })
  return id
}

const like = (id: string, cookie?: string) =>
  callApi(`/api/videos/${id}/like`, { method: 'PUT', headers: cookie ? { cookie } : {} })
const unlike = (id: string, cookie?: string) =>
  callApi(`/api/videos/${id}/like`, { method: 'DELETE', headers: cookie ? { cookie } : {} })

const likeCount = async (id: string) =>
  (await db.select({ n: videos.likeCount }).from(videos).where(eq(videos.id, id)).get())?.n

describe('PUT /api/videos/:id/like', () => {
  it('requires a session', async () => {
    const { channelId } = await signUp()
    const id = await insertVideo(channelId)
    expect((await like(id)).status).toBe(401)
  })

  it('likes once: repeat likes keep one row and the same count', async () => {
    const { channelId } = await signUp()
    const viewer = await signUp()
    const id = await insertVideo(channelId)

    const first = await like(id, viewer.cookie)
    expect(first.status).toBe(200)
    expect(await first.json()).toEqual({ liked: true, likeCount: 1 })

    const again = await like(id, viewer.cookie)
    expect(await again.json()).toEqual({ liked: true, likeCount: 1 })

    const rows = await db
      .select()
      .from(likes)
      .where(and(eq(likes.videoId, id), eq(likes.userId, viewer.userId)))
      .all()
    expect(rows).toHaveLength(1)
    expect(await likeCount(id)).toBe(1)
  })

  it('counts likes from different users', async () => {
    const { channelId } = await signUp()
    const a = await signUp()
    const b = await signUp()
    const id = await insertVideo(channelId)

    await like(id, a.cookie)
    const res = await like(id, b.cookie)
    expect(await res.json()).toEqual({ liked: true, likeCount: 2 })
  })

  it('answers 404 for a missing video or one that is not ready, without writing', async () => {
    const owner = await signUp()
    const viewer = await signUp()
    const processing = await insertVideo(owner.channelId, 'processing')

    expect((await like(processing, viewer.cookie)).status).toBe(404)
    expect((await like(processing, owner.cookie)).status).toBe(404)
    expect((await like(uuidv7(), viewer.cookie)).status).toBe(404)
    expect(await db.select().from(likes).where(eq(likes.videoId, processing)).all()).toEqual([])
    expect(await likeCount(processing)).toBe(0)
  })

  it('rejects an invalid id', async () => {
    const viewer = await signUp()
    expect((await like('not-an-id', viewer.cookie)).status).toBe(400)
  })
})

describe('DELETE /api/videos/:id/like', () => {
  it('requires a session', async () => {
    const { channelId } = await signUp()
    const id = await insertVideo(channelId)
    expect((await unlike(id)).status).toBe(401)
  })

  it('unlikes once: repeat unlikes never push the count below the real likes', async () => {
    const { channelId } = await signUp()
    const a = await signUp()
    const b = await signUp()
    const id = await insertVideo(channelId)
    await like(id, a.cookie)
    await like(id, b.cookie)

    const res = await unlike(id, a.cookie)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ liked: false, likeCount: 1 })

    // Again, and from a user who never liked it: nothing changes.
    expect(await (await unlike(id, a.cookie)).json()).toEqual({ liked: false, likeCount: 1 })
    const stranger = await signUp()
    expect(await (await unlike(id, stranger.cookie)).json()).toEqual({
      liked: false,
      likeCount: 1,
    })
    expect(await likeCount(id)).toBe(1)
  })

  it('answers 404 for a missing video', async () => {
    const viewer = await signUp()
    expect((await unlike(uuidv7(), viewer.cookie)).status).toBe(404)
  })
})

describe('GET /api/videos/:id likedByMe', () => {
  it("reflects the signed-in viewer's like and is false when signed out", async () => {
    const { channelId } = await signUp()
    const viewer = await signUp()
    const id = await insertVideo(channelId)

    const get = async (cookie?: string) =>
      await (
        await callApi(`/api/videos/${id}`, { headers: cookie ? { cookie } : {} })
      ).json<{
        likedByMe: boolean
        likeCount: number
      }>()

    expect(await get(viewer.cookie)).toMatchObject({ likedByMe: false, likeCount: 0 })
    await like(id, viewer.cookie)
    expect(await get(viewer.cookie)).toMatchObject({ likedByMe: true, likeCount: 1 })
    expect(await get()).toMatchObject({ likedByMe: false, likeCount: 1 })
  })
})
