import { FEED_PAGE_SIZE } from '@vidflare/shared'
import { env } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { getDb } from '../db/client'
import { channels, videos } from '../db/schema'
import { uuidv7 } from '../lib/id'
import { callApi, signUp } from '../test/helpers'

const db = getDb(env.DB)

interface VideoPage {
  items: { id: string; channel: { handle: string } }[]
  nextCursor: string | null
}

const handleOf = async (channelId: string) =>
  (await db.select({ h: channels.handle }).from(channels).where(eq(channels.id, channelId)).get())!
    .h

let seq = 0
async function insertVideo(
  channelId: string,
  overrides: Partial<typeof videos.$inferInsert> = {},
  at = Date.now() + seq,
) {
  const id = uuidv7(at)
  await db.insert(videos).values({
    id,
    channelId,
    streamUid: `chuid${Date.now().toString(36)}${(seq++).toString(36)}`,
    title: 'Clip',
    status: 'ready',
    visibility: 'public',
    createdAt: at,
    publishedAt: at,
    ...overrides,
  })
  return id
}

describe('GET /api/channels/:handle', () => {
  it('returns the channel with its counters, case-insensitively', async () => {
    const { channelId } = await signUp()
    const handle = await handleOf(channelId)

    const res = await callApi(`/api/channels/${handle.toUpperCase()}`)

    expect(res.status).toBe(200)
    const body = await res.json<Record<string, unknown>>()
    expect(body).toMatchObject({
      id: channelId,
      handle,
      name: 'Test Channel',
      avatarKey: null,
      subscriberCount: 0,
      isOwner: false,
    })
    expect(body).not.toHaveProperty('userId')
  })

  it('marks the owner', async () => {
    const owner = await signUp()
    const handle = await handleOf(owner.channelId)
    const res = await callApi(`/api/channels/${handle}`, { headers: { cookie: owner.cookie } })
    expect(await res.json()).toMatchObject({ isOwner: true })
  })

  it('answers 404 for an unknown handle and 400 for an invalid one', async () => {
    expect((await callApi('/api/channels/nobody_here_123')).status).toBe(404)
    expect((await callApi('/api/channels/no')).status).toBe(400)
    expect((await callApi('/api/channels/bad-handle!')).status).toBe(400)
  })
})

describe('GET /api/channels/:handle/videos', () => {
  it("lists only that channel's public, ready videos, newest first", async () => {
    const { channelId } = await signUp()
    const other = await signUp()
    const handle = await handleOf(channelId)
    const t = Date.now()
    const older = await insertVideo(channelId, {}, t)
    const newer = await insertVideo(channelId, {}, t + 10)
    await insertVideo(channelId, { visibility: 'unlisted' }, t + 20)
    await insertVideo(channelId, { status: 'processing', publishedAt: null }, t + 30)
    await insertVideo(other.channelId, {}, t + 40)

    const res = await callApi(`/api/channels/${handle}/videos`)

    expect(res.status).toBe(200)
    const page = await res.json<VideoPage>()
    expect(page.items.map((v) => v.id)).toEqual([newer, older])
    expect(page.items[0]!.channel.handle).toBe(handle)
    expect(page.nextCursor).toBeNull()
  })

  it('pages with the cursor', async () => {
    const { channelId } = await signUp()
    const handle = await handleOf(channelId)
    const t = Date.now()
    const ids: string[] = []
    for (let i = 0; i < FEED_PAGE_SIZE + 2; i++) ids.push(await insertVideo(channelId, {}, t + i))

    const first = await (await callApi(`/api/channels/${handle}/videos`)).json<VideoPage>()
    expect(first.items).toHaveLength(FEED_PAGE_SIZE)
    const second = await (
      await callApi(`/api/channels/${handle}/videos?cursor=${first.nextCursor}`)
    ).json<VideoPage>()
    expect([...first.items, ...second.items].map((v) => v.id)).toEqual(ids.reverse())
    expect(second.nextCursor).toBeNull()
  })

  it('answers 404 for an unknown handle and 400 for a bad cursor', async () => {
    const { channelId } = await signUp()
    const handle = await handleOf(channelId)
    expect((await callApi('/api/channels/nobody_here_123/videos')).status).toBe(404)
    expect((await callApi(`/api/channels/${handle}/videos?cursor=nope`)).status).toBe(400)
  })
})
