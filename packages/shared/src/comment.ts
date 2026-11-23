import { z } from 'zod'

import { COMMENT_MAX } from './limits'
import { turnstileToken } from './turnstile'

// POST /api/videos/:id/comments. Flat comments (replies are post-MVP).
export const createCommentInput = z.object({
  body: z
    .string()
    .trim()
    .min(1, 'Write a comment')
    .max(COMMENT_MAX, `At most ${COMMENT_MAX} characters`),
  turnstileToken,
})
export type CreateCommentInput = z.input<typeof createCommentInput>

// A comment as the API returns it (list items and the POST response). The author is shown by
// their channel; user ids stay server-side. isMine tells the client it may offer delete.
export interface CommentItem {
  id: string
  body: string
  createdAt: number
  author: { handle: string; name: string; avatarKey: string | null }
  isMine: boolean
}

// Route params for /api/comments/:id
export const commentIdParam = z.object({ id: z.uuid() })
