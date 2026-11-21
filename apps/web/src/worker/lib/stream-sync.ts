import { and, eq } from 'drizzle-orm'

import type { Db } from '../db/client'
import { videos } from '../db/schema'
import { applyStreamEvent } from '../queue/stream-events'
import { getVideo, streamConfig } from '../services/stream'
import { purgeVideoByStreamUid } from './cache'
import type { StreamEvent } from './stream-events'

// Stream states that mean the bytes are in and encoding is under way or queued.
const PROCESSING_STATES = ['downloading', 'queued', 'inprogress']

export interface StreamSyncResult {
  // What Stream reports ('not_found' when it no longer knows the uid).
  streamState: string
  // Whether the row's status changed.
  changed: boolean
}

// Asks Stream for one video's state and applies it to this environment's row, through the same
// code as the queue consumer: the fallback when a webhook never arrived (always the case in
// local dev). Used by the studio re-check and the nightly reconcile. The caller has already
// checked the row belongs to this environment (and, in the studio, to the user).
export async function syncWithStream(
  env: Env,
  db: Db,
  video: { id: string; streamUid: string },
): Promise<StreamSyncResult> {
  const uid = video.streamUid
  const stream = await getVideo(streamConfig(env), uid)
  const base = {
    uid,
    videoId: video.id,
    env: env.ENVIRONMENT,
    durationS: null,
    thumbnailUrl: null,
  }

  let event: StreamEvent | null = null
  let changed = false
  if (!stream) {
    // Gone from Stream (deleted, or an upload that expired before any bytes arrived).
    event = { ...base, state: 'error', errorReasonCode: 'not_found' }
  } else if (stream.state === 'ready' && stream.readyToStream) {
    event = {
      ...base,
      state: 'ready',
      durationS: stream.durationS,
      thumbnailUrl: stream.thumbnailUrl,
      errorReasonCode: null,
    }
  } else if (stream.state === 'error') {
    event = { ...base, state: 'error', errorReasonCode: stream.errorReasonCode ?? 'unknown' }
  } else if (PROCESSING_STATES.includes(stream.state)) {
    // Stream has the bytes but the browser never reported the upload: catch up.
    const moved = await db
      .update(videos)
      .set({ status: 'processing' })
      .where(and(eq(videos.id, video.id), eq(videos.status, 'uploading')))
      .returning({ id: videos.id })
      .get()
    changed = moved !== undefined
  }

  if (event && (await applyStreamEvent(db, event)) === 'applied') {
    changed = true
    await purgeVideoByStreamUid(env.CACHE, db, uid)
  }
  return { streamState: stream?.state ?? 'not_found', changed }
}
