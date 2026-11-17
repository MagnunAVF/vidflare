import { env } from 'cloudflare:workers'
import { FEED_PAGE_SIZE } from '@vidflare/shared'
import { beforeAll, describe, expect, it } from 'vitest'

import { getDb } from '../db/client'
import { videos } from '../db/schema'
import { encodeCursor } from '../lib/cursor'
import { uuidv7 } from '../lib/id'
import { callApi, signUp } from '../test/helpers'

const db = getDb(env.DB)

interface FeedPage {
  items: {
    id: string
    title: string
    publishedAt: number
    channel: { handle: string; name: string; avatarKey: string | null }
  }[]
  nextCursor: string | null
}

const BASE = 1_800_000_000_000
const PUBLIC_READY = 30
// Videos 1 and 2 share this published_at, so the id tie-breaker matters.
const TIE = BASE + 2
// Listed videos in the order the feed must return them.
const listed: { id: string; publishedAt: number }[] = []
const hidden: string[] = []

// 30 public ready videos plus unlisted, processing, error and uploading ones that must never be
// listed (they are newer, so a missing filter would put them first).
beforeAll(async () => {
  const { channelId } = await signUp()
  const rows = Array.from({ length: PUBLIC_READY }, (_, i) => ({
    id: uuidv7(BASE + i),
    channelId,
    streamUid: `feed-${i}`,
    title: `Public ${i}`,
    status: 'ready' as const,
    visibility: 'public' as const,
    createdAt: BASE + i,
    publishedAt: i === 1 ? TIE : BASE + i,
  }))
  const excluded = [
    { status: 'ready' as const, visibility: 'unlisted' as const },
    { status: 'processing' as const, visibility: 'public' as const },
    { status: 'error' as const, visibility: 'public' as const },
    { status: 'uploading' as const, visibility: 'public' as const },
  ].map((v, i) => ({
    id: uuidv7(BASE + 1000 + i),
    channelId,
    streamUid: `feed-hidden-${i}`,
    title: `Hidden ${i}`,
    createdAt: BASE + 1000 + i,
    publishedAt: v.status === 'ready' ? BASE + 1000 + i : null,
    ...v,
  }))
  // One statement per row: D1 caps a statement at 100 bound variables.
  const [head, ...tail] = [...rows, ...excluded].map((row) => db.insert(videos).values(row))
  await db.batch([head!, ...tail])

  listed.push(
    ...rows
      .map(({ id, publishedAt }) => ({ id, publishedAt }))
      .sort((a, b) => b.publishedAt - a.publishedAt || (a.id < b.id ? 1 : -1)),
  )
  hidden.push(...excluded.map((r) => r.id))
})

const ids = (items: { id: string }[]) => items.map((v) => v.id)

async function getPage(cursor?: string) {
  const res = await callApi(`/api/videos${cursor ? `?cursor=${cursor}` : ''}`)
  expect(res.status).toBe(200)
  return res.json<FeedPage>()
}

describe('GET /api/videos (home feed)', () => {
  it('lists only public, ready videos, newest first, with their channel', async () => {
    const first = await getPage()

    expect(ids(first.items)).toEqual(ids(listed.slice(0, FEED_PAGE_SIZE)))
    expect(first.items[0]!.channel).toMatchObject({ handle: expect.any(String) })
    expect(first.items.some((v) => hidden.includes(v.id))).toBe(false)
  })

  it('pages through everything exactly once with the cursor', async () => {
    const first = await getPage()
    expect(first.nextCursor).toEqual(expect.any(String))

    const second = await getPage(first.nextCursor!)

    expect(ids(second.items)).toEqual(ids(listed.slice(FEED_PAGE_SIZE)))
    expect(second.nextCursor).toBeNull()
  })

  it('neither skips nor repeats a video published at the same instant as the cursor', async () => {
    const [firstTied, secondTied] = listed.filter((v) => v.publishedAt === TIE)

    const page = await getPage(encodeCursor({ at: firstTied!.publishedAt, id: firstTied!.id }))

    expect(page.items[0]!.id).toBe(secondTied!.id)
  })

  it('rejects a cursor it did not produce', async () => {
    const res = await callApi('/api/videos?cursor=not-a-cursor')
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'invalid_cursor' })
  })
})
