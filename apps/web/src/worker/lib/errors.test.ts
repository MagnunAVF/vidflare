import * as Sentry from '@sentry/cloudflare'
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'

import { sentryOptions } from '../sentry'
import type { AppEnv } from '../types'
import { ApiError, onError } from './errors'

// The real SDK with the app's options, but envelopes are recorded instead of sent.
function instrumentedApp() {
  const sent: string[] = []
  const app = new Hono<AppEnv>()
    .onError(onError)
    .post('/boom', () => {
      throw new Error('kaboom')
    })
    .get('/expected', () => {
      throw new ApiError(401, 'unauthorized')
    })
  const handler = Sentry.withSentry(
    (e: Env) => ({
      ...sentryOptions(e),
      dsn: 'https://public@o0.ingest.sentry.io/0',
      transport: () => ({
        send: async (envelope) => {
          sent.push(JSON.stringify(envelope))
          return {}
        },
        flush: async () => true,
      }),
    }),
    { fetch: app.fetch } satisfies ExportedHandler<Env>,
  )

  async function call(path: string, init?: RequestInit) {
    const ctx = createExecutionContext()
    const res = await handler.fetch!(
      new Request(`https://vidflare.test${path}`, init) as Request<
        unknown,
        IncomingRequestCfProperties
      >,
      env,
      ctx,
    )
    await waitOnExecutionContext(ctx)
    return res
  }
  return { sent, call }
}

describe('onError and Sentry', () => {
  it('reports unexpected errors without cookies or request bodies', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { sent, call } = instrumentedApp()
    const res = await call('/boom', {
      method: 'POST',
      headers: { cookie: 'vf_session=secret-session-token', 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'secret-password' }),
    })
    expect(res.status).toBe(500)

    const events = sent.filter((e) => e.includes('"type":"event"'))
    expect(events).toHaveLength(1)
    expect(events[0]).toContain('kaboom')
    for (const envelope of sent) {
      expect(envelope).not.toContain('secret-session-token')
      expect(envelope).not.toContain('secret-password')
    }
    vi.restoreAllMocks()
  })

  it('does not report expected API errors', async () => {
    const { sent, call } = instrumentedApp()
    const res = await call('/expected')
    expect(res.status).toBe(401)
    expect(sent.filter((e) => e.includes('"type":"event"'))).toHaveLength(0)
  })
})
