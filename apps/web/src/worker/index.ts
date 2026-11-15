import * as Sentry from '@sentry/cloudflare'
import { Hono } from 'hono'

import { VideoStats as VideoStatsBase } from './do/VideoStats'
import { notFound, onError } from './lib/errors'
import { requestContext } from './middleware/request-context'
import { sessionLoader } from './middleware/session'
import { auth } from './routes/auth'
import { debug } from './routes/debug'
import { me } from './routes/me'
import { videoRoutes } from './routes/videos'
import { sentryOptions } from './sentry'
import type { AppEnv } from './types'

export const VideoStats = Sentry.instrumentDurableObjectWithSentry(sentryOptions, VideoStatsBase)
// Same name as a type, so wrangler's generated DurableObjectNamespace<VideoStats> resolves.
export type VideoStats = VideoStatsBase

// One chained expression: `typeof app` must carry every route for the typed client.
// Breaking the chain silently drops routes from AppType.
// Order: request id + logger → session loader → (per route) requireUser → validate.
// onError/notFound turn every failure into `{ error, requestId }` JSON.
const app = new Hono<AppEnv>()
  .basePath('/api')
  .use(requestContext)
  .use(sessionLoader)
  .onError(onError)
  .notFound(notFound)
  .get('/health', (c) => c.json({ ok: true }))
  .route('/auth', auth)
  .route('/me', me)
  .route('/videos', videoRoutes)
  .route('/debug', debug)

export type AppType = typeof app

// Sentry is outermost: withSentry instruments fetch and queue (requests, outbound fetch, D1).
export default Sentry.withSentry(sentryOptions, {
  fetch: app.fetch,

  // Consumer for `stream-events`. Nothing produces messages yet; the Stream webhook
  // handler and the real consumer land in Phase 2. Until then, fail loudly so no
  // message is ever acked without being processed.
  queue(batch) {
    throw new Error(`stream-events consumer not implemented (${batch.messages.length} messages)`)
  },
} satisfies ExportedHandler<Env>)
