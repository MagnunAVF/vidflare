const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

// Server-side check of a Turnstile token. Locally TURNSTILE_SECRET is Cloudflare's
// always-pass test secret (see .dev.vars.example).
export async function verifyTurnstile(
  secret: string,
  token: string,
  remoteIp?: string,
): Promise<boolean> {
  const body = new FormData()
  body.append('secret', secret)
  body.append('response', token)
  if (remoteIp) body.append('remoteip', remoteIp)

  const res = await fetch(SITEVERIFY_URL, { method: 'POST', body })
  if (!res.ok) return false
  const result = await res.json<{ success?: boolean }>()
  return result.success === true
}
