import { env } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'

import { uuidv7 } from '../lib/id'
import { signUp } from '../test/helpers'
import { getDb } from './client'
import { channels, videos } from './schema'

const db = getDb(env.DB)

// The video ids whose indexed text matches an FTS5 query.
async function matching(query: string) {
  const { results } = await env.DB.prepare(
    'SELECT video_id FROM videos_fts WHERE videos_fts MATCH ?1 ORDER BY video_id',
  )
    .bind(query)
    .all<{ video_id: string }>()
  return results.map((r) => r.video_id)
}

let channelId: string
beforeAll(async () => {
  ;({ channelId } = await signUp())
})

let seq = 0
async function insertVideo(title: string, description = '') {
  const id = uuidv7()
  await db.insert(videos).values({
    id,
    channelId,
    streamUid: `fts-${Date.now()}-${seq++}`,
    title,
    description,
    createdAt: Date.now(),
  })
  return id
}

describe('videos_fts triggers', () => {
  it('indexes the title and description of a new video', async () => {
    const id = await insertVideo('Sourdough basics', 'Feeding a starter every morning')
    expect(await matching('sourdough')).toEqual([id])
    expect(await matching('starter')).toEqual([id])
  })

  it('folds case and accents', async () => {
    const id = await insertVideo('Crème Brûlée at home')
    expect(await matching('creme brulee')).toEqual([id])
  })

  it('re-indexes on a title or description edit', async () => {
    const id = await insertVideo('Kayak rolling drills', 'Calm lake')
    await db
      .update(videos)
      .set({ title: 'Canoe portage tips', description: 'Windy river' })
      .where(eq(videos.id, id))
    expect(await matching('kayak')).toEqual([])
    expect(await matching('lake')).toEqual([])
    expect(await matching('portage')).toEqual([id])
    expect(await matching('windy')).toEqual([id])
  })

  it('leaves the index alone on counter and status updates', async () => {
    const id = await insertVideo('Glacier timelapse')
    await db
      .update(videos)
      .set({ viewCount: 42, status: 'ready', visibility: 'unlisted' })
      .where(eq(videos.id, id))
    expect(await matching('glacier')).toEqual([id])
  })

  it('drops a deleted video, including one removed by a channel cascade', async () => {
    const direct = await insertVideo('Origami crane')
    await db.delete(videos).where(eq(videos.id, direct))
    expect(await matching('origami')).toEqual([])

    const other = await signUp()
    const cascaded = uuidv7()
    await db.insert(videos).values({
      id: cascaded,
      channelId: other.channelId,
      streamUid: `fts-cascade-${cascaded}`,
      title: 'Lighthouse restoration',
      createdAt: Date.now(),
    })
    expect(await matching('lighthouse')).toEqual([cascaded])
    await db.delete(channels).where(eq(channels.id, other.channelId))
    expect(await matching('lighthouse')).toEqual([])
  })
})
