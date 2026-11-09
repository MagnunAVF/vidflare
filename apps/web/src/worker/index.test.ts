import { exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

describe('worker', () => {
  it('handles /api/* requests', async () => {
    const res = await exports.default.fetch('http://example.com/api/ping')
    expect(res.status).toBe(200)
  })
})
