import { env } from 'cloudflare:workers'
import { FEED_PAGE_SIZE } from '@vidflare/shared'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getDb } from '../db/client'
import { videos } from '../db/schema'
import { uuidv7 } from '../lib/id'
import { callApi, mockFetch, signUp, STREAM_API_URL } from '../test/helpers'

const db = getDb(env.DB)

interface StudioPage {
  items: { id: string; status: string; visibility: string; createdAt: number }[]
  nextCursor: string | null
}

const STATUSES = ['uploading', 'processing', 'ready', 'error'] as const

// `count` videos for a channel, cycling through every status and visibility; returns ids,
// newest first.
async function seedVideos(channelId: string, count: number) {
  const base = Date.now()
  const rows = Array.from({ length: count }, (_, i) => ({
    id: uuidv7(base + i),
    channelId,
    streamUid: `studio-${channelId.slice(-8)}-${i}`,
    title: `Video ${i}`,
    status: STATUSES[i % STATUSES.length]!,
    visibility: i % 2 === 0 ? ('public' as const) : ('unlisted' as const),
    createdAt: base + i,
  }))
  const [head, ...tail] = rows.map((row) => db.insert(videos).values(row))
  await db.batch([head!, ...tail])
  return rows.map((r) => r.id).reverse()
}

const getStudio = async (cookie: string, cursor?: string) => {
  const res = await callApi(`/api/studio/videos${cursor ? `?cursor=${cursor}` : ''}`, {
    headers: { cookie },
  })
  expect(res.status).toBe(200)
  return res.json<StudioPage>()
}

describe('GET /api/studio/videos', () => {
  it("lists only the creator's own videos, in every status, newest upload first", async () => {
    const me = await signUp()
    const other = await signUp()
    const mine = await seedVideos(me.channelId, 6)
    await seedVideos(other.channelId, 3)

    const page = await getStudio(me.cookie)

    expect(page.items.map((v) => v.id)).toEqual(mine)
    expect(new Set(page.items.map((v) => v.status))).toEqual(new Set(STATUSES))
    expect(new Set(page.items.map((v) => v.visibility))).toEqual(new Set(['public', 'unlisted']))
    expect(page.nextCursor).toBeNull()
  })

  it('pages with a cursor on (created_at, id)', async () => {
    const me = await signUp()
    const mine = await seedVideos(me.channelId, FEED_PAGE_SIZE + 3)

    const first = await getStudio(me.cookie)
    const second = await getStudio(me.cookie, first.nextCursor!)

    expect([...first.items, ...second.items].map((v) => v.id)).toEqual(mine)
    expect(second.nextCursor).toBeNull()
  })

  it('requires a session and rejects foreign cursors', async () => {
    expect((await callApi('/api/studio/videos')).status).toBe(401)
    const me = await signUp()
    const res = await callApi('/api/studio/videos?cursor=nope', { headers: { cookie: me.cookie } })
    expect(res.status).toBe(400)
  })
})

describe('POST /api/studio/videos/:id/recheck', () => {
  afterEach(() => vi.restoreAllMocks())

  async function stuckVideo(status: 'uploading' | 'processing' | 'ready' = 'processing') {
    const me = await signUp()
    const id = uuidv7()
    const uid = `recheck${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
    await db
      .insert(videos)
      .values({ id, channelId: me.channelId, streamUid: uid, title: 'Stuck', status, createdAt: 1 })
    return { ...me, id, uid }
  }

  // Stream's GET /stream/:uid answer for a given state.
  const streamSays = (body: Record<string, unknown> | null) =>
    mockFetch({
      [STREAM_API_URL]: () =>
        body === null ? new Response(null, { status: 404 }) : Response.json({ result: body }),
    })

  const recheck = (id: string, cookie?: string) =>
    callApi(`/api/studio/videos/${id}/recheck`, {
      method: 'POST',
      headers: cookie ? { cookie } : {},
    })

  const statusOf = async (id: string) =>
    (await db.select({ status: videos.status }).from(videos).where(eq(videos.id, id)).get())?.status

  it('marks a stuck video ready with what Stream reports', async () => {
    const { cookie, id, uid } = await stuckVideo('processing')
    const requests = streamSays({
      uid,
      status: { state: 'ready' },
      readyToStream: true,
      duration: 42.4,
      thumbnail: `https://customer-example.cloudflarestream.com/${uid}/thumbnails/thumbnail.jpg`,
    })

    const res = await recheck(id, cookie)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id, status: 'ready', streamState: 'ready' })
    expect(requests[0]!.url).toMatch(new RegExp(`/stream/${uid}$`))
    expect(await db.select().from(videos).where(eq(videos.id, id)).get()).toMatchObject({
      status: 'ready',
      durationS: 42,
      publishedAt: expect.any(Number),
    })
  })

  it('marks it failed when Stream reports an error or no longer has it', async () => {
    const failed = await stuckVideo('processing')
    streamSays({ uid: failed.uid, status: { state: 'error', errorReasonCode: 'ERR_NON_VIDEO' } })
    expect(await (await recheck(failed.id, failed.cookie)).json()).toMatchObject({
      status: 'error',
    })
    vi.restoreAllMocks()

    const gone = await stuckVideo('uploading')
    streamSays(null)
    expect(await (await recheck(gone.id, gone.cookie)).json()).toEqual({
      id: gone.id,
      status: 'error',
      streamState: 'not_found',
    })
  })

  it('moves uploading to processing when Stream already has the bytes', async () => {
    const { cookie, id, uid } = await stuckVideo('uploading')
    streamSays({ uid, status: { state: 'inprogress' } })

    expect(await (await recheck(id, cookie)).json()).toEqual({
      id,
      status: 'processing',
      streamState: 'inprogress',
    })
  })

  it('leaves the status alone while Stream is still waiting or encoding', async () => {
    const waiting = await stuckVideo('uploading')
    streamSays({ uid: waiting.uid, status: { state: 'pendingupload' } })
    expect(await (await recheck(waiting.id, waiting.cookie)).json()).toMatchObject({
      status: 'uploading',
    })
    vi.restoreAllMocks()

    const encoding = await stuckVideo('processing')
    streamSays({ uid: encoding.uid, status: { state: 'inprogress' } })
    expect(await (await recheck(encoding.id, encoding.cookie)).json()).toMatchObject({
      status: 'processing',
    })
  })

  it('does not call Stream for a ready video', async () => {
    const { cookie, id } = await stuckVideo('ready')
    const requests = mockFetch({})
    expect(await (await recheck(id, cookie)).json()).toEqual({
      id,
      status: 'ready',
      streamState: null,
    })
    expect(requests).toHaveLength(0)
  })

  it("answers 404 for someone else's video and 401 when signed out", async () => {
    const { id } = await stuckVideo('processing')
    const other = await signUp()
    const requests = mockFetch({})
    expect((await recheck(id, other.cookie)).status).toBe(404)
    expect((await recheck(id)).status).toBe(401)
    expect(requests).toHaveLength(0)
    expect(await statusOf(id)).toBe('processing')
  })
})
