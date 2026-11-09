import { env, exports } from 'cloudflare:workers'
import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { getDb } from '../db/client'
import { channels, sessions, users } from '../db/schema'
import { ApiError, notFound, onError } from '../lib/errors'
import { uuidv7 } from '../lib/id'
import { newSession, SESSION_COOKIE } from '../lib/session'
import type { AppEnv } from '../types'
import { requestContext } from './request-context'
import { requireUser, sessionLoader } from './session'
import { validate } from './validate'

// Same middleware stack as the real app, with routes that exercise each piece.
const app = new Hono<AppEnv>()
  .use(requestContext)
  .use(sessionLoader)
  .onError(onError)
  .notFound(notFound)
  .get('/boom', () => {
    throw new Error('kaboom')
  })
  .get('/teapot', () => {
    throw new ApiError(418, 'teapot')
  })
  .get('/private', requireUser, (c) => c.json({ id: c.var.user.id }))
  .post('/echo', validate('json', z.object({ n: z.number() })), (c) => c.json(c.req.valid('json')))

const request = (path: string, init?: RequestInit) => app.request(path, init, env)

async function signedInCookie() {
  const db = getDb(env.DB)
  const userId = uuidv7()
  const handle = `u${userId.slice(-12)}`
  await db.batch([
    db
      .insert(users)
      .values({ id: userId, email: `${handle}@example.com`, passwordHash: 'x', createdAt: 1 }),
    db.insert(channels).values({ id: uuidv7(), userId, handle, name: 'N', createdAt: 1 }),
  ])
  const { token, row } = await newSession(userId, env.AUTH_SECRET)
  await db.insert(sessions).values(row)
  return { userId, cookie: `${SESSION_COOKIE}=${token}` }
}

describe('request context', () => {
  it('returns X-Request-Id and logs one structured line without the raw URL', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const res = await request('/teapot?q=secret-search')
    const requestId = res.headers.get('x-request-id')
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/)

    const line = JSON.parse(String(log.mock.calls.at(-1)?.[0]))
    expect(line).toMatchObject({
      msg: 'request',
      requestId,
      method: 'GET',
      route: '/teapot',
      status: 418,
    })
    expect(JSON.stringify(line)).not.toContain('secret-search')
    log.mockRestore()
  })
})

describe('errors', () => {
  it('maps ApiError to its status and code', async () => {
    const res = await request('/teapot')
    expect(res.status).toBe(418)
    expect(await res.json()).toEqual({
      error: 'teapot',
      requestId: res.headers.get('x-request-id'),
    })
  })

  it('hides unexpected errors behind internal_error', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await request('/boom')
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ error: 'internal_error' })
    error.mockRestore()
  })

  it('returns JSON 404s, also from the real app', async () => {
    const res = await exports.default.fetch('http://example.com/api/nope')
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ error: 'not_found' })
  })

  it('returns invalid_request with issues for bad input', async () => {
    const res = await request('/echo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ n: 'x' }),
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'invalid_request', issues: [{ path: 'n' }] })
  })
})

describe('session loader and requireUser', () => {
  it('401s without a session', async () => {
    const res = await request('/private')
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ error: 'unauthorized' })
  })

  it('loads the user from a valid session cookie', async () => {
    const { userId, cookie } = await signedInCookie()
    const res = await request('/private', { headers: { cookie } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: userId })
  })

  it('clears a stale cookie', async () => {
    const res = await request('/private', { headers: { cookie: `${SESSION_COOKIE}=bogus` } })
    expect(res.status).toBe(401)
    expect(res.headers.get('set-cookie')).toContain(`${SESSION_COOKIE}=;`)
  })
})
