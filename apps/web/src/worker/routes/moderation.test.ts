import { env } from 'cloudflare:workers'
import { REPORT_DETAILS_MAX } from '@vidflare/shared'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getDb } from '../db/client'
import { channels, reports, videos } from '../db/schema'
import { cacheKeys } from '../lib/cache'
import { onError } from '../lib/errors'
import { uuidv7 } from '../lib/id'
import { callApi, mockFetch, postJson, signUp, STREAM_API_URL } from '../test/helpers'
import type { AppEnv } from '../types'
import { moderationRoutes } from './moderation'

const db = getDb(env.DB)
const MOD = { Authorization: 'Bearer test-moderation-token' }

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

// A creator with one public, ready video, plus a second user who can report it.
async function setup() {
  const owner = await signUp()
  const viewer = await signUp()
  const { handle } = (await db
    .select({ handle: channels.handle })
    .from(channels)
    .where(eq(channels.id, owner.channelId))
    .get())!
  const videoId = uuidv7()
  const streamUid = `mod-${videoId}`
  await db.insert(videos).values({
    id: videoId,
    channelId: owner.channelId,
    streamUid,
    title: `Moderation ${videoId.slice(-6)}`,
    status: 'ready',
    visibility: 'public',
    createdAt: Date.now(),
    publishedAt: Date.now(),
  })
  return { owner, viewer, handle, videoId, streamUid }
}

const report = (
  videoId: string,
  cookie: string,
  body: unknown = { reason: 'copyright', details: '' },
) => postJson(`/api/videos/${videoId}/report`, body, { cookie })

// Stream's edit endpoint, recording each requireSignedURLs value it receives.
function mockStreamEdit(status = 200) {
  const sent: boolean[] = []
  mockFetch({
    [STREAM_API_URL]: async (req) => {
      sent.push(((await req.json()) as { requireSignedURLs: boolean }).requireSignedURLs)
      return Response.json({ success: status < 400 }, { status })
    },
  })
  return sent
}

const moderate = (path: string) =>
  callApi(`/api/moderation${path}`, { method: 'POST', headers: MOD })

describe('POST /api/videos/:id/report', () => {
  it('stores one open report per viewer, and repeats are no-ops', async () => {
    const { viewer, videoId } = await setup()
    const first = await report(videoId, viewer.cookie, { reason: 'copyright', details: ' Mine ' })
    expect(first.status).toBe(200)
    expect(await first.json()).toEqual({ reported: true })
    expect((await report(videoId, viewer.cookie, { reason: 'spam', details: '' })).status).toBe(200)

    const rows = await db.select().from(reports).where(eq(reports.videoId, videoId)).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      reporterId: viewer.userId,
      reason: 'copyright',
      details: 'Mine',
      status: 'open',
    })
  })

  it('needs a session, a known reason and short details, and refuses one’s own video', async () => {
    const { owner, viewer, videoId } = await setup()
    expect(
      (await postJson(`/api/videos/${videoId}/report`, { reason: 'spam', details: '' })).status,
    ).toBe(401)
    expect((await report(videoId, viewer.cookie, { reason: 'boring', details: '' })).status).toBe(
      400,
    )
    const long = { reason: 'other', details: 'x'.repeat(REPORT_DETAILS_MAX + 1) }
    expect((await report(videoId, viewer.cookie, long)).status).toBe(400)
    const own = await report(videoId, owner.cookie)
    expect(own.status).toBe(400)
    expect(await own.json()).toMatchObject({ error: 'cannot_report_own_video' })
    expect((await report(uuidv7(), viewer.cookie)).status).toBe(404)
  })
})

