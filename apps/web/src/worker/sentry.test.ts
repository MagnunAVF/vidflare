import { describe, expect, it } from 'vitest'

import { sentryOptions } from './sentry'

const baseEnv = {
  SENTRY_DSN: '',
  ENVIRONMENT: 'stage',
  CF_VERSION_METADATA: { id: 'version-id', tag: '', timestamp: '' },
} as unknown as Env

const options = (overrides: Partial<Record<keyof Env, unknown>> = {}) =>
  sentryOptions({ ...baseEnv, ...overrides } as Env)

describe('sentryOptions', () => {
  it('is disabled without a DSN (local dev, tests)', () => {
    expect(options().dsn).toBeUndefined()
    expect(options({ SENTRY_DSN: 'https://k@o1.ingest.sentry.io/1' }).dsn).toBe(
      'https://k@o1.ingest.sentry.io/1',
    )
  })

  it('uses the deploy tag (git sha) as release, else the version id', () => {
    expect(options().release).toBe('version-id')
    expect(
      options({ CF_VERSION_METADATA: { id: 'version-id', tag: 'abc1234', timestamp: '' } }).release,
    ).toBe('abc1234')
  })

  it('samples fewer traces in production', () => {
    expect(options().tracesSampleRate).toBe(1)
    expect(options({ ENVIRONMENT: 'production' }).tracesSampleRate).toBe(0.2)
    expect(options({ ENVIRONMENT: 'production' }).environment).toBe('production')
  })

  it('collects no cookies, bodies, query strings or automatic user info', () => {
    const { dataCollection } = options()
    expect(dataCollection).toMatchObject({
      userInfo: false,
      cookies: false,
      httpBodies: [],
      urlQueryParams: false,
    })
    const headers = JSON.stringify(dataCollection?.httpHeaders)
    expect(headers).not.toMatch(/cookie|authorization/i)
  })

  it('scrubs credentials and query strings from errors and streamed spans before sending', () => {
    const { beforeSend, beforeSendSpan, beforeSendTransaction } = options()
    // Spans are streamed (the v11 default), so a transaction hook would never run.
    expect(beforeSendTransaction).toBeUndefined()
    const request = () => ({
      url: 'https://vidflare.app/api/search?q=private',
      headers: { Cookie: 'vf_session=secret', Authorization: 'Bearer token', 'cf-ray': 'r' },
    })

    const error = beforeSend!({ type: undefined, request: request() }, {})
    expect(error).toMatchObject({
      request: {
        url: 'https://vidflare.app/api/search',
        headers: { Cookie: '[Filtered]', Authorization: '[Filtered]', 'cf-ray': 'r' },
      },
    })

    const span = beforeSendSpan!({
      trace_id: '2',
      span_id: '1',
      name: 'GET /api/search?q=private',
      start_timestamp: 0,
      status: 'ok',
      is_segment: true,
      attributes: {
        'url.full': 'https://vidflare.app/api/search?q=private',
        'url.query': 'q=private',
        'http.request.header.cookie': 'vf_session=secret',
        'http.route': '/api/search',
      },
    })
    expect(span.name).toBe('GET /api/search')
    expect(span.attributes).toEqual({
      'url.full': 'https://vidflare.app/api/search',
      'http.request.header.cookie': '[Filtered]',
      'http.route': '/api/search',
    })
  })
})
