import { env } from 'cloudflare:workers'
import { FEED_PAGE_SIZE } from '@vidflare/shared'
import { describe, expect, it } from 'vitest'

import { getDb } from '../db/client'
import { videos } from '../db/schema'
import { uuidv7 } from '../lib/id'
import { callApi, signUp } from '../test/helpers'

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
