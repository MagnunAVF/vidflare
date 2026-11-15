import { exports } from 'cloudflare:workers'
import { vi } from 'vitest'

// Calls the real Worker entry (all middleware included).
export const callApi = (path: string, init?: RequestInit) =>
  exports.default.fetch(new Request(`https://vidflare.test${path}`, init))

export const postJson = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  callApi(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })

// Stubs Cloudflare's siteverify; any other outbound fetch is a test bug.
export function mockTurnstile(success = true) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = input instanceof Request ? input.url : String(input)
    if (!url.includes('challenges.cloudflare.com/turnstile')) {
      throw new Error(`unexpected outbound fetch: ${url}`)
    }
    return Response.json({ success })
  })
}

export const TURNSTILE_URL = 'https://challenges.cloudflare.com/turnstile'
export const STREAM_API_URL = 'https://api.cloudflare.com/client/v4/accounts'

type Responder = (req: Request) => Response | Promise<Response>

// Stubs outbound fetch by URL prefix and records each request; any other URL is a test bug.
export function mockFetch(routes: Record<string, Responder>) {
  const requests: Request[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const req = new Request(input, init)
    const match = Object.entries(routes).find(([prefix]) => req.url.startsWith(prefix))
    if (!match) throw new Error(`unexpected outbound fetch: ${req.url}`)
    requests.push(req)
    return match[1](req)
  })
  return requests
}

// The Webhook-Signature header Stream would send for this exact body.
export async function signStreamWebhook(secret: string, body: string, time = Date.now()) {
  const seconds = Math.floor(time / 1000)
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${seconds}.${body}`))
  const hex = Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, '0')).join('')
  return `time=${seconds},sig1=${hex}`
}

// Signs up a fresh user and returns their session cookie and channel id.
export async function signUp() {
  mockTurnstile()
  const res = await postJson('/api/auth/signup', signupBody())
  vi.restoreAllMocks()
  if (res.status !== 201) throw new Error(`sign-up failed: ${res.status}`)
  const me = await res.json<{ user: { id: string }; channel: { id: string } }>()
  return { cookie: sessionCookie(res), userId: me.user.id, channelId: me.channel.id }
}

// D1 state is shared by the tests in a file, so every sign-up gets a unique email/handle.
let seq = 0
export function signupBody(overrides: Record<string, unknown> = {}) {
  const n = `${Date.now().toString(36)}${(seq++).toString(36)}`
  return {
    email: `user_${n}@example.com`,
    password: 'correct horse battery',
    handle: `user_${n}`,
    name: 'Test Channel',
    turnstileToken: 'test-token',
    ...overrides,
  }
}

// "vf_session=<token>" from a Set-Cookie header, ready to send back as a Cookie header.
export const sessionCookie = (res: Response) =>
  (res.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
