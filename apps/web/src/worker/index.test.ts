import { exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

describe('worker', () => {
  it('serves the Hono app under /api', async () => {
    const res = await exports.default.fetch('http://example.com/api/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })
})
