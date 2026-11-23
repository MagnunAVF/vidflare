import { z } from 'zod'

import { REPORT_DETAILS_MAX } from './limits'

// Why a viewer reports a video. Tuples are exported so the DB schema shares the exact values.
export const REPORT_REASONS = [
  'copyright',
  'sexual',
  'violence',
  'harassment',
  'illegal',
  'spam',
  'other',
] as const
export const reportReason = z.enum(REPORT_REASONS)
export type ReportReason = z.infer<typeof reportReason>

// open → actioned (the video was taken down) | dismissed (no action needed).
export const REPORT_STATUSES = ['open', 'actioned', 'dismissed'] as const
export const reportStatus = z.enum(REPORT_STATUSES)
export type ReportStatus = z.infer<typeof reportStatus>

// POST /api/videos/:id/report
export const createReportInput = z.object({
  reason: reportReason,
  details: z.string().trim().max(REPORT_DETAILS_MAX, `At most ${REPORT_DETAILS_MAX} characters`),
})
export type CreateReportInput = z.input<typeof createReportInput>

// GET /api/moderation/reports?status=&cursor=
export const moderationReportsQuery = z.object({
  status: reportStatus.default('open'),
  cursor: z.string().min(1).max(200).optional(),
})

// Route params for /api/moderation/reports/:id/...
export const reportIdParam = z.object({ id: z.uuid() })
