import * as Sentry from '@sentry/cloudflare'
import { createMiddleware } from 'hono/factory'

import { getDb } from '../db/client'
import { ApiError } from '../lib/errors'
import { clearSessionCookie, getSessionToken, loadSession } from '../lib/session'
import type { AppEnv, SessionUser } from '../types'

// Sets c.var.user when the session cookie maps to a live session; clears a stale cookie.
// Also tags this request's Sentry scope with the user id (never email).
export const sessionLoader = createMiddleware<AppEnv>(async (c, next) => {
  const token = getSessionToken(c)
  if (token) {
    const user = await loadSession(getDb(c.env.DB), token, c.env.AUTH_SECRET)
    if (user) {
      c.set('user', user)
      Sentry.setUser({ id: user.id })
    } else {
      clearSessionCookie(c)
    }
  }
  await next()
})

// Guards a route: 401 without a session; after it, c.var.user is typed as defined.
export const requireUser = createMiddleware<{ Variables: { user: SessionUser } }>(
  async (c, next) => {
    if (!c.get('user')) throw new ApiError(401, 'unauthorized')
    await next()
  },
)
