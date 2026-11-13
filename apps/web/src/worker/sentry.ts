import type { CloudflareOptions } from '@sentry/cloudflare'

// Shared by withSentry (fetch/queue) and the Durable Object wrapper. An empty SENTRY_DSN
// (local dev, tests) disables the SDK.
export const sentryOptions = (env: Env): CloudflareOptions => ({
  dsn: env.SENTRY_DSN || undefined,
  environment: env.ENVIRONMENT,
  // CI deploys with `--tag <git sha>`, the same release the client build reports, so a
  // frontend error and its backend trace land in one release. Falls back to the version id.
  release: env.CF_VERSION_METADATA.tag || env.CF_VERSION_METADATA.id,
  tracesSampleRate: env.ENVIRONMENT === 'production' ? 0.2 : 1.0,
  // No PII: the SDK collects cookies, headers, bodies and query strings by default, which
  // would include the session cookie, passwords and search text. The user id is set
  // explicitly by the session loader; nothing else about the user is sent.
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpHeaders: {
      request: { allow: ['content-type', 'user-agent', 'cf-ray'] },
      response: { allow: ['content-type', 'x-request-id'] },
    },
    httpBodies: [],
    urlQueryParams: false,
  },
})
