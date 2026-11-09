import { env } from 'cloudflare:workers'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getDb } from '../db/client'
import { channels, sessions, users } from '../db/schema'
import { mockTurnstile, postJson, signupBody } from '../test/helpers'

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
