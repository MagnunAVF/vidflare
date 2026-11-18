import type { Context } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'

import type { AppEnv } from '../types'
import { base64url, utf8 } from './encoding'

// Anonymous viewers get a random id in this cookie on their first view, so their views can be
// deduped like a signed-in session's. It identifies a browser, never a person.
export const VIEWER_COOKIE = 'vf_viewer'
const VIEWER_TTL_MS = 365 * 24 * 60 * 60 * 1000
// 32 random bytes, base64url.
const VIEWER_TOKEN = /^[A-Za-z0-9_-]{43}$/

async function hmac(secret: string, message: string) {
  if (!secret) throw new Error('AUTH_SECRET is not set')
  const key = await crypto.subtle.importKey(
    'raw',
    utf8(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return base64url(await crypto.subtle.sign('HMAC', key, utf8(message)))
}

// The key VideoStats dedupes views by: the signed-in session, or else the anonymous viewer
// cookie (set on this response if missing). HMAC'd with AUTH_SECRET so the Durable Object
// never stores a session id or cookie value.
export async function viewerKey(c: Context<AppEnv>): Promise<string> {
  const user = c.get('user')
  if (user) return hmac(c.env.AUTH_SECRET, `session:${user.sessionId}`)

  let token = getCookie(c, VIEWER_COOKIE)
  if (!token || !VIEWER_TOKEN.test(token)) {
    token = base64url(crypto.getRandomValues(new Uint8Array(32)))
    setCookie(c, VIEWER_COOKIE, token, {
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      path: '/',
      expires: new Date(Date.now() + VIEWER_TTL_MS),
    })
  }
  return hmac(c.env.AUTH_SECRET, `anon:${token}`)
}
