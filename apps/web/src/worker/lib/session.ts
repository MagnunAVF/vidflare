import { and, eq, gt } from 'drizzle-orm'
import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'

import type { Db } from '../db/client'
import { channels, sessions, users } from '../db/schema'
import type { SessionUser } from '../types'
import { base64url, utf8 } from './encoding'

export const SESSION_COOKIE = 'vf_session'
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

// The cookie carries a random token; D1 only stores HMAC(AUTH_SECRET, token) as the session
// id, so a leaked sessions table can't be replayed as cookies.
export async function sessionIdFromToken(token: string, secret: string): Promise<string> {
  if (!secret) throw new Error('AUTH_SECRET is not set')
  const key = await crypto.subtle.importKey(
    'raw',
    utf8(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return base64url(await crypto.subtle.sign('HMAC', key, utf8(token)))
}

// A new session: the token for the cookie and the row to insert (callers batch the insert).
export async function newSession(userId: string, secret: string, now = Date.now()) {
  const token = base64url(crypto.getRandomValues(new Uint8Array(32)))
  const row = {
    id: await sessionIdFromToken(token, secret),
    userId,
    expiresAt: now + SESSION_TTL_MS,
  }
  return { token, row }
}

export function setSessionCookie(c: Context, token: string, expiresAt: number) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    expires: new Date(expiresAt),
  })
}

export function clearSessionCookie(c: Context) {
  deleteCookie(c, SESSION_COOKIE, { httpOnly: true, secure: true, sameSite: 'Lax', path: '/' })
}

export const getSessionToken = (c: Context) => getCookie(c, SESSION_COOKIE)

// The user behind a session token, or null if the session is unknown or expired.
export async function loadSession(
  db: Db,
  token: string,
  secret: string,
  now = Date.now(),
): Promise<SessionUser | null> {
  const id = await sessionIdFromToken(token, secret)
  const row = await db
    .select({
      sessionId: sessions.id,
      id: users.id,
      email: users.email,
      channelId: channels.id,
      handle: channels.handle,
      name: channels.name,
      avatarKey: channels.avatarKey,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(channels, eq(channels.userId, users.id))
    .where(and(eq(sessions.id, id), gt(sessions.expiresAt, now)))
    .get()
  if (!row) return null
  return {
    id: row.id,
    email: row.email,
    sessionId: row.sessionId,
    channel: { id: row.channelId, handle: row.handle, name: row.name, avatarKey: row.avatarKey },
  }
}

export const deleteSession = (db: Db, sessionId: string) =>
  db.delete(sessions).where(eq(sessions.id, sessionId))
