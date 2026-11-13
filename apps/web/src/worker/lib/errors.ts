import * as Sentry from '@sentry/cloudflare'
import type { Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

import type { AppEnv } from '../types'

// Throw from handlers for an expected failure; the error handler turns it into
// `{ error: code, requestId }` with this status.
export class ApiError extends Error {
  readonly status: ContentfulStatusCode
  readonly code: string

  constructor(status: ContentfulStatusCode, code: string) {
    super(code)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

export function onError(err: Error, c: Context<AppEnv>) {
  const requestId = c.get('requestId')
  if (err instanceof ApiError) {
    return c.json({ error: err.code, requestId }, err.status)
  }
  if (err instanceof HTTPException) {
    return c.json(
      { error: err.status === 400 ? 'bad_request' : 'http_error', requestId },
      err.status,
    )
  }
  // Unexpected: this handler swallows the error, so report it to Sentry explicitly (expected
  // ApiError/HTTPException failures above are not issues). Log ids and the error type only.
  Sentry.captureException(err)
  console.error(
    JSON.stringify({ msg: 'unhandled_error', requestId, error: err.name, message: err.message }),
  )
  return c.json({ error: 'internal_error', requestId }, 500)
}

export const notFound = (c: Context<AppEnv>) =>
  c.json({ error: 'not_found', requestId: c.get('requestId') }, 404)
