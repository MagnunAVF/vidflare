import { runInDurableObject } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

// Every binding in wrangler.jsonc must work locally (Miniflare), without any remote resource.
describe('local bindings', () => {
  it('D1 (DB)', async () => {
    const row = await env.DB.prepare('select 1 as one').first<{ one: number }>()
    expect(row?.one).toBe(1)
  })

  it('KV (CACHE)', async () => {
    await env.CACHE.put('k', 'v')
    expect(await env.CACHE.get('k')).toBe('v')
  })

  it('R2 (MEDIA)', async () => {
    await env.MEDIA.put('avatars/test.txt', 'hello')
    expect(await (await env.MEDIA.get('avatars/test.txt'))?.text()).toBe('hello')
  })

  it('Queue producer (EVENTS)', async () => {
    // Rejects (and fails the test) if the local queue isn't wired up.
    await env.EVENTS.send({ type: 'test' })
  })

  it('Durable Object (VIDEO_STATS) with SQLite storage', async () => {
    const stub = env.VIDEO_STATS.get(env.VIDEO_STATS.idFromName('video-1'))
    await runInDurableObject(stub, (_instance, state) => {
      const row = state.storage.sql.exec('select 1 as one').one()
      expect(row.one).toBe(1)
    })
  })
})
