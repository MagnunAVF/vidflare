#!/usr/bin/env node
// Replays a recorded Stream webhook payload to a running Worker, signed the way Stream signs
// it (Webhook-Signature: time=<unix>,sig1=hex(HMAC-SHA256(secret, `${time}.${body}`))).
// Stream's single webhook goes to production, so local dev uses this instead.
//
//   pnpm --filter web webhook:replay src/worker/test/fixtures/stream-webhook-ready.json \
//     --uid <stream_uid> --video-id <videos.id> [--env local] [--url http://localhost:5173]
//
// --uid / --video-id / --env override the fixture's uid, meta.videoId and meta.env so the
// event matches a row in your local D1. Signs with STREAM_WEBHOOK_SECRET from .dev.vars, which
// only ever holds a local value.
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    uid: { type: 'string' },
    'video-id': { type: 'string' },
    env: { type: 'string', default: 'local' },
    url: { type: 'string', default: 'http://localhost:5173' },
  },
})

const fixturePath = positionals[0]
if (!fixturePath) {
  console.error(
    'Usage: webhook:replay <fixture.json> [--uid X] [--video-id Y] [--env local] [--url U]',
  )
  process.exit(1)
}

const secret = readFileSync('.dev.vars', 'utf8')
  .split('\n')
  .find((line) => line.startsWith('STREAM_WEBHOOK_SECRET='))
  ?.slice('STREAM_WEBHOOK_SECRET='.length)
  .trim()
if (!secret) {
  console.error('STREAM_WEBHOOK_SECRET is not set in .dev.vars')
  process.exit(1)
}

const payload = JSON.parse(readFileSync(fixturePath, 'utf8'))
if (values.uid) payload.uid = values.uid
payload.meta = { ...payload.meta, env: values.env }
if (values['video-id']) payload.meta.videoId = values['video-id']

const body = JSON.stringify(payload)
const time = Math.floor(Date.now() / 1000)
const sig = createHmac('sha256', secret).update(`${time}.${body}`).digest('hex')

const res = await fetch(new URL('/api/webhooks/stream', values.url), {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'Webhook-Signature': `time=${time},sig1=${sig}` },
  body,
})
console.log(`${res.status} ${await res.text()}`)
process.exit(res.ok ? 0 : 1)
