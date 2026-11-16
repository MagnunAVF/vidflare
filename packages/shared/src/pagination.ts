import { z } from 'zod'

// Cursor pagination, shared by every list (home feed, channel videos, subscriptions, search,
// comments). The cursor is opaque to the client: pass back the previous page's nextCursor.
export const cursorQuery = z.object({
  cursor: z.string().min(1).max(200).optional(),
})
export type CursorQuery = z.input<typeof cursorQuery>

export interface Page<T> {
  items: T[]
  // null on the last page.
  nextCursor: string | null
}

export const FEED_PAGE_SIZE = 24
