import { loginInput, signupInput } from '@vidflare/shared'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'

import { getDb } from '../db/client'
import { channels, sessions, users } from '../db/schema'
import { ApiError } from '../lib/errors'
import { uuidv7 } from '../lib/id'
import { toMeResponse } from '../lib/me'
import { hashPassword, verifyPassword } from '../lib/password'
import { telemetry } from '../lib/telemetry'
import { clearSessionCookie, deleteSession, newSession, setSessionCookie } from '../lib/session'
import { byIp, enforceRateLimit, hashedKey } from '../middleware/rate-limit'
import { requireUser } from '../middleware/session'
import { validate } from '../middleware/validate'
import { verifyTurnstile } from '../services/turnstile'
import type { AppEnv } from '../types'

// Maps a unique-constraint failure from a concurrent sign-up to the same 409 as the pre-check.
function conflictCode(err: unknown): string | null {
  const message = err instanceof Error ? `${err.message} ${String(err.cause ?? '')}` : ''
  if (message.includes('users.email')) return 'email_taken'
  if (message.includes('channels.handle')) return 'handle_taken'
  return null
}

export const auth = new Hono<AppEnv>()
  .post('/signup', validate('json', signupInput), async (c) => {
    const input = c.req.valid('json')

    // Cheap rejections first: floods, bots, then taken email/handle, and only then the PBKDF2
    // cost. Sign-up and login share the per-IP auth limit.
    await enforceRateLimit(c, 'AUTH_LIMITER', [byIp(c)])
    const human = await verifyTurnstile(
      c.env.TURNSTILE_SECRET,
      input.turnstileToken,
      c.req.header('CF-Connecting-IP'),
    )
    if (!human) throw new ApiError(403, 'turnstile_failed')

    const db = getDb(c.env.DB)
    const [emailTaken, handleTaken] = await Promise.all([
      db.select({ id: users.id }).from(users).where(eq(users.email, input.email)).get(),
      db.select({ id: channels.id }).from(channels).where(eq(channels.handle, input.handle)).get(),
    ])
    if (emailTaken) throw new ApiError(409, 'email_taken')
    if (handleTaken) throw new ApiError(409, 'handle_taken')

    const now = Date.now()
    const userId = uuidv7(now)
    const channel = { id: uuidv7(now), handle: input.handle, name: input.name, avatarKey: null }
    const passwordHash = await hashPassword(input.password)
    const session = await newSession(userId, c.env.AUTH_SECRET, now)

    // D1 has no interactive transactions: one batch commits all three rows or none.
    try {
      await db.batch([
        db.insert(users).values({ id: userId, email: input.email, passwordHash, createdAt: now }),
        db.insert(channels).values({ ...channel, userId, createdAt: now }),
        db.insert(sessions).values(session.row),
      ])
    } catch (err) {
      const code = conflictCode(err)
      if (code) throw new ApiError(409, code)
      throw err
    }

    setSessionCookie(c, session.token, session.row.expiresAt)
    return c.json(toMeResponse({ id: userId, email: input.email, channel }), 201)
  })
  .post('/login', validate('json', loginInput), async (c) => {
    const { email, password } = c.req.valid('json')
    // Brute force: per IP (many accounts from one place) and per account (one account from many
    // places), before any D1 read or PBKDF2 work. Over the limit is a 429 either way, so it
    // doesn't reveal whether the email has an account.
    try {
      await enforceRateLimit(c, 'AUTH_LIMITER', [byIp(c), await hashedKey('email', email)])
    } catch (err) {
      // Blocked guesses are the clearest brute-force signal: count them too.
      if (err instanceof ApiError && err.status === 429) {
        telemetry.count('auth.login_failed', { reason: 'rate_limited' })
      }
      throw err
    }
    const db = getDb(c.env.DB)
    const row = await db
      .select({
        id: users.id,
        email: users.email,
        passwordHash: users.passwordHash,
        channelId: channels.id,
        handle: channels.handle,
        name: channels.name,
        avatarKey: channels.avatarKey,
      })
      .from(users)
      .innerJoin(channels, eq(channels.userId, users.id))
      .where(eq(users.email, email))
      .get()

    // Always run one PBKDF2 verify so an unknown email answers like a wrong password,
    // in the same time and with the same error.
    const valid = await verifyPassword(password, row?.passwordHash ?? (await dummyHash()))
    if (!row || !valid) {
      // No hint of which: unknown email and wrong password count the same.
      telemetry.count('auth.login_failed', { reason: 'invalid_credentials' })
      throw new ApiError(401, 'invalid_credentials')
    }

    const session = await newSession(row.id, c.env.AUTH_SECRET)
    await db.insert(sessions).values(session.row)
    setSessionCookie(c, session.token, session.row.expiresAt)
    return c.json(
      toMeResponse({
        id: row.id,
        email: row.email,
        channel: {
          id: row.channelId,
          handle: row.handle,
          name: row.name,
          avatarKey: row.avatarKey,
        },
      }),
      200,
    )
  })
  .post('/logout', requireUser, async (c) => {
    await deleteSession(getDb(c.env.DB), c.var.user.sessionId)
    clearSessionCookie(c)
    return c.body(null, 204)
  })

// Created on first use: Workers don't allow random generation at module load.
let dummy: Promise<string> | undefined
const dummyHash = () => (dummy ??= hashPassword('not-a-real-password'))
