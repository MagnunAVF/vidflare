import * as Sentry from '@sentry/cloudflare'
import { Hono } from 'hono'

import { VideoStats as VideoStatsBase } from './do/VideoStats'
import { notFound, onError } from './lib/errors'
import { RECONCILE_CRON, RECONCILE_MONITOR_SLUG, reconcileVideos } from './lib/reconcile'
import { requestContext } from './middleware/request-context'
import { sessionLoader } from './middleware/session'
import { auth } from './routes/auth'
import { channelRoutes } from './routes/channels'
import { commentRoutes, videoCommentRoutes } from './routes/comments'
import { debug } from './routes/debug'
import { feedRoutes } from './routes/feed'
import { handleStreamEvents } from './queue/stream-events'
import { likeRoutes } from './routes/likes'
import { me } from './routes/me'
import { mediaRoutes } from './routes/media'
import { moderationRoutes } from './routes/moderation'
import { reportRoutes } from './routes/reports'
import { searchRoutes } from './routes/search'
import { studio } from './routes/studio'
import { videoRoutes } from './routes/videos'
import { viewRoutes } from './routes/views'
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
  .route('/videos', likeRoutes)
  .route('/videos', videoCommentRoutes)
  .route('/videos', viewRoutes)
  .route('/videos', reportRoutes)
  .route('/comments', commentRoutes)
  .route('/channels', channelRoutes)
  .route('/feed', feedRoutes)
  .route('/search', searchRoutes)
  .route('/media', mediaRoutes)
  .route('/studio', studio)
  .route('/moderation', moderationRoutes)
  .route('/webhooks', webhooks)
  .route('/debug', debug)

export type AppType = typeof app

// Sentry is outermost: withSentry instruments fetch and queue (requests, outbound fetch, D1).
export default Sentry.withSentry(sentryOptions, {
  fetch: app.fetch,

  // Consumer for this environment's stream-events queue (Stream ready/error events).
  queue: handleStreamEvents,

  // Nightly reconcile (cron in wrangler.jsonc). The Sentry cron monitor gets an in-progress
  // check-in, then ok or error (reconcileVideos throws when a step failed); a night with no
  // check-in at all alerts as missed. The monitor is created from this config on first run.
  scheduled: async (_controller, env) => {
    await Sentry.withMonitor(RECONCILE_MONITOR_SLUG, () => reconcileVideos(env), {
      schedule: { type: 'crontab', value: RECONCILE_CRON },
      timezone: 'Etc/UTC',
      checkinMargin: 30, // minutes late before it counts as missed
      maxRuntime: 15, // minutes
    })
  },
} satisfies ExportedHandler<Env>)
