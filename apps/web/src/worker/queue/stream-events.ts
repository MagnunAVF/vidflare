import * as Sentry from '@sentry/cloudflare'
import { and, eq, inArray, ne, sql } from 'drizzle-orm'

import { getDb, type Db } from '../db/client'
import { videos } from '../db/schema'
import { purgeVideoByStreamUid } from '../lib/cache'
import { streamEvent, type StreamEvent } from '../lib/stream-events'

export type ApplyResult = 'applied' | 'unchanged' | 'unknown_uid' | 'video_mismatch'

// Applies one Stream event to this environment's D1. Idempotent: queues redeliver, so a repeat
// is a no-op ('unchanged'). Only this environment's rows are touched: the video is found by
// stream_uid in its own D1, so a mis-routed event finds nothing ('unknown_uid').
export async function applyStreamEvent(
  db: Db,
  event: StreamEvent,
  now = Date.now(),
): Promise<ApplyResult> {
  const row = await db
    .select({ id: videos.id })
    .from(videos)
    .where(eq(videos.streamUid, event.uid))
    .get()
  if (!row) return 'unknown_uid'
  // The upload's meta.videoId must name the same row; anything else means crossed wires.
  if (event.videoId && event.videoId !== row.id) return 'video_mismatch'

  if (event.state === 'ready') {
    // From any status but ready (a ready event wins even over an earlier error). published_at
    // is set once and kept, so a later re-publish doesn't move the video in the feeds.
    const moved = await db
      .update(videos)
      .set({
        status: 'ready',
        durationS: event.durationS,
        thumbnailUrl: event.thumbnailUrl,
        publishedAt: sql`coalesce(${videos.publishedAt}, ${now})`,
      })
      .where(and(eq(videos.id, row.id), ne(videos.status, 'ready')))
      .returning({ id: videos.id })
      .get()
    return moved ? 'applied' : 'unchanged'
  }

  // An error never overwrites a video that is already ready.
  const failed = await db
    .update(videos)
    .set({ status: 'error' })
    .where(and(eq(videos.id, row.id), inArray(videos.status, ['uploading', 'processing'])))
    .returning({ id: videos.id })
    .get()
  return failed ? 'applied' : 'unchanged'
}

const log = (level: 'info' | 'warn' | 'error', fields: Record<string, unknown>) =>
  console[level](JSON.stringify(fields))

// Consumer for this environment's stream-events queue (fed by the Stream webhook handler).
// Each message is acked on its own; only an unexpected failure (e.g. D1 down) retries it.
// A status change purges the video's KV keys (watch page, home feed, channel videos).
export async function handleStreamEvents(batch: MessageBatch<unknown>, env: Env): Promise<void> {
  const db = getDb(env.DB)
  for (const message of batch.messages) {
    const parsed = streamEvent.safeParse(message.body)
    if (!parsed.success) {
      // Retrying can't fix a malformed message.
      log('warn', { msg: 'stream_event.invalid', messageId: message.id })
      message.ack()
      continue
    }
    const event = parsed.data
    const ids = { uid: event.uid, videoId: event.videoId, messageId: message.id }

    try {
      const result = await applyStreamEvent(db, event)
      // purgeCache logs its own failures, so the event is never retried over the cache.
      if (result === 'applied') await purgeVideoByStreamUid(env.CACHE, db, event.uid)
      if (result === 'applied' && event.state === 'ready') {
        log('info', { msg: 'video.ready', ...ids, durationS: event.durationS })
      } else if (result === 'applied') {
        log('warn', { msg: 'video.error', ...ids, errorReasonCode: event.errorReasonCode })
      } else if (result === 'unchanged') {
        log('info', { msg: 'stream_event.duplicate', ...ids, state: event.state })
      } else {
        log('warn', { msg: `stream_event.${result}`, ...ids })
      }
      message.ack()
    } catch (err) {
      Sentry.captureException(err)
      log('error', { msg: 'stream_event.failed', ...ids, attempts: message.attempts })
      message.retry()
    }
  }
}
