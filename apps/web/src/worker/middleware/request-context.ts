import { createMiddleware } from 'hono/factory'

import type { AppEnv } from '../types'

// Request id (also returned as X-Request-Id) and one structured log line per request.
// Logs the route pattern, never the raw URL or query, so no free text or ids from paths.
export const requestContext = createMiddleware<AppEnv>(async (c, next) => {
  const requestId = crypto.randomUUID()
  c.set('requestId', requestId)
  const start = Date.now()

  await next()

  c.header('X-Request-Id', requestId)
  console.log(
    JSON.stringify({
      msg: 'request',
      requestId,
      method: c.req.method,
      route: c.req.routePath,
      status: c.res.status,
      durationMs: Date.now() - start,
      userId: c.get('user')?.id,
    }),
  )
})
