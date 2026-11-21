import * as Sentry from '@sentry/cloudflare'

// The app's custom Sentry instrumentation goes through this object: span names (from the
// roadmap's "Observability with Sentry" section) live in one place, and tests can spy on it
// (Sentry's own exports can't be spied on). With no SENTRY_DSN everything is a no-op.
export const telemetry = {
  startSpan: <T>(
    options: Parameters<typeof Sentry.startSpan>[0],
    callback: (span: Sentry.Span) => T,
  ): T => Sentry.startSpan(options, callback),
}
