import { COMMENTS_PAGE_SIZE } from '@vidflare/shared'
import { env } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getDb } from '../db/client'
import { comments, videos } from '../db/schema'
import { uuidv7 } from '../lib/id'
import { callApi, mockTurnstile, postJson, signUp } from '../test/helpers'

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
    streamUid: `cmtuid${Date.now().toString(36)}${(seq++).toString(36)}`,
    title: 'Clip',
    status,
    createdAt: Date.now(),
    publishedAt: status === 'ready' ? Date.now() : null,
  })
  return id
}

interface CommentJson {
  id: string
  body: string
  createdAt: number
  author: { handle: string; name: string; avatarKey: string | null }
  isMine: boolean
}
interface PageJson {
  items: CommentJson[]
  nextCursor: string | null
}

const post = (videoId: string, body: string, cookie: string) =>
  postJson(`/api/videos/${videoId}/comments`, { body, turnstileToken: 'test-token' }, { cookie })

// Posts with siteverify stubbed to pass.
async function comment(videoId: string, body: string, cookie: string) {
  mockTurnstile()
  const res = await post(videoId, body, cookie)
  vi.restoreAllMocks()
  return res
}

const list = (videoId: string, cookie?: string, cursor?: string) =>
  callApi(`/api/videos/${videoId}/comments${cursor ? `?cursor=${cursor}` : ''}`, {
    headers: cookie ? { cookie } : {},
  })

const del = (commentId: string, cookie?: string) =>
  callApi(`/api/comments/${commentId}`, { method: 'DELETE', headers: cookie ? { cookie } : {} })

const commentCount = async (id: string) =>
  (await db.select({ n: videos.commentCount }).from(videos).where(eq(videos.id, id)).get())?.n

describe('POST /api/videos/:id/comments', () => {
  it('requires a session', async () => {
    const { channelId } = await signUp()
    const id = await insertVideo(channelId)
    const res = await postJson(`/api/videos/${id}/comments`, { body: 'hi', turnstileToken: 't' })
    expect(res.status).toBe(401)
  })

  it('adds the comment and bumps comment_count in one batch', async () => {
    const { channelId } = await signUp()
    const viewer = await signUp()
    const id = await insertVideo(channelId)

    const res = await comment(id, '  First!  ', viewer.cookie)

    expect(res.status).toBe(201)
    const body = await res.json<CommentJson>()
    expect(body).toMatchObject({ body: 'First!', isMine: true, author: { name: 'Test Channel' } })
    expect(body).not.toHaveProperty('userId')
    const row = await db.select().from(comments).where(eq(comments.id, body.id)).get()
    expect(row).toMatchObject({
      videoId: id,
      userId: viewer.userId,
      body: 'First!',
      deletedAt: null,
    })
    expect(await commentCount(id)).toBe(1)
  })

  it('rejects a failed Turnstile check without writing', async () => {
    const { channelId } = await signUp()
    const viewer = await signUp()
    const id = await insertVideo(channelId)
    mockTurnstile(false)

    const res = await post(id, 'spam', viewer.cookie)

    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: 'turnstile_failed' })
    expect(await db.select().from(comments).where(eq(comments.videoId, id)).all()).toEqual([])
    expect(await commentCount(id)).toBe(0)
  })

  it('validates the body', async () => {
    const viewer = await signUp()
    const { channelId } = await signUp()
    const id = await insertVideo(channelId)
    expect((await post(id, '   ', viewer.cookie)).status).toBe(400)
  })

  it('answers 404 for a missing video or one that is not ready, without writing', async () => {
    const owner = await signUp()
    const processing = await insertVideo(owner.channelId, 'processing')

    expect((await comment(processing, 'early', owner.cookie)).status).toBe(404)
    expect((await comment(uuidv7(), 'nowhere', owner.cookie)).status).toBe(404)
    expect(await db.select().from(comments).where(eq(comments.videoId, processing)).all()).toEqual(
      [],
    )
    expect(await commentCount(processing)).toBe(0)
  })
})

