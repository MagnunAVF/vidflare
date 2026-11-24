import * as Sentry from '@sentry/cloudflare'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { mockFetch, TURNSTILE_URL } from '../test/helpers'
import { verifyTurnstile } from './turnstile'

// Response bodies as Cloudflare's siteverify sends them (recorded with the public test secrets).
const PASSED = {
  success: true,
  'error-codes': [],
  hostname: 'example.com',
  challenge_ts: '2026-11-21T00:03:26.136Z',
}
const REJECTED = { success: false, 'error-codes': ['invalid-input-response'], messages: [] }
const SPENT = { success: false, 'error-codes': ['timeout-or-duplicate'], messages: [] }
const BAD_SECRET = { success: false, 'error-codes': ['invalid-input-secret'], messages: [] }

interface Spy {
  mock: { calls: unknown[][] }
}
let warn: Spy
let error: Spy
beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  error = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

// The structured log lines a console spy received.
const logged = (spy: Spy) =>
  spy.mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>)

describe('verifyTurnstile', () => {
  it('passes when siteverify says success, sending the secret, token and visitor IP', async () => {
    const requests = mockFetch({ [TURNSTILE_URL]: () => Response.json(PASSED) })
    expect(await verifyTurnstile('secret', 'token', '203.0.113.7')).toBe(true)
    const form = await requests[0]!.formData()
    expect(form.get('secret')).toBe('secret')
    expect(form.get('response')).toBe('token')
    expect(form.get('remoteip')).toBe('203.0.113.7')
  })

  it.each([
    ['an invalid token', REJECTED],
    ['a spent token', SPENT],
  ])('fails on %s and logs the error codes', async (_, body) => {
    mockFetch({ [TURNSTILE_URL]: () => Response.json(body) })
    expect(await verifyTurnstile('secret', 'token')).toBe(false)
    expect(logged(warn)).toContainEqual({
      msg: 'turnstile.rejected',
      errorCodes: body['error-codes'],
    })
  })

  it('reports a misconfigured secret to Sentry', async () => {
    const capture = vi.spyOn(Sentry, 'captureMessage')
    mockFetch({ [TURNSTILE_URL]: () => Response.json(BAD_SECRET) })
    expect(await verifyTurnstile('wrong', 'token')).toBe(false)
    expect(logged(error)[0]).toMatchObject({ msg: 'turnstile.misconfigured' })
    expect(capture).toHaveBeenCalledWith('turnstile.misconfigured', expect.anything())
  })

  it.each([
    ['siteverify is down', () => new Response('bad gateway', { status: 502 })],
    [
      'the network fails',
      () => {
        throw new TypeError('network')
      },
    ],
    ['the answer is not JSON', () => new Response('<html>')],
  ])('fails closed when %s', async (_, respond) => {
    mockFetch({ [TURNSTILE_URL]: respond })
    expect(await verifyTurnstile('secret', 'token')).toBe(false)
    expect(logged(warn)[0]).toMatchObject({ msg: 'turnstile.unavailable' })
  })
})
