import { FEED_PAGE_SIZE } from '@vidflare/shared'
import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

import { getDb } from '../db/client'
import { videos } from '../db/schema'
import { uuidv7 } from '../lib/id'
import { callApi, signUp } from '../test/helpers'

const db = getDb(env.DB)

interface VideoPage {
  items: { id: string }[]
  nextCursor: string | null
}

let seq = 0
async function insertVideo(
  channelId: string,
  at: number,
  overrides: Partial<typeof videos.$inferInsert> = {},
) {
  const id = uuidv7(at)
  await db.insert(videos).values({
    id,
    channelId,
    streamUid: `subfeed${Date.now().toString(36)}${(seq++).toString(36)}`,
    title: 'Clip',
    status: 'ready',
    visibility: 'public',
    createdAt: at,
    publishedAt: at,
    ...overrides,
  })
  return id
}

const subscribe = (channelId: string, cookie: string) =>
  callApi(`/api/channels/${channelId}/subscribe`, { method: 'PUT', headers: { cookie } })

const feed = async (cookie: string, cursor?: string) => {
  const res = await callApi(`/api/feed/subscriptions${cursor ? `?cursor=${cursor}` : ''}`, {
    headers: { cookie },
  })
  expect(res.status).toBe(200)
  return res.json<VideoPage>()
}

describe('GET /api/feed/subscriptions', () => {
  it('requires a session', async () => {
    expect((await callApi('/api/feed/subscriptions')).status).toBe(401)
  })

  it('lists public, ready videos from subscribed channels only, newest first', async () => {
    const fan = await signUp()
    const a = await signUp()
    const b = await signUp()
    const notFollowed = await signUp()
    await subscribe(a.channelId, fan.cookie)
    await subscribe(b.channelId, fan.cookie)
    const t = Date.now()
    const a1 = await insertVideo(a.channelId, t)
    const b1 = await insertVideo(b.channelId, t + 10)
    const a2 = await insertVideo(a.channelId, t + 20)
    await insertVideo(a.channelId, t + 30, { visibility: 'unlisted' })
    await insertVideo(b.channelId, t + 40, { status: 'processing', publishedAt: null })
    await insertVideo(notFollowed.channelId, t + 50)
    // The fan's own uploads aren't in their subscriptions feed.
    await insertVideo(fan.channelId, t + 60)

    const page = await feed(fan.cookie)

    expect(page.items.map((v) => v.id)).toEqual([a2, b1, a1])
    expect(page.nextCursor).toBeNull()
  })

  it('is empty without subscriptions, and drops a channel after unsubscribing', async () => {
    const fan = await signUp()
    const creator = await signUp()
    await insertVideo(creator.channelId, Date.now())
    expect((await feed(fan.cookie)).items).toEqual([])

    await subscribe(creator.channelId, fan.cookie)
    expect((await feed(fan.cookie)).items).toHaveLength(1)
    await callApi(`/api/channels/${creator.channelId}/subscribe`, {
      method: 'DELETE',
      headers: { cookie: fan.cookie },
    })
    expect((await feed(fan.cookie)).items).toEqual([])
  })

  it('pages with the cursor', async () => {
    const fan = await signUp()
    const creator = await signUp()
    await subscribe(creator.channelId, fan.cookie)
    const t = Date.now()
    const ids: string[] = []
    for (let i = 0; i < FEED_PAGE_SIZE + 1; i++)
      ids.push(await insertVideo(creator.channelId, t + i))

    const first = await feed(fan.cookie)
    expect(first.items).toHaveLength(FEED_PAGE_SIZE)
    const second = await feed(fan.cookie, first.nextCursor!)
    expect([...first.items, ...second.items].map((v) => v.id)).toEqual(ids.reverse())
    expect(second.nextCursor).toBeNull()
  })

  it('rejects a bad cursor', async () => {
    const fan = await signUp()
    const res = await callApi('/api/feed/subscriptions?cursor=nope', {
      headers: { cookie: fan.cookie },
    })
    expect(res.status).toBe(400)
  })
})
