import { runDurableObjectAlarm } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { getDb } from '../db/client'
import { videos } from '../db/schema'
import { uuidv7 } from '../lib/id'
import { VIEWER_COOKIE } from '../lib/viewer'
import { callApi, signUp } from '../test/helpers'

const db = getDb(env.DB)

let seq = 0
async function insertVideo(
  channelId: string,
  status: 'uploading' | 'processing' | 'ready' | 'error' = 'ready',
  viewCount = 0,
) {
  const id = uuidv7()
  await db.insert(videos).values({
    id,
    channelId,
    streamUid: `viewuid${Date.now().toString(36)}${(seq++).toString(36)}`,
    title: 'Clip',
    status,
    viewCount,
    createdAt: Date.now(),
    publishedAt: status === 'ready' ? Date.now() : null,
  })
  return id
}

const view = (id: string, cookie?: string) =>
  callApi(`/api/videos/${id}/view`, { method: 'POST', headers: cookie ? { cookie } : {} })

// "vf_viewer=<token>" from a response that set the anonymous viewer cookie.
const viewerCookie = (res: Response) =>
  res.headers
    .getSetCookie()
    .find((c) => c.startsWith(`${VIEWER_COOKIE}=`))
    ?.split(';')[0]

const viewCountInD1 = async (id: string) =>
  (await db.select({ n: videos.viewCount }).from(videos).where(eq(videos.id, id)).get())?.n

describe('POST /api/videos/:id/view', () => {
  it('counts a signed-in session once', async () => {
    const owner = await signUp()
    const viewer = await signUp()
    const id = await insertVideo(owner.channelId, 'ready', 7)

    const first = await view(id, viewer.cookie)
    expect(first.status).toBe(200)
    expect(await first.json()).toEqual({ recorded: true, viewCount: 8 })
    // Signed in: no anonymous cookie needed.
    expect(viewerCookie(first)).toBeUndefined()

    expect(await (await view(id, viewer.cookie)).json()).toEqual({
      recorded: false,
      viewCount: 8,
    })
  })

  it('gives an anonymous viewer a cookie and dedupes by it', async () => {
    const owner = await signUp()
    const id = await insertVideo(owner.channelId)

    const first = await view(id)
    expect(await first.json()).toEqual({ recorded: true, viewCount: 1 })
    const cookie = viewerCookie(first)
    expect(cookie).toMatch(new RegExp(`^${VIEWER_COOKIE}=[A-Za-z0-9_-]{43}$`))
    expect(first.headers.getSetCookie().join()).toMatch(/HttpOnly/i)

    // Same browser: deduped, cookie kept as is.
    const again = await view(id, cookie)
    expect(await again.json()).toEqual({ recorded: false, viewCount: 1 })
    expect(viewerCookie(again)).toBeUndefined()

    // Another browser (no cookie) is another viewer.
    expect(await (await view(id)).json()).toEqual({ recorded: true, viewCount: 2 })
  })

  it('replaces a malformed viewer cookie', async () => {
    const owner = await signUp()
    const id = await insertVideo(owner.channelId)
    const res = await view(id, `${VIEWER_COOKIE}=not-a-token`)
    expect(viewerCookie(res)).toMatch(/^vf_viewer=[A-Za-z0-9_-]{43}$/)
  })

  it('leaves D1 alone until the Durable Object flushes', async () => {
    const owner = await signUp()
    const id = await insertVideo(owner.channelId, 'ready', 3)
    await view(id)
    await view(id)
    expect(await viewCountInD1(id)).toBe(3)

    await runDurableObjectAlarm(env.VIDEO_STATS.get(env.VIDEO_STATS.idFromName(id)))
    expect(await viewCountInD1(id)).toBe(5)

    const detail = await (await callApi(`/api/videos/${id}`)).json<{ viewCount: number }>()
    expect(detail.viewCount).toBe(5)
  })

  it('answers 404 for a video that is missing or not ready', async () => {
    const owner = await signUp()
    const processing = await insertVideo(owner.channelId, 'processing')
    expect((await view(processing, owner.cookie)).status).toBe(404)
    expect((await view(uuidv7())).status).toBe(404)
  })

  it('rejects an invalid id', async () => {
    expect((await view('nope')).status).toBe(400)
  })
})
