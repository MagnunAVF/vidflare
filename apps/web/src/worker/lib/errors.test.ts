import * as Sentry from '@sentry/cloudflare'
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getDb } from '../db/client'
import { channels, sessions, users } from '../db/schema'
import { sessionLoader } from '../middleware/session'
import { sentryOptions } from '../sentry'
import type { AppEnv } from '../types'
import { ApiError, onError } from './errors'
import { uuidv7 } from './id'
import { newSession, SESSION_COOKIE } from './session'

// The real SDK with the app's options, but envelopes are recorded instead of sent.
// One instance per file: the SDK caches its client, so a second instance's transport would
// never receive anything.
const sent: string[] = []
const events = () => sent.filter((e) => e.includes('"type":"event"'))

const app = new Hono<AppEnv>()
  .use(sessionLoader)
  .onError(onError)
  .post('/boom', () => {
    throw new Error('kaboom')
  })
  // A distinct error: Sentry's dedupe drops an event identical to the previous one.
  .post('/boom-signed-in', () => {
    throw new Error('kaboom while signed in')
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

beforeEach(() => {
  sent.length = 0
  vi.spyOn(console, 'error').mockImplementation(() => {})
  return () => vi.restoreAllMocks()
})

describe('onError and Sentry', () => {
  it('reports unexpected errors without cookies or request bodies', async () => {
    const res = await call('/boom', {
      method: 'POST',
      headers: { cookie: 'vf_session=secret-session-token', 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'secret-password' }),
    })
    expect(res.status).toBe(500)

    expect(events()).toHaveLength(1)
    expect(events()[0]).toContain('kaboom')
    for (const envelope of sent) {
      expect(envelope).not.toContain('secret-session-token')
      expect(envelope).not.toContain('secret-password')
    }
  })

  it('tags events with the signed-in user id and nothing else about the user', async () => {
    const db = getDb(env.DB)
    const userId = uuidv7()
    const handle = `s${userId.slice(-12)}`
    const email = `${handle}@example.com`
    await db.batch([
      db.insert(users).values({ id: userId, email, passwordHash: 'x', createdAt: 1 }),
      db.insert(channels).values({ id: uuidv7(), userId, handle, name: 'N', createdAt: 1 }),
    ])
    const { token, row } = await newSession(userId, env.AUTH_SECRET)
    await db.insert(sessions).values(row)

    await call('/boom-signed-in', {
      method: 'POST',
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
    })

    expect(events()).toHaveLength(1)
    expect(events()[0]).toContain(`"user":{"id":"${userId}"}`)
    expect(events()[0]).not.toContain(email)
  })

  it('does not report expected API errors', async () => {
    const res = await call('/expected')
    expect(res.status).toBe(401)
    expect(events()).toHaveLength(0)
  })
})