describe('moderation API', () => {
  it('requires the bearer token', async () => {
    expect((await callApi('/api/moderation/reports')).status).toBe(401)
    const wrong = await callApi('/api/moderation/reports', {
      headers: { Authorization: 'Bearer nope' },
    })
    expect(wrong.status).toBe(401)
  })

  it('is switched off without MODERATION_TOKEN', async () => {
    const app = new Hono<AppEnv>().onError(onError).route('/', moderationRoutes)
    const res = await app.request('/reports', { headers: MOD }, { ...env, MODERATION_TOKEN: '' })
    expect(res.status).toBe(404)
  })

  it('lists open reports with their video, and dismisses one', async () => {
    const { viewer, videoId, handle } = await setup()
    await report(videoId, viewer.cookie, { reason: 'harassment', details: 'At 1:02' })
    const reportId = (await db.select().from(reports).where(eq(reports.videoId, videoId)).get())!.id

    const open = await callApi('/api/moderation/reports', { headers: MOD })
    expect(open.status).toBe(200)
    const page = await open.json<{ items: { id: string; video: { channelHandle: string } }[] }>()
    expect(page.items.find((r) => r.id === reportId)).toMatchObject({
      reason: 'harassment',
      details: 'At 1:02',
      video: { id: videoId, channelHandle: handle, takenDownAt: null },
    })

    const dismissed = await moderate(`/reports/${reportId}/dismiss`)
    expect(await dismissed.json()).toMatchObject({ id: reportId, status: 'dismissed' })
    const stillOpen = await (
      await callApi('/api/moderation/reports', { headers: MOD })
    ).json<{
      items: { id: string }[]
    }>()
    expect(stillOpen.items.map((r) => r.id)).not.toContain(reportId)
    expect((await moderate(`/reports/${uuidv7()}/dismiss`)).status).toBe(404)
  })

  it('takes a video down everywhere and restores it', async () => {
    const { owner, viewer, videoId, handle } = await setup()
    await report(videoId, viewer.cookie)
    // Warm the cache the way a signed-out visitor would.
    expect((await callApi(`/api/videos/${videoId}`)).status).toBe(200)
    await vi.waitFor(async () => {
      if ((await env.CACHE.get(cacheKeys.video(videoId))) === null) throw new Error('not cached')
    })

    const sent = mockStreamEdit()
    const down = await moderate(`/videos/${videoId}/takedown`)
    expect(down.status).toBe(200)
    expect(sent).toEqual([true])

    // Gone for everyone, the owner included, and nothing can be done with it.
    expect((await callApi(`/api/videos/${videoId}`)).status).toBe(404)
    expect(
      (await callApi(`/api/videos/${videoId}`, { headers: { cookie: owner.cookie } })).status,
    ).toBe(404)
    const ids = async (path: string) =>
      (await (await callApi(path)).json<{ items: { id: string }[] }>()).items.map((v) => v.id)
    expect(await ids('/api/videos')).not.toContain(videoId)
    expect(await ids(`/api/channels/${handle}/videos`)).not.toContain(videoId)
    expect(await ids(`/api/search?q=moderation`)).not.toContain(videoId)
    expect((await callApi(`/api/videos/${videoId}/comments`)).status).toBe(404)
    expect(
      (
        await callApi(`/api/videos/${videoId}/like`, {
          method: 'PUT',
          headers: { cookie: viewer.cookie },
        })
      ).status,
    ).toBe(404)
    expect((await callApi(`/api/videos/${videoId}/view`, { method: 'POST' })).status).toBe(404)
    // The report was actioned, and the owner sees why in the studio.
    expect(
      (await db.select().from(reports).where(eq(reports.videoId, videoId)).get())!.status,
    ).toBe('actioned')
    const studio = await (
      await callApi('/api/studio/videos', { headers: { cookie: owner.cookie } })
    ).json<{
      items: { id: string; takenDownAt: number | null }[]
    }>()
    expect(studio.items.find((v) => v.id === videoId)!.takenDownAt).not.toBeNull()

    // A repeat is harmless and keeps the first timestamp.
    const { takenDownAt } = await down.json<{ takenDownAt: number }>()
    expect(await (await moderate(`/videos/${videoId}/takedown`)).json()).toMatchObject({
      takenDownAt,
    })

    const restored = await moderate(`/videos/${videoId}/restore`)
    expect(restored.status).toBe(200)
    expect(sent).toEqual([true, true, false])
    expect((await callApi(`/api/videos/${videoId}`)).status).toBe(200)
    expect(await ids('/api/videos')).toContain(videoId)
  })

  it('keeps the takedown when Stream fails, and the request can be repeated', async () => {
    const { videoId } = await setup()
    mockStreamEdit(500)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await moderate(`/videos/${videoId}/takedown`)).status).toBe(500)
    // Already hidden in the app.
    expect((await callApi(`/api/videos/${videoId}`)).status).toBe(404)

    vi.restoreAllMocks()
    const sent = mockStreamEdit()
    expect((await moderate(`/videos/${videoId}/takedown`)).status).toBe(200)
    expect(sent).toEqual([true])
  })
})
