import { FEED_PAGE_SIZE, type Page } from '@vidflare/shared'
import { and, desc, eq, isNotNull, type SQL, sql } from 'drizzle-orm'

import type { Db } from '../db/client'
import { channels, videos } from '../db/schema'
import { decodeCursor, encodeCursor } from './cursor'
import { ApiError } from './errors'

// One page of a public video listing (home feed, channel page, subscriptions feed): only
// `visibility = 'public' AND status = 'ready'`, newest first, keyset-paginated on
// (published_at, id); never OFFSET. `scope` narrows the listing (e.g. one channel).
export async function publicVideoPage(db: Db, cursor: string | undefined, scope?: SQL) {
  const after = cursor === undefined ? null : decodeCursor(cursor)
  if (cursor !== undefined && !after) throw new ApiError(400, 'invalid_cursor')

  const rows = await db
    .select({
      id: videos.id,
      title: videos.title,
      thumbnailUrl: videos.thumbnailUrl,
      durationS: videos.durationS,
      viewCount: videos.viewCount,
      publishedAt: videos.publishedAt,
      channel: { handle: channels.handle, name: channels.name, avatarKey: channels.avatarKey },
    })
    .from(videos)
    .innerJoin(channels, eq(channels.id, videos.channelId))
    .where(
      and(
        eq(videos.status, 'ready'),
        eq(videos.visibility, 'public'),
        isNotNull(videos.publishedAt),
        scope,
        after ? sql`(${videos.publishedAt}, ${videos.id}) < (${after.at}, ${after.id})` : undefined,
      ),
    )
    .orderBy(desc(videos.publishedAt), desc(videos.id))
    // One extra row tells whether there is a next page.
    .limit(FEED_PAGE_SIZE + 1)
    .all()

  const items = rows.slice(0, FEED_PAGE_SIZE).map((row) => ({
    ...row,
    publishedAt: row.publishedAt ?? 0,
  }))
  const last = items.at(-1)
  const nextCursor =
    rows.length > FEED_PAGE_SIZE && last
      ? encodeCursor({ at: last.publishedAt, id: last.id })
      : null
  return { items, nextCursor } satisfies Page<(typeof items)[number]>
}
