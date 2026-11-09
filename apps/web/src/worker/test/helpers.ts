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
