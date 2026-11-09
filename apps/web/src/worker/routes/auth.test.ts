import { env } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getDb } from '../db/client'
import { channels, sessions, users } from '../db/schema'
import { verifyPassword } from '../lib/password'
import { callApi, mockTurnstile, postJson, sessionCookie, signupBody } from '../test/helpers'

const db = getDb(env.DB)

afterEach(() => vi.restoreAllMocks())

describe('POST /api/auth/signup', () => {
  it('creates user, channel and session, and sets the session cookie', async () => {
    mockTurnstile()
    const body = signupBody()
    const res = await postJson('/api/auth/signup', {
      ...body,
      email: `  ${body.email.toUpperCase()} `,
    })

    expect(res.status).toBe(201)
    const me = await res.json<{
      user: { id: string; email: string }
      channel: { handle: string }
    }>()
    expect(me.user.email).toBe(body.email)
    expect(me.channel.handle).toBe(body.handle)
    expect(JSON.stringify(me)).not.toMatch(/password|session/i)

    const cookie = res.headers.get('set-cookie') ?? ''
    expect(cookie).toMatch(/^vf_session=[\w-]{43};/)
    expect(cookie).toContain('HttpOnly')

    const user = await db.select().from(users).where(eq(users.id, me.user.id)).get()
    expect(user?.passwordHash).toMatch(/^pbkdf2_sha256\$100000\$/)
    expect(user?.passwordHash).not.toContain(body.password)
    expect(
      await db.select().from(channels).where(eq(channels.userId, me.user.id)).get(),
    ).toBeTruthy()
    expect(
      await db.select().from(sessions).where(eq(sessions.userId, me.user.id)).all(),
    ).toHaveLength(1)
  })

  it('verifies the Turnstile token with the secret and client IP', async () => {
    const siteverify = mockTurnstile()
    await postJson('/api/auth/signup', signupBody(), { 'CF-Connecting-IP': '203.0.113.7' })

    const [, init] = siteverify.mock.calls[0] ?? []
    const form = init?.body as FormData
    expect(form.get('secret')).toBe(env.TURNSTILE_SECRET)
    expect(form.get('response')).toBe('test-token')
    expect(form.get('remoteip')).toBe('203.0.113.7')
  })

  it('rejects a failed Turnstile check without creating anything', async () => {
    mockTurnstile(false)
    const body = signupBody()
    const res = await postJson('/api/auth/signup', body)
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: 'turnstile_failed' })
    expect(await db.select().from(users).where(eq(users.email, body.email)).get()).toBeUndefined()
  })

  it('409s on a taken email or handle', async () => {
    mockTurnstile()
    const first = signupBody()
    expect((await postJson('/api/auth/signup', first)).status).toBe(201)

    const sameEmail = await postJson('/api/auth/signup', signupBody({ email: first.email }))
    expect(sameEmail.status).toBe(409)
    expect(await sameEmail.json()).toMatchObject({ error: 'email_taken' })

    const sameHandle = await postJson('/api/auth/signup', signupBody({ handle: first.handle }))
    expect(sameHandle.status).toBe(409)
    expect(await sameHandle.json()).toMatchObject({ error: 'handle_taken' })
  })

  it('400s on invalid input before calling Turnstile', async () => {
    const siteverify = mockTurnstile()
    const res = await postJson('/api/auth/signup', signupBody({ handle: 'no spaces allowed' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({
      error: 'invalid_request',
      issues: [{ path: 'handle' }],
    })
    expect(siteverify).not.toHaveBeenCalled()
  })
})

// Signs a fresh user up and returns its credentials and session cookie.
async function signedUp() {
  mockTurnstile()
  const body = signupBody()
  const res = await postJson('/api/auth/signup', body)
  vi.restoreAllMocks()
  return { ...body, cookie: sessionCookie(res) }
}

describe('POST /api/auth/login', () => {
  it('starts a new session for valid credentials', async () => {
    const user = await signedUp()
    const res = await postJson('/api/auth/login', {
      email: user.email.toUpperCase(),
      password: user.password,
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      user: { email: user.email },
      channel: { handle: user.handle },
    })
    const cookie = sessionCookie(res)
    expect(cookie).toMatch(/^vf_session=/)
    expect(cookie).not.toBe(user.cookie)
  })

  it('answers a wrong password and an unknown email identically', async () => {
    const user = await signedUp()
    const wrong = await postJson('/api/auth/login', { email: user.email, password: 'nope-nope' })
    const unknown = await postJson('/api/auth/login', {
      email: `nobody_${Date.now()}@example.com`,
      password: user.password,
    })
    for (const res of [wrong, unknown]) {
      expect(res.status).toBe(401)
      expect(await res.json()).toMatchObject({ error: 'invalid_credentials' })
      expect(res.headers.get('set-cookie')).toBeNull()
    }
  })
})

describe('GET /api/me', () => {
  it('401s without a session', async () => {
    const res = await callApi('/api/me')
    expect(res.status).toBe(401)
  })

  it('returns the signed-in user and channel', async () => {
    const user = await signedUp()
    const res = await callApi('/api/me', { headers: { cookie: user.cookie } })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      user: { email: user.email },
      channel: { handle: user.handle, name: user.name, avatarKey: null },
    })
  })
})

describe('POST /api/auth/logout', () => {
  it('ends the session and clears the cookie', async () => {
    const user = await signedUp()
    const res = await callApi('/api/auth/logout', {
      method: 'POST',
      headers: { cookie: user.cookie },
    })
    expect(res.status).toBe(204)
    expect(res.headers.get('set-cookie')).toContain('vf_session=;')

    const after = await callApi('/api/me', { headers: { cookie: user.cookie } })
    expect(after.status).toBe(401)
  })

  it('401s without a session', async () => {
    expect((await callApi('/api/auth/logout', { method: 'POST' })).status).toBe(401)
  })
})

describe('verifyPassword', () => {
  it('rejects malformed stored hashes', async () => {
    expect(await verifyPassword('x', '')).toBe(false)
    expect(await verifyPassword('x', 'bcrypt$10$abc$def')).toBe(false)
  })
})
