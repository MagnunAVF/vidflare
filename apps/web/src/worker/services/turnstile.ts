import * as Sentry from '@sentry/cloudflare'

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
// A slow siteverify must not hold the request: give up and treat it as a failed challenge.
const SITEVERIFY_TIMEOUT_MS = 5000
// Error codes that mean our secret is wrong, not that the visitor failed: nobody can pass
// until it is fixed, so they are reported to Sentry.
const CONFIG_ERRORS = new Set(['missing-input-secret', 'invalid-input-secret'])

interface SiteverifyResult {
  success?: boolean
  'error-codes'?: string[]
}

const log = (level: 'warn' | 'error', msg: string, fields: Record<string, unknown>) =>
  console[level](JSON.stringify({ msg, ...fields }))

// Server-side check of a Turnstile token: true only when Cloudflare's siteverify says so.
// Fails closed: a network error, timeout or non-200 answer is a failed challenge (the caller
// responds 403 and the widget offers a new one), never a pass. Locally TURNSTILE_SECRET is
// Cloudflare's always-pass test secret (see .dev.vars.example). The response's hostname and
// action aren't checked: test secrets answer with example.com and no action, and each
// environment's widget is already limited to that environment's hostnames.
export async function verifyTurnstile(
  secret: string,
  token: string,
  remoteIp?: string,
): Promise<boolean> {
  const body = new FormData()
  body.append('secret', secret)
  body.append('response', token)
  if (remoteIp) body.append('remoteip', remoteIp)

  let result: SiteverifyResult
  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MS),
    })
    if (!res.ok) {
      log('warn', 'turnstile.unavailable', { status: res.status })
      return false
    }
    result = await res.json<SiteverifyResult>()
  } catch (err) {
    log('warn', 'turnstile.unavailable', { error: err instanceof Error ? err.name : 'unknown' })
    return false
  }

  if (result.success === true) return true
  const errorCodes = result['error-codes'] ?? []
  if (errorCodes.some((code) => CONFIG_ERRORS.has(code))) {
    log('error', 'turnstile.misconfigured', { errorCodes })
    Sentry.captureMessage('turnstile.misconfigured', { level: 'error', extra: { errorCodes } })
  } else {
    log('warn', 'turnstile.rejected', { errorCodes })
  }
  return false
}
