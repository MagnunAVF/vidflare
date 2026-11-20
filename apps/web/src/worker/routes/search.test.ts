import { env } from 'cloudflare:workers'
import { FEED_PAGE_SIZE, SEARCH_QUERY_MAX } from '@vidflare/shared'
import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'

import { getDb } from '../db/client'
import { channels, videos } from '../db/schema'
import { uuidv7 } from '../lib/id'
import { callApi, signUp } from '../test/helpers'

const db = getDb(env.DB)

interface SearchPage {
  items: { id: string; title: string; publishedAt: number; channel: { handle: string } }[]
  nextCursor: string | null
}

type Row = typeof videos.$inferInsert

const BASE = 1_800_000_000_000
let seq = 0
let channelId: string
let handle: string

// Rows use made-up words, so matches can only come from what this file inserts.
const row = (overrides: Partial<Row> & { title: string }): Row => {
  const n = seq++
  return {
    id: uuidv7(BASE + n),
    channelId,
    streamUid: `search-${n}`,
    status: 'ready',
    visibility: 'public',
    createdAt: BASE + n,
    publishedAt: BASE + n,
    ...overrides,
  }
}

async function insert(rows: Row[]) {
  // One statement per row: D1 caps a statement at 100 bound variables.
  const [head, ...tail] = rows.map((r) => db.insert(videos).values(r))
  await db.batch([head!, ...tail])
  return rows.map((r) => r.id)
}

const search = (q: string, cursor?: string) =>
  callApi(`/api/search?${new URLSearchParams({ q, ...(cursor ? { cursor } : {}) })}`)

async function searchOk(q: string, cursor?: string) {
  const res = await search(q, cursor)
  expect(res.status).toBe(200)
  return res.json<SearchPage>()
}

const ids = (page: SearchPage) => page.items.map((v) => v.id)

let visible: string[]
let byDescription: string | undefined
beforeAll(async () => {
  ;({ channelId } = await signUp())
  const channel = await db
    .select({ handle: channels.handle })
    .from(channels)
    .where(eq(channels.id, channelId))
    .get()
  handle = channel!.handle

  visible = await insert([
    row({ title: 'Quillzephyr harbor walk' }),
    row({ title: 'Quillzephyr at night', description: 'Lanterns over the water' }),
  ])
  ;[byDescription] = await insert([
    row({ title: 'Evening stroll', description: 'Along the quillzephyr pier' }),
  ])
  // Matching text, but none of these may ever be listed (newer, so a missing filter shows).
  await insert([
    row({ title: 'Quillzephyr unlisted', visibility: 'unlisted' }),
    row({ title: 'Quillzephyr processing', status: 'processing', publishedAt: null }),
    row({ title: 'Quillzephyr failed', status: 'error', publishedAt: null }),
    row({ title: 'Quillzephyr uploading', status: 'uploading', publishedAt: null }),
  ])
})

describe('GET /api/search', () => {
  it('finds public, ready videos by title or description, newest first', async () => {
    const page = await searchOk('quillzephyr')
    expect(ids(page)).toEqual([byDescription, visible[1], visible[0]])
    expect(page.nextCursor).toBeNull()
    expect(page.items[0]!.channel.handle).toBe(handle)
  })

  it('requires every word and treats the last one as a prefix', async () => {
    expect(ids(await searchOk('quillzephyr lantern'))).toEqual([visible[1]])
    expect(ids(await searchOk('Quillzeph'))).toHaveLength(3)
    expect(ids(await searchOk('quillzephyr nowhere'))).toEqual([])
  })

  it('folds case and accents', async () => {
    const [id] = await insert([row({ title: 'Brûlée Vortexmint' })])
    expect(ids(await searchOk('BRULEE vortexmint'))).toEqual([id])
  })

  it('follows title edits and drops deleted videos', async () => {
    const [id] = await insert([row({ title: 'Marblefinch draft' })])
    await db.update(videos).set({ title: 'Copperwren final' }).where(eq(videos.id, id!))
    expect(ids(await searchOk('marblefinch'))).toEqual([])
    expect(ids(await searchOk('copperwren'))).toEqual([id])
    await db.delete(videos).where(eq(videos.id, id!))
    expect(ids(await searchOk('copperwren'))).toEqual([])
  })

  it.each(['"quillzephyr', 'quillzephyr*', '(quillzephyr)', '-quillzephyr', '^quillzephyr'])(
    'ignores FTS operators in %j',
    async (q) => {
      expect(ids(await searchOk(q))).toHaveLength(3)
    },
  )

  // Keywords and column filters are ordinary required words, so these match nothing here
  // (rather than failing as malformed FTS queries).
  it.each(['quillzephyr OR', 'NEAR(quillzephyr)', 'title:quillzephyr', 'quillzephyr AND NOT'])(
    'treats FTS keywords in %j as words',
    async (q) => {
      expect(ids(await searchOk(q))).toEqual([])
    },
  )

  it('returns no results for text without a word', async () => {
    expect(await searchOk('?!* "" --')).toEqual({ items: [], nextCursor: null })
  })

  it('pages with the feed cursor, without gaps or repeats', async () => {
    const all = await insert(
      Array.from({ length: FEED_PAGE_SIZE + 2 }, (_, i) => row({ title: `Pebbleloom ${i}` })),
    )
    const first = await searchOk('pebbleloom')
    expect(first.items).toHaveLength(FEED_PAGE_SIZE)
    expect(first.nextCursor).not.toBeNull()
    const second = await searchOk('pebbleloom', first.nextCursor!)
    expect(second.nextCursor).toBeNull()
    expect([...ids(first), ...ids(second)]).toEqual([...all].reverse())
  })

  it.each([
    ['no q', '/api/search'],
    ['a blank q', '/api/search?q=%20%20'],
    ['a too-long q', `/api/search?q=${'x'.repeat(SEARCH_QUERY_MAX + 1)}`],
    ['a bad cursor', '/api/search?q=quillzephyr&cursor=nope'],
  ])('rejects %s with 400', async (_, path) => {
    expect((await callApi(path)).status).toBe(400)
  })
})
