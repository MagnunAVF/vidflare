import { Hono } from 'hono'

import type { AppEnv } from './types'

export { VideoStats } from './do/VideoStats'

// One chained expression: `typeof app` must carry every route for the typed client.
// Breaking the chain silently drops routes from AppType.
const app = new Hono<AppEnv>().basePath('/api').get('/health', (c) => c.json({ ok: true }))

export type AppType = typeof app

export default {
  fetch: app.fetch,

  // Consumer for `stream-events`. Nothing produces messages yet; the Stream webhook
  // handler and the real consumer land in Phase 2. Until then, fail loudly so no
  // message is ever acked without being processed.
  queue(batch) {
    throw new Error(`stream-events consumer not implemented (${batch.messages.length} messages)`)
  },
} satisfies ExportedHandler<Env>
