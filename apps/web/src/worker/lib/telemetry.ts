import * as Sentry from '@sentry/cloudflare'

// The app's custom Sentry instrumentation goes through this object: span and metric names (the
// roadmap's "Observability with Sentry" section) live in one place, and tests can spy on it
// (Sentry's own exports can't be spied on). With no SENTRY_DSN everything is a no-op.

// Worker-side metrics from the roadmap table. The client emits upload.client_duration and
// player.start_time itself (client/lib/sentry.ts).
export type CountMetric =
  | 'upload.started'
  | 'upload.ready'
  | 'upload.failed'
  | 'webhook.signature_invalid'
  | 'video.view_recorded'
  | 'auth.login_failed'
export type DistributionMetric = 'video.processing_time' | 'stats.flush_rows'

// Attribute values are codes and ids only, never free text or anything about a person.
export type MetricAttributes = Record<string, string | number | boolean>

export const telemetry = {
  startSpan: <T>(
    options: Parameters<typeof Sentry.startSpan>[0],
    callback: (span: Sentry.Span) => T,
  ): T => Sentry.startSpan(options, callback),

  // Names the request's root span by route pattern ("GET /api/videos/:id") instead of its URL,
  // so traces, the p95-per-route dashboard and the video-detail latency alert group by route
  // rather than by every video id. No-op when there's no active span (Sentry off).
  nameRequest: (method: string, route: string) => {
    const active = Sentry.getActiveSpan()
    if (!active) return
    const root = Sentry.getRootSpan(active)
    Sentry.updateSpanName(root, `${method} ${route}`)
    root.setAttribute('http.route', route)
  },

  count: (name: CountMetric, attributes?: MetricAttributes) =>
    Sentry.metrics.count(name, 1, attributes ? { attributes } : undefined),

  distribution: (
    name: DistributionMetric,
    value: number,
    unit: 'millisecond' | 'none',
    attributes?: MetricAttributes,
  ) => Sentry.metrics.distribution(name, value, { unit, ...(attributes ? { attributes } : {}) }),
}
