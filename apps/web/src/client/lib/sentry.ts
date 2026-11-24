import * as Sentry from '@sentry/react'
import { scrubSentryEvent, scrubSentrySpan } from '@vidflare/shared'

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Client-side metrics from the roadmap's table. No-ops when Sentry is off (no DSN).
export const clientMetrics = {
  // Upload time a creator waits: from the first tus byte to Stream having the whole file.
  uploadDuration: (ms: number) =>
    Sentry.metrics.distribution('upload.client_duration', ms, { unit: 'millisecond' }),
  // Time to first frame: from pressing play to the player actually playing.
  playerStartTime: (ms: number) =>
    Sentry.metrics.distribution('player.start_time', ms, { unit: 'millisecond' }),
}

// Called once before render. No VITE_SENTRY_DSN (local dev) means no SDK at all.
// The router is typed loosely, like Sentry's own integration signature.
export function initSentry(router: unknown) {
  const dsn = import.meta.env.VITE_SENTRY_DSN
  if (!dsn) return

  const environment = import.meta.env.VITE_ENVIRONMENT
  Sentry.init({
    dsn,
    environment,
    // Same git sha the Worker reports (deploy --tag), so both sides share a release.
    release: import.meta.env.VITE_RELEASE,
    integrations: [
      // Transactions named by route pattern (/watch/$id), not by URL.
      Sentry.tanstackRouterBrowserTracingIntegration(router),
      // Replays only for sessions with an error, with all text and media masked.
      Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true }),
    ],
    tracesSampleRate: environment === 'production' ? 0.2 : 1.0,
    // Continue traces into the Worker for API calls only (same origin, relative or absolute).
    tracePropagationTargets: [/^\/api\//, new RegExp(`^${escapeRegExp(location.origin)}/api/`)],
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
    // No PII: only the user id (set on login) is sent.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
    },
    // A last pass on everything that leaves: credential headers filtered, query strings cut
    // (navigation breadcrumbs and fetch spans carry /search?q=...). Same functions as the
    // Worker. Spans are streamed (traceLifecycle 'stream', the default), so they go through
    // beforeSendSpan, not beforeSendTransaction.
    beforeSend: (event) => scrubSentryEvent(event),
    beforeSendSpan: (span) => scrubSentrySpan(span),
  })
}
