export { VideoStats } from './do/VideoStats'

export default {
  fetch(request) {
    const url = new URL(request.url)

    if (url.pathname.startsWith('/api/')) {
      return Response.json({
        name: 'Cloudflare',
      })
    }
    return new Response(null, { status: 404 })
  },

  // Consumer for `stream-events`. Nothing produces messages yet; the Stream webhook
  // handler and the real consumer land in Phase 2. Until then, fail loudly so no
  // message is ever acked without being processed.
  queue(batch) {
    throw new Error(`stream-events consumer not implemented (${batch.messages.length} messages)`)
  },
} satisfies ExportedHandler<Env>
