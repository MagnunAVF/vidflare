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
})
