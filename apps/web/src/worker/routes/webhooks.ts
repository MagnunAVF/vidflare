import { streamWebhookPayload } from '@vidflare/shared'
import { Hono } from 'hono'

import { ApiError } from '../lib/errors'
import { queueFor, toStreamEvent, verifyStreamSignature } from '../lib/stream-events'
import { telemetry } from '../lib/telemetry'
import type { AppEnv } from '../types'

const log = (level: 'info' | 'warn', fields: Record<string, unknown>) =>
  console[level](JSON.stringify(fields))

// POST /api/webhooks/stream: Stream's "video ready / error" notification. The account has one
// webhook, on production, so this handler serves every environment: it checks the signature,
// routes the event by meta.env to the right environment's queue and returns 200 fast. No D1
// work here; the queue consumer does it (and a change here only reaches stage via production).
export const webhooks = new Hono<AppEnv>().post('/stream', async (c) => {
  const requestId = c.get('requestId')
  // The signature covers the exact bytes, so read the raw body before parsing it.
  const raw = await c.req.text()
  const signed = await verifyStreamSignature(
    c.env.STREAM_WEBHOOK_SECRET,
    c.req.header('Webhook-Signature'),
    raw,
  )
  if (!signed) {
    log('warn', { msg: 'webhook.signature_invalid', requestId })
    telemetry.count('webhook.signature_invalid')
    throw new ApiError(401, 'invalid_signature')
  }

  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    json = undefined
  }
  const parsed = streamWebhookPayload.safeParse(json)
  if (!parsed.success) {
    log('warn', { msg: 'webhook.invalid_payload', requestId })
    throw new ApiError(400, 'invalid_request')
  }

  const event = toStreamEvent(parsed.data)
  if (!event) {
    log('info', { msg: 'webhook.ignored', requestId, uid: parsed.data.uid })
    return c.json({ ok: true }, 200)
  }

  const queue = queueFor(c.env, event.env)
  if (!queue) {
    log('warn', { msg: 'webhook.dropped', requestId, uid: event.uid, env: event.env })
    return c.json({ ok: true }, 200)
  }

  await queue.send(event)
  log('info', { msg: 'webhook.routed', requestId, uid: event.uid, env: event.env })
  return c.json({ ok: true }, 200)
})