describe('GET /api/videos/:id/comments', () => {
  it('lists visible comments newest first with their author, hiding deleted ones', async () => {
    const owner = await signUp()
    const a = await signUp()
    const id = await insertVideo(owner.channelId)
    const first = await (await comment(id, 'one', a.cookie)).json<CommentJson>()
    await comment(id, 'two', owner.cookie)
    const third = await (await comment(id, 'three', a.cookie)).json<CommentJson>()
    await db.update(comments).set({ deletedAt: Date.now() }).where(eq(comments.id, third.id))

    const res = await list(id, a.cookie)

    expect(res.status).toBe(200)
    const page = await res.json<PageJson>()
    expect(page.items.map((c) => [c.body, c.isMine])).toEqual([
      ['two', false],
      ['one', true],
    ])
    expect(page.items[1]).toEqual(first)
    expect(page.nextCursor).toBeNull()
  })

  it('marks nothing as mine when signed out', async () => {
    const owner = await signUp()
    const id = await insertVideo(owner.channelId)
    await comment(id, 'hello', owner.cookie)
    const page = await (await list(id)).json<PageJson>()
    expect(page.items.map((c) => c.isMine)).toEqual([false])
  })

  it('pages with a cursor, without gaps or repeats', async () => {
    const owner = await signUp()
    const id = await insertVideo(owner.channelId)
    // Same created_at for all rows: the id is the tie-breaker.
    const now = Date.now()
    const ids = Array.from({ length: COMMENTS_PAGE_SIZE + 3 }, () => uuidv7(now))
    // One statement per row: D1 caps a statement at 100 bound variables.
    const [firstInsert, ...rest] = ids.map((cid) =>
      db
        .insert(comments)
        .values({ id: cid, videoId: id, userId: owner.userId, body: 'x', createdAt: now }),
    )
    await db.batch([firstInsert!, ...rest])

    const first = await (await list(id)).json<PageJson>()
    expect(first.items).toHaveLength(COMMENTS_PAGE_SIZE)
    expect(first.nextCursor).not.toBeNull()
    const second = await (await list(id, undefined, first.nextCursor!)).json<PageJson>()
    expect(second.items).toHaveLength(3)
    expect(second.nextCursor).toBeNull()

    const seen = [...first.items, ...second.items].map((c) => c.id)
    expect(seen).toEqual([...ids].sort().reverse())
  })

  it('rejects a bad cursor', async () => {
    const owner = await signUp()
    const id = await insertVideo(owner.channelId)
    expect((await list(id, undefined, 'garbage')).status).toBe(400)
  })

  it("hides a not-ready video's comments from everyone but its owner", async () => {
    const owner = await signUp()
    const other = await signUp()
    const id = await insertVideo(owner.channelId, 'processing')

    expect((await list(id)).status).toBe(404)
    expect((await list(id, other.cookie)).status).toBe(404)
    expect((await list(id, owner.cookie)).status).toBe(200)
    expect((await list(uuidv7())).status).toBe(404)
  })
})

describe('DELETE /api/comments/:id', () => {
  it('soft-deletes the author’s comment and drops comment_count once', async () => {
    const owner = await signUp()
    const a = await signUp()
    const id = await insertVideo(owner.channelId)
    const c1 = await (await comment(id, 'one', a.cookie)).json<CommentJson>()
    await comment(id, 'two', a.cookie)
    expect(await commentCount(id)).toBe(2)

    expect((await del(c1.id, a.cookie)).status).toBe(204)
    const row = await db.select().from(comments).where(eq(comments.id, c1.id)).get()
    expect(row?.deletedAt).toEqual(expect.any(Number))
    expect(await commentCount(id)).toBe(1)

    // Repeat: still 204, count unchanged.
    expect((await del(c1.id, a.cookie)).status).toBe(204)
    expect(await commentCount(id)).toBe(1)
  })

  it("answers 404 for someone else's comment, even the video owner's, and changes nothing", async () => {
    const owner = await signUp()
    const a = await signUp()
    const id = await insertVideo(owner.channelId)
    const c1 = await (await comment(id, 'mine', a.cookie)).json<CommentJson>()

    expect((await del(c1.id, owner.cookie)).status).toBe(404)
    expect((await del(uuidv7(), a.cookie)).status).toBe(404)
    const row = await db.select().from(comments).where(eq(comments.id, c1.id)).get()
    expect(row?.deletedAt).toBeNull()
    expect(await commentCount(id)).toBe(1)
  })

  it('requires a session', async () => {
    expect((await del(uuidv7())).status).toBe(401)
  })
})
