import { z } from 'zod'

import { SEARCH_QUERY_MAX } from './limits'
import { cursorQuery } from './pagination'

// The search text, as typed. Trimmed; the API turns it into a safe FTS5 query itself, so any
// characters are allowed here.
export const searchText = z
  .string()
  .trim()
  .min(1, 'Enter something to search for')
  .max(SEARCH_QUERY_MAX, `At most ${SEARCH_QUERY_MAX} characters`)

// GET /api/search?q=&cursor=
export const searchQuery = cursorQuery.extend({ q: searchText })
export type SearchQuery = z.input<typeof searchQuery>
