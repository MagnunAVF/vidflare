import { signupInput } from '@vidflare/shared'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'

import { getDb } from '../db/client'
import { channels, sessions, users } from '../db/schema'
import { ApiError } from '../lib/errors'
import { uuidv7 } from '../lib/id'
import { toMeResponse } from '../lib/me'
import { hashPassword } from '../lib/password'
import { newSession, setSessionCookie } from '../lib/session'
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

export const auth = new Hono<AppEnv>().post('/signup', validate('json', signupInput), async (c) => {
  const input = c.req.valid('json')

  // Cheap rejections first: bots, then taken email/handle, and only then the PBKDF2 cost.
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
