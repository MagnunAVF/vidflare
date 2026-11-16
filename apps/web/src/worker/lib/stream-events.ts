import type { StreamWebhookPayload } from '@vidflare/shared'
import { z } from 'zod'

import { utf8 } from './encoding'

// Stream signs each webhook: `Webhook-Signature: time=<unix s>,sig1=<hex HMAC-SHA256>` over
// `${time}.${rawBody}`, keyed with the account webhook secret.
const MAX_AGE_S = 5 * 60

function hexToBytes(hex: string): Uint8Array | null {
  if (!/^(?:[0-9a-f]{2})+$/i.test(hex)) return null
  return Uint8Array.from(hex.match(/../g)!, (h) => parseInt(h, 16))
}

// True when `header` is a valid, recent Stream signature of exactly `rawBody`. The comparison
// is crypto.subtle.verify, which is constant-time.
export async function verifyStreamSignature(
  secret: string,
  header: string | undefined,
  rawBody: string,
  now = Date.now(),
): Promise<boolean> {
  if (!header) return false
  const parts = new Map(
    header.split(',').map((part) => {
      const i = part.indexOf('=')
      return [part.slice(0, i).trim(), part.slice(i + 1).trim()] as const
    }),
  )
  const time = parts.get('time')
  const sig = hexToBytes(parts.get('sig1') ?? '')
  if (!time || !/^\d+$/.test(time) || !sig) return false
  // Replays of an old (captured) request are rejected; small clock skew is fine both ways.
  if (Math.abs(now / 1000 - Number(time)) > MAX_AGE_S) return false

  const key = await crypto.subtle.importKey(
    'raw',
    utf8(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  )
  return crypto.subtle.verify('HMAC', key, sig, utf8(`${time}.${rawBody}`))
}

// What the webhook enqueues and the consumer reads. Production also sends these to stage's
// queue, so stage may run a different version of this code: keep changes backward compatible
// (add optional fields; never rename or remove one).
export const streamEvent = z.object({
  uid: z.string().min(1),
  videoId: z.string().nullable(),
  env: z.string(),
  state: z.enum(['ready', 'error']),
  durationS: z.number().int().nonnegative().nullable(),
  thumbnailUrl: z.string().nullable(),
  errorReasonCode: z.string().nullable(),
})
export type StreamEvent = z.infer<typeof streamEvent>

const str = (value: unknown) => (typeof value === 'string' && value ? value : null)

// The queue message for a webhook body, or null for states the app doesn't act on (Stream only
// sends ready and error, but anything else is ignored rather than guessed at).
export function toStreamEvent(payload: StreamWebhookPayload): StreamEvent | null {
  const { state } = payload.status
  if (state !== 'ready' && state !== 'error') return null
  // A video only plays when Stream says both: state ready and readyToStream.
  if (state === 'ready' && payload.readyToStream === false) return null
  const duration = payload.duration
  return {
    uid: payload.uid,
    videoId: str(payload.meta?.videoId),
    env: str(payload.meta?.env) ?? '',
    state,
    durationS: typeof duration === 'number' && duration >= 0 ? Math.round(duration) : null,
    thumbnailUrl: str(payload.thumbnail),
    errorReasonCode:
      state === 'error'
        ? (str(payload.status.errorReasonCode) ?? str(payload.status.errReasonCode) ?? 'unknown')
        : null,
  }
}

// The queue an event goes to: this environment's own events go to EVENTS. Production, which
// receives the account's only webhook, also forwards stage's events to STAGE_EVENTS. Anything
// else has no queue: untagged uploads, `local` ones outside local dev, and `stage` ones
// anywhere but stage and production.
export function queueFor(env: Env, target: string): Queue | undefined {
  if (target && target === env.ENVIRONMENT) return env.EVENTS
  if (target === 'stage') return env.STAGE_EVENTS
  return undefined
}
