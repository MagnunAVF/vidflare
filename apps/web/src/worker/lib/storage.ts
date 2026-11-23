import {
  CREATOR_STORAGE_MAX_S,
  UPLOAD_MAX_DURATION_S,
  UPLOAD_MIN_REMAINING_S,
} from '@vidflare/shared'
import { eq, sql } from 'drizzle-orm'

import type { Db } from '../db/client'
import { videos } from '../db/schema'

// An upload still in flight (uploading/processing) has no duration yet, so it holds the most it
// could turn out to be. Only recent ones do: an older row is an abandoned upload or a missed
// webhook (the studio re-check and the nightly reconcile settle those), and must not hold a
// creator's budget forever.
export const IN_FLIGHT_RESERVE_MS = 24 * 60 * 60 * 1000

// How much of the creator's video budget is used, and how long the next upload may be (0 means
// uploads are refused). Ready videos count their real duration; errors count nothing.
export async function channelStorage(db: Db, channelId: string, now = Date.now()) {
  const row = await db
    .select({
      usedS: sql<number>`coalesce(sum(case
        when ${videos.status} = 'ready' then coalesce(${videos.durationS}, 0)
        when ${videos.status} in ('uploading', 'processing')
          and ${videos.createdAt} > ${now - IN_FLIGHT_RESERVE_MS} then ${UPLOAD_MAX_DURATION_S}
        else 0 end), 0)`,
    })
    .from(videos)
    .where(eq(videos.channelId, channelId))
    .get()

  const usedS = Math.round(row?.usedS ?? 0)
  const remainingS = Math.max(0, CREATOR_STORAGE_MAX_S - usedS)
  const maxUploadS =
    remainingS >= UPLOAD_MIN_REMAINING_S ? Math.min(UPLOAD_MAX_DURATION_S, remainingS) : 0
  return { usedS, limitS: CREATOR_STORAGE_MAX_S, remainingS, maxUploadS }
}
