import { env } from 'cloudflare:workers'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getDb } from '../db/client'
import { videos } from '../db/schema'
import { notFound, onError } from '../lib/errors'
import { uuidv7 } from '../lib/id'
import { callApi, mockTurnstile, postJson, signUp, signupBody } from '../test/helpers'
import type { AppEnv } from '../types'
import { byIp, enforceRateLimit, rateLimit, RETRY_AFTER_S } from './rate-limit'
import { requestContext } from './request-context'

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

// A random IP from 10.0.0.0/8 per call, so counts from one test never leak into another (the
// limiter's state isn't reset between tests).
const newIp = () => `10.${Array.from(crypto.getRandomValues(new Uint8Array(3))).join('.')}`

// Calls `send` until it answers 429; returns how many calls got through first (max `cap`).
async function allowedBefore429(send: () => Promise<Response>, cap: number) {
  for (let i = 0; i < cap; i++) {
    const res = await send()
    if (res.status === 429) {
      expect(res.headers.get('Retry-After')).toBe(String(RETRY_AFTER_S))
      expect(await res.json()).toMatchObject({ error: 'rate_limited' })
      return i
    }
  }
  return cap
}

describe('enforceRateLimit', () => {
  const appWith = (limit: () => Promise<{ success: boolean }>) => {
    const app = new Hono<AppEnv>()
      .use(requestContext)
      .onError(onError)
      .notFound(notFound)
      .get('/limited', rateLimit('AUTH_LIMITER', byIp), (c) => c.json({ ok: true }))
      .get('/two-keys', async (c) => {
        await enforceRateLimit(c, 'AUTH_LIMITER', ['a', null, 'b'])
        return c.json({ ok: true })
      })
    const limiter = { limit: vi.fn(limit) }
    const request = (path: string, ip?: string) =>
      app.request(path, { headers: ip ? { 'CF-Connecting-IP': ip } : {} }, {
        AUTH_LIMITER: limiter,
      } as unknown as Env)
    return { request, limiter }
  }

  it('answers 429 rate_limited with Retry-After when over the limit', async () => {
    const { request, limiter } = appWith(async () => ({ success: false }))
    const res = await request('/limited', '203.0.113.9')
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('60')
    expect(await res.json()).toMatchObject({ error: 'rate_limited' })
    expect(limiter.limit).toHaveBeenCalledWith({ key: 'ip:203.0.113.9' })
  })

  it('skips null keys (no IP outside Cloudflare) and checks every other key', async () => {
    const { request, limiter } = appWith(async () => ({ success: true }))
    expect((await request('/limited')).status).toBe(200)
    expect(limiter.limit).not.toHaveBeenCalled()
    expect((await request('/two-keys')).status).toBe(200)
    expect(limiter.limit.mock.calls).toEqual([[{ key: 'a' }], [{ key: 'b' }]])
  })

  it('lets the request through when the limiter itself fails', async () => {
    const { request } = appWith(async () => {
      throw new Error('limiter down')
    })
    expect((await request('/limited', '203.0.113.9')).status).toBe(200)
  })
})

// Against the real bindings (Miniflare's rate limiter, limits from wrangler.jsonc).
describe('rate-limited routes', () => {
  it('limits login per IP (10/min), before any password check', async () => {
    const ip = newIp()
    const allowed = await allowedBefore429(
      () =>
        postJson(
          '/api/auth/login',
          { email: `nobody_${ip}_${Math.random()}@example.com`, password: 'wrong-password' },
          { 'CF-Connecting-IP': ip },
        ),
      15,
    )
    expect(allowed).toBe(10)
  })

  it('limits login per account across IPs', async () => {
    const email = `target_${Date.now()}@example.com`
    const allowed = await allowedBefore429(
      () =>
        postJson(
          '/api/auth/login',
          { email, password: 'wrong-password' },
          { 'CF-Connecting-IP': newIp() },
        ),
      15,
    )
    expect(allowed).toBe(10)
  })

  it('counts sign-ups against the same per-IP auth limit', async () => {
    const ip = newIp()
    mockTurnstile(false)
    const allowed = await allowedBefore429(
      () => postJson('/api/auth/signup', signupBody(), { 'CF-Connecting-IP': ip }),
      15,
    )
    expect(allowed).toBe(10)
  })

  it('limits comments per user (5/min), before the Turnstile check', async () => {
    const { cookie, channelId } = await signUp()
    const videoId = uuidv7()
    await getDb(env.DB)
      .insert(videos)
      .values({
        id: videoId,
        channelId,
        streamUid: `rl-${videoId}`,
        title: 'Rate limits',
        status: 'ready',
        createdAt: Date.now(),
        publishedAt: Date.now(),
      })
    const siteverify = mockTurnstile()
    const allowed = await allowedBefore429(
      () =>
        postJson(
          `/api/videos/${videoId}/comments`,
          { body: 'hi', turnstileToken: 't' },
          { cookie },
        ),
      10,
    )
    expect(allowed).toBe(5)
    // The 429 never reached siteverify.
    expect(siteverify).toHaveBeenCalledTimes(5)
  })

  it('limits upload creation per user (5/min), before validation', async () => {
    const { cookie } = await signUp()
    // Invalid bodies are enough: the limit runs before the validator (and Stream).
    const allowed = await allowedBefore429(
      () => postJson('/api/videos/uploads', {}, { cookie }),
      10,
    )
    expect(allowed).toBe(5)
  })

  it('limits views per IP (60/min) and not without one', async () => {
    const ip = newIp()
    const missing = uuidv7() // 404s still count: the limit runs first
    const allowed = await allowedBefore429(
      () =>
        callApi(`/api/videos/${missing}/view`, {
          method: 'POST',
          headers: { 'CF-Connecting-IP': ip },
        }),
      70,
    )
    expect(allowed).toBe(60)
    expect((await callApi(`/api/videos/${missing}/view`, { method: 'POST' })).status).toBe(404)
  })
})
