import { z } from 'zod'

// POST /api/webhooks/stream: the body Stream sends when a video finishes processing. It's the
// Stream video object; only the fields the app uses are kept (unknown keys are stripped).
export const streamWebhookPayload = z.object({
  uid: z.string().min(1),
  readyToStream: z.boolean().optional(),
  status: z.object({
    state: z.string(),
    // Real payloads use errorReasonCode; Stream's docs also show errReasonCode.
    errorReasonCode: z.string().optional(),
    errReasonCode: z.string().optional(),
  }),
  // Our tags: env (which environment created the upload) and videoId.
  meta: z.record(z.string(), z.unknown()).optional(),
  // Seconds; -1 while unknown.
  duration: z.number().optional(),
  thumbnail: z.string().optional(),
})
export type StreamWebhookPayload = z.infer<typeof streamWebhookPayload>
