import { streamWebhookPayload } from '@vidflare/shared'
import { describe, expect, it } from 'vitest'

import errorFixture from '../test/fixtures/stream-webhook-error.json'
import readyFixture from '../test/fixtures/stream-webhook-ready.json'
import { signStreamWebhook } from '../test/helpers'
import { queueFor, toStreamEvent, verifyStreamSignature } from './stream-events'

const secret = 'whsec-test'
const body = JSON.stringify(readyFixture)

describe('verifyStreamSignature', () => {
  it('accepts Stream’s signature of the exact body', async () => {
    const header = await signStreamWebhook(secret, body)
    expect(await verifyStreamSignature(secret, header, body)).toBe(true)
  })

  it('rejects a changed body, another secret, or a missing/garbled header', async () => {
    const header = await signStreamWebhook(secret, body)
    expect(await verifyStreamSignature(secret, header, `${body} `)).toBe(false)
    expect(await verifyStreamSignature('other-secret', header, body)).toBe(false)
    expect(await verifyStreamSignature(secret, undefined, body)).toBe(false)
    expect(await verifyStreamSignature(secret, 'sig1=abc', body)).toBe(false)
    expect(await verifyStreamSignature(secret, 'time=1,sig1=zz', body)).toBe(false)
  })

  it('rejects signatures older than 5 minutes', async () => {
    const sixMinutesAgo = Date.now() - 6 * 60 * 1000
    const header = await signStreamWebhook(secret, body, sixMinutesAgo)
    expect(await verifyStreamSignature(secret, header, body)).toBe(false)
    expect(await verifyStreamSignature(secret, header, body, sixMinutesAgo)).toBe(true)
  })
})

describe('toStreamEvent', () => {
  it('maps a recorded ready payload', () => {
    expect(toStreamEvent(streamWebhookPayload.parse(readyFixture))).toEqual({
      uid: readyFixture.uid,
      videoId: readyFixture.meta.videoId,
      env: 'local',
      state: 'ready',
      durationS: 5,
      thumbnailUrl: readyFixture.thumbnail,
      errorReasonCode: null,
    })
  })

  it('maps a recorded error payload, with no duration for -1', () => {
    expect(toStreamEvent(streamWebhookPayload.parse(errorFixture))).toMatchObject({
      state: 'error',
      durationS: null,
      errorReasonCode: 'ERR_NON_VIDEO',
    })
  })

  it('accepts the errReasonCode spelling from Stream’s docs', () => {
    const payload = streamWebhookPayload.parse({
      ...errorFixture,
      status: { state: 'error', errReasonCode: 'ERR_MALFORMED_VIDEO' },
    })
    expect(toStreamEvent(payload)?.errorReasonCode).toBe('ERR_MALFORMED_VIDEO')
  })

  it('ignores other states and a ready state that is not ready to stream', () => {
    const inprogress = { ...readyFixture, status: { state: 'inprogress' } }
    expect(toStreamEvent(streamWebhookPayload.parse(inprogress))).toBeNull()
    const notPlayable = { ...readyFixture, readyToStream: false }
    expect(toStreamEvent(streamWebhookPayload.parse(notPlayable))).toBeNull()
  })

  it('treats an upload without meta.env as untagged', () => {
    const untagged = { ...readyFixture, meta: {} }
    expect(toStreamEvent(streamWebhookPayload.parse(untagged))).toMatchObject({
      env: '',
      videoId: null,
    })
  })
})

describe('queueFor', () => {
  const EVENTS = { name: 'own' } as unknown as Queue
  const STAGE_EVENTS = { name: 'stage' } as unknown as Queue
  const production = { ENVIRONMENT: 'production', EVENTS, STAGE_EVENTS } as unknown as Env
  const stage = { ENVIRONMENT: 'stage', EVENTS } as unknown as Env
  const local = { ENVIRONMENT: 'local', EVENTS } as unknown as Env

  it('routes production’s events to EVENTS and stage’s to STAGE_EVENTS', () => {
    expect(queueFor(production, 'production')).toBe(EVENTS)
    expect(queueFor(production, 'stage')).toBe(STAGE_EVENTS)
    expect(queueFor(production, 'local')).toBeUndefined()
    expect(queueFor(production, '')).toBeUndefined()
  })

  it('sends an environment’s own events to its EVENTS and drops the rest', () => {
    expect(queueFor(stage, 'stage')).toBe(EVENTS)
    expect(queueFor(stage, 'production')).toBeUndefined()
    expect(queueFor(local, 'local')).toBe(EVENTS)
    expect(queueFor(local, 'stage')).toBeUndefined()
  })
})
