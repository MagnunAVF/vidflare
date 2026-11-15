import { env } from 'cloudflare:workers'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { callApi, mockTurnstile, postJson, sessionCookie, signupBody } from '../test/helpers'
import { debug } from './debug'

afterEach(() => {
  vi.restoreAllMocks()
})

async function signedInCookie() {
  mockTurnstile()
  const res = await postJson('/api/auth/signup', signupBody())
  expect(res.status).toBe(201)
  vi.restoreAllMocks()
  return sessionCookie(res)
}

describe('GET /api/debug/error', () => {
  it('requires a session', async () => {
    const res = await callApi('/api/debug/error')
    expect(res.status).toBe(401)
  })

  it('throws an unexpected error that the error handler reports as a 500', async () => {
    const cookie = await signedInCookie()
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await callApi('/api/debug/error', { headers: { cookie } })

    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ error: 'internal_error' })
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('Sentry test error (local'))
  })

  it('is not found in production, even before auth', async () => {
    const res = await debug.request('/error', {}, { ...env, ENVIRONMENT: 'production' })
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ error: 'not_found' })
  })
})
