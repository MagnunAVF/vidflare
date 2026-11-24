import { searchQuery } from '@vidflare/shared'
import { sql } from 'drizzle-orm'
import { Hono } from 'hono'

import { getDb } from '../db/client'
import { videos } from '../db/schema'
import { publicVideoPage } from '../lib/feed'
import { toFtsQuery } from '../lib/search'
import { validate } from '../middleware/validate'
import type { AppEnv } from '../types'

// Title/description search, mounted under /search. Results are the public, ready videos whose
// text matches, newest first, with the same cursor and item shape as every other listing.
// Matches are ordered by date rather than FTS rank so keyset pagination stays stable; a
// rank-ordered page would shift as other videos change the index statistics.
export const searchRoutes = new Hono<AppEnv>().get(
  '/',
  validate('query', searchQuery),
  async (c) => {
    const { q, cursor } = c.req.valid('query')
    const match = toFtsQuery(q)
    // Nothing searchable (only punctuation): no FTS query to run, so no results.
    if (!match) return c.json({ items: [], nextCursor: null }, 200)

    // videos_fts is raw SQL (not in the Drizzle schema): join its matches back to videos;
    // publicVideoPage applies the public-listing filter and the cursor.
    const matching = sql`${videos.id} in (select video_id from videos_fts where videos_fts match ${match})`
    return c.json(await publicVideoPage(getDb(c.env.DB), cursor, matching), 200)
  },
)
