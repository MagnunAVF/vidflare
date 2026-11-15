import * as Sentry from '@sentry/cloudflare'
import { Hono } from 'hono'

import { VideoStats as VideoStatsBase } from './do/VideoStats'
import { notFound, onError } from './lib/errors'
import { requestContext } from './middleware/request-context'
import { sessionLoader } from './middleware/session'
import { auth } from './routes/auth'
import { debug } from './routes/debug'
import { handleStreamEvents } from './queue/stream-events'
import { me } from './routes/me'
import { videoRoutes } from './routes/videos'
import { webhooks } from './routes/webhooks'
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
  .route('/webhooks', webhooks)
  .route('/debug', debug)

export type AppType = typeof app

// Sentry is outermost: withSentry instruments fetch and queue (requests, outbound fetch, D1).
export default Sentry.withSentry(sentryOptions, {
  fetch: app.fetch,

  // Consumer for this environment's stream-events queue (Stream ready/error events).
  queue: handleStreamEvents,
} satisfies ExportedHandler<Env>)
