import { env } from 'cloudflare:workers'
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { onError } from '../lib/errors'
import errorFixture from '../test/fixtures/stream-webhook-error.json'
import readyFixture from '../test/fixtures/stream-webhook-ready.json'
import { callApi, signStreamWebhook } from '../test/helpers'
import type { AppEnv } from '../types'
import { webhooks } from './webhooks'

const SECRET = 'whsec-route-test'

// The route with stand-in queues, so each test sees exactly which queue got the event.
function setup(environment: 'local' | 'stage' | 'production') {
  const EVENTS = { send: vi.fn(async () => {}) }
  const STAGE_EVENTS = { send: vi.fn(async () => {}) }
  const bindings = {
    ...env,
    ENVIRONMENT: environment,
    STREAM_WEBHOOK_SECRET: SECRET,
    EVENTS,
    STAGE_EVENTS: environment === 'production' ? STAGE_EVENTS : undefined,
  } as unknown as Env
  const app = new Hono<AppEnv>().onError(onError).route('/', webhooks)

  async function deliver(payload: unknown, sign: (body: string) => Promise<string> | string) {
    const body = JSON.stringify(payload)
    return app.request(
      '/stream',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'Webhook-Signature': await sign(body) },
        body,
      },
      bindings,
    )
  }
  const signed = (body: string) => signStreamWebhook(SECRET, body)
  return { EVENTS, STAGE_EVENTS, deliver, signed }
}

const tagged = (fixture: typeof readyFixture | typeof errorFixture, envTag?: string) => ({
  ...fixture,
  meta: envTag === undefined ? {} : { ...fixture.meta, env: envTag },
})

// Kept as references: reading console.warn back in workerd doesn't return the spy.
let warn: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {})
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('POST /api/webhooks/stream', () => {
  it('in production, sends production events to EVENTS', async () => {
    const { EVENTS, STAGE_EVENTS, deliver, signed } = setup('production')

    const res = await deliver(tagged(readyFixture, 'production'), signed)

    expect(res.status).toBe(200)
    expect(EVENTS.send).toHaveBeenCalledWith({
      uid: readyFixture.uid,
      videoId: readyFixture.meta.videoId,
      env: 'production',
      state: 'ready',
      durationS: 5,
      thumbnailUrl: readyFixture.thumbnail,
      errorReasonCode: null,
    })
    expect(STAGE_EVENTS.send).not.toHaveBeenCalled()
  })

  it('in production, forwards stage events to STAGE_EVENTS', async () => {
    const { EVENTS, STAGE_EVENTS, deliver, signed } = setup('production')

    const res = await deliver(tagged(errorFixture, 'stage'), signed)

    expect(res.status).toBe(200)
    expect(STAGE_EVENTS.send).toHaveBeenCalledWith(
      expect.objectContaining({ env: 'stage', state: 'error', errorReasonCode: 'ERR_NON_VIDEO' }),
    )
    expect(EVENTS.send).not.toHaveBeenCalled()
  })

  it('drops local and untagged events with a warning, and still answers 200', async () => {
    const { EVENTS, STAGE_EVENTS, deliver, signed } = setup('production')

    for (const payload of [tagged(readyFixture, 'local'), tagged(readyFixture)]) {
      expect((await deliver(payload, signed)).status).toBe(200)
    }

    expect(EVENTS.send).not.toHaveBeenCalled()
    expect(STAGE_EVENTS.send).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('webhook.dropped'))
  })

  it('locally, routes replayed local events to the local queue', async () => {
    const { EVENTS, deliver, signed } = setup('local')
    expect((await deliver(tagged(readyFixture, 'local'), signed)).status).toBe(200)
    expect(EVENTS.send).toHaveBeenCalledOnce()
  })

  it('rejects a bad signature without enqueueing anything', async () => {
    const { EVENTS, STAGE_EVENTS, deliver } = setup('production')

    const res = await deliver(tagged(readyFixture, 'production'), (body) =>
      signStreamWebhook('wrong-secret', body),
    )

    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ error: 'invalid_signature' })
    expect(EVENTS.send).not.toHaveBeenCalled()
    expect(STAGE_EVENTS.send).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('webhook.signature_invalid'))
  })

  it('rejects a signed body that is not a Stream video', async () => {
    const { EVENTS, deliver, signed } = setup('production')
    const res = await deliver({ hello: 'world' }, signed)
    expect(res.status).toBe(400)
    expect(EVENTS.send).not.toHaveBeenCalled()
  })

  it('acknowledges states it does not act on', async () => {
    const { EVENTS, deliver, signed } = setup('production')
    const inprogress = { ...tagged(readyFixture, 'production'), status: { state: 'inprogress' } }
    expect((await deliver(inprogress, signed)).status).toBe(200)
    expect(EVENTS.send).not.toHaveBeenCalled()
  })

  it('is mounted on the app and needs no session', async () => {
    const res = await callApi('/api/webhooks/stream', {
      method: 'POST',
      headers: { 'Webhook-Signature': 'time=1,sig1=00' },
      body: '{}',
    })
    expect(res.status).toBe(401)
  })
})
