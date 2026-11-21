import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'

import { base64url, utf8 } from '../lib/encoding'
import { ApiError } from '../lib/errors'
import type { AppEnv } from '../types'

// Workers Rate Limiting bindings (wrangler.jsonc `ratelimits`). Each counts requests per key
// per Cloudflare location over its period:
//   AUTH_LIMITER     sign-up and login: per IP, and per email for login
//   COMMENT_LIMITER  posting a comment: per user
//   UPLOAD_LIMITER   creating an upload: per user
//   VIEW_LIMITER     recording a view: per IP (views are also deduped per viewer in VideoStats)
export type LimiterBinding = 'AUTH_LIMITER' | 'COMMENT_LIMITER' | 'UPLOAD_LIMITER' | 'VIEW_LIMITER'

// Every limiter's period: clients are told to wait this long after a 429.
export const RETRY_AFTER_S = 60

// The visitor's IP as Cloudflare saw it. Always set on deployed Workers; missing only in local
// dev and tests, where IP-keyed limits are skipped.
export const clientIp = (c: Context<AppEnv>) => c.req.header('CF-Connecting-IP') ?? null

// A key that doesn't carry the raw value (e.g. an email) into the rate limiter.
export async function hashedKey(prefix: string, value: string) {
  const digest = await crypto.subtle.digest('SHA-256', utf8(value))
  return `${prefix}:${base64url(digest)}`
}

// Counts one request against each key and throws 429 `rate_limited` (with Retry-After) as soon
// as one is over its limit. null keys are skipped. If the limiter itself fails the request
// goes through: losing the limit for a moment beats failing every sign-in or comment.
export async function enforceRateLimit(
  c: Context<AppEnv>,
  binding: LimiterBinding,
  keys: (string | null)[],
) {
  for (const key of keys) {
    if (!key) continue
    let success: boolean
    try {
      ;({ success } = await c.env[binding].limit({ key }))
    } catch (err) {
      console.warn(
        JSON.stringify({
          msg: 'rate_limit.unavailable',
          binding,
          error: err instanceof Error ? err.name : 'unknown',
        }),
      )
      continue
    }
    if (!success) {
      // Ids only: never the key, which can hold an IP.
      console.warn(
        JSON.stringify({
          msg: 'rate_limited',
          binding,
          route: c.req.routePath,
          userId: c.var.user?.id,
        }),
      )
      c.header('Retry-After', String(RETRY_AFTER_S))
      throw new ApiError(429, 'rate_limited')
    }
  }
}

// Route middleware form, for limits whose key doesn't depend on the request body.
export const rateLimit = (binding: LimiterBinding, key: (c: Context<AppEnv>) => string | null) =>
  createMiddleware<AppEnv>(async (c, next) => {
    await enforceRateLimit(c, binding, [key(c)])
    await next()
  })

// Keys for the per-user limits (behind requireUser) and the per-IP ones.
export const byUser = (c: Context<AppEnv>) => (c.var.user ? `user:${c.var.user.id}` : null)
export const byIp = (c: Context<AppEnv>) => {
  const ip = clientIp(c)
  return ip ? `ip:${ip}` : null
}
