import { env } from 'cloudflare:workers'
import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'

import { getDb } from '../db/client'
import { channels, sessions, users } from '../db/schema'
import { uuidv7 } from './id'
import {
  clearSessionCookie,
  deleteSession,
  loadSession,
  newSession,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  sessionIdFromToken,
  setSessionCookie,
} from './session'

describe('uuidv7', () => {
  it('is a version 7 UUID that sorts by time', () => {
    const a = uuidv7(1_000)
    const b = uuidv7(2_000)
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(a < b).toBe(true)
  })
})

describe('session id', () => {
  it('is a keyed hash of the token, not the token itself', async () => {
    const id = await sessionIdFromToken('token', 'secret')
    expect(id).not.toContain('token')
    expect(await sessionIdFromToken('token', 'secret')).toBe(id)
    expect(await sessionIdFromToken('token', 'other-secret')).not.toBe(id)
  })

  it('refuses to run without AUTH_SECRET', async () => {
    await expect(sessionIdFromToken('token', '')).rejects.toThrow('AUTH_SECRET')
  })
})

describe('session cookie', () => {
  const app = new Hono()
    .get('/set', (c) => {
      setSessionCookie(c, 'tok', Date.now() + SESSION_TTL_MS)
      return c.body(null, 204)
    })
    .get('/clear', (c) => {
      clearSessionCookie(c)
      return c.body(null, 204)
    })

  it('is HttpOnly, Secure, SameSite=Lax and site-wide', async () => {
    const cookie = (await app.request('/set')).headers.get('set-cookie') ?? ''
    expect(cookie).toContain(`${SESSION_COOKIE}=tok`)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).toContain('Path=/')
    expect(cookie).toContain(
      `Expires=${new Date(Date.now() + SESSION_TTL_MS).toUTCString().slice(0, 16)}`,
    )
  })

  it('is cleared with the same attributes', async () => {
    const cookie = (await app.request('/clear')).headers.get('set-cookie') ?? ''
    expect(cookie).toContain(`${SESSION_COOKIE}=;`)
    expect(cookie).toContain('Max-Age=0')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
  })
})

describe('session store', () => {
  const db = getDb(env.DB)

  // D1 state is shared by the tests in a file, so every test gets its own user.
  async function seedUser() {
    const userId = uuidv7()
    const handle = `u${userId.slice(-12)}`
    await db.batch([
      db
        .insert(users)
        .values({ id: userId, email: `${handle}@example.com`, passwordHash: 'x', createdAt: 1 }),
      db.insert(channels).values({ id: uuidv7(), userId, handle, name: 'Alice', createdAt: 1 }),
    ])
    return { userId, handle }
  }

  it('loads the user and channel for a live session, and nothing once deleted', async () => {
    const { userId, handle } = await seedUser()
    const { token, row } = await newSession(userId, env.AUTH_SECRET)
    await db.insert(sessions).values(row)

    const user = await loadSession(db, token, env.AUTH_SECRET)
    expect(user).toMatchObject({ id: userId, email: `${handle}@example.com`, channel: { handle } })

    await deleteSession(db, row.id)
    expect(await loadSession(db, token, env.AUTH_SECRET)).toBeNull()
  })

  it('ignores expired sessions and unknown tokens', async () => {
    const { userId } = await seedUser()
    const { token, row } = await newSession(userId, env.AUTH_SECRET, 0)
    await db.insert(sessions).values(row)
    expect(await loadSession(db, token, env.AUTH_SECRET)).toBeNull()
    expect(await loadSession(db, 'not-a-token', env.AUTH_SECRET)).toBeNull()
  })
})
