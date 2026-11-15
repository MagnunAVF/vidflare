import { Hono } from 'hono'

import { notFound } from '../lib/errors'
import { requireUser } from '../middleware/session'
import type { AppEnv } from '../types'

// GET /api/debug/error throws an unexpected error on purpose, to check that errors and traces
// reach Sentry (local and stage). Production answers 404 before anything else runs. Signed-in
// users only, so stage can't be used to flood Sentry anonymously and the event carries user.id.
export const debug = new Hono<AppEnv>()
  .use(async (c, next) => (c.env.ENVIRONMENT === 'production' ? notFound(c) : next()))
  .get('/error', requireUser, (c) => {
    throw new Error(`Sentry test error (${c.env.ENVIRONMENT}, request ${c.get('requestId')})`)
  })
