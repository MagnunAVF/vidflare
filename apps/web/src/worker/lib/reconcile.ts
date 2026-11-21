import { and, asc, eq, inArray, lt } from 'drizzle-orm'

import { getDb } from '../db/client'
import { videos } from '../db/schema'
import { deleteVideo, listVideos, streamConfig } from '../services/stream'
import { syncWithStream } from './stream-sync'
import { telemetry } from './telemetry'

// Nightly at 03:00 UTC (wrangler.jsonc `triggers.crons` must match). Also the schedule of the
// Sentry cron monitor, so a missed or failed night alerts.
export const RECONCILE_CRON = '0 3 * * *'
export const RECONCILE_MONITOR_SLUG = 'reconcile-videos'

// A video still uploading/processing after this most likely missed its webhook.
export const STUCK_AFTER_MS = 60 * 60 * 1000
// An upload Stream still waits for after this was abandoned in the browser.
export const ABANDONED_AFTER_MS = 24 * 60 * 60 * 1000
// A stage-tagged Stream video this old with no row in stage's D1 is an orphan (e.g. the row was
// deleted or the insert failed). The grace keeps an upload whose row is being written safe.
export const ORPHAN_AFTER_MS = 24 * 60 * 60 * 1000

// Per-run caps, so a run stays inside Workers' subrequest limit (50 on the free plan): at most
// STUCK_BATCH status lookups plus a delete for each abandoned one (30), ORPHAN_PAGES list calls
// and ORPHAN_DELETES deletes (12): 42 at worst. What's left is picked up the next night.
export const STUCK_BATCH = 15
export const ORPHAN_PAGES = 2
export const ORPHAN_PAGE_SIZE = 100
export const ORPHAN_DELETES = 10

export interface ReconcileReport {
  checked: number
  updated: number
  abandoned: number
  orphansDeleted: number
  failed: number
}

const log = (level: 'info' | 'warn' | 'error', fields: Record<string, unknown>) =>
  console[level](JSON.stringify(fields))

// The nightly reconcile for this environment. Works only on this environment's own rows, never
// the whole library, except stage's orphan sweep (stage-tagged videos only; see "Stream across
// environments" in the roadmap). Every step is idempotent, so a re-run is harmless. Throws at
// the end if any video failed, so the cron monitor reports the run as failed.
export async function reconcileVideos(env: Env, now = Date.now()): Promise<ReconcileReport> {
  const db = getDb(env.DB)
  const report: ReconcileReport = {
    checked: 0,
    updated: 0,
    abandoned: 0,
    orphansDeleted: 0,
    failed: 0,
  }

  // 1. Stuck uploads: ask Stream, apply what it says (oldest first).
  const stuck = await db
    .select({
      id: videos.id,
      streamUid: videos.streamUid,
      status: videos.status,
      createdAt: videos.createdAt,
    })
    .from(videos)
    .where(
      and(
        inArray(videos.status, ['uploading', 'processing']),
        lt(videos.createdAt, now - STUCK_AFTER_MS),
      ),
    )
    .orderBy(asc(videos.createdAt))
    .limit(STUCK_BATCH)
    .all()

  for (const video of stuck) {
    if (!video.streamUid) continue
    report.checked++
    try {
      const result = await syncWithStream(env, db, { id: video.id, streamUid: video.streamUid })
      if (result.changed) report.updated++
      // Never sent: drop the empty Stream video and mark the row failed, so it stops holding
      // the creator's storage and shows as failed in the studio.
      if (
        result.streamState === 'pendingupload' &&
        video.status === 'uploading' &&
        video.createdAt < now - ABANDONED_AFTER_MS
      ) {
        await deleteVideo(streamConfig(env), video.streamUid)
        const marked = await db
          .update(videos)
          .set({ status: 'error' })
          .where(and(eq(videos.id, video.id), eq(videos.status, 'uploading')))
          .returning({ id: videos.id })
          .get()
        if (marked) {
          report.abandoned++
          telemetry.count('upload.failed', { source: 'reconcile', reason: 'abandoned' })
        }
      }
    } catch (err) {
      report.failed++
      log('warn', {
        msg: 'reconcile.video_failed',
        videoId: video.id,
        error: err instanceof Error ? err.message : 'unknown',
      })
    }
  }

  // 2. Stage only: stage-tagged Stream videos with no row in stage's D1.
  if (env.ENVIRONMENT === 'stage') {
    try {
      report.orphansDeleted = await deleteStageOrphans(env, now)
    } catch (err) {
      report.failed++
      log('warn', {
        msg: 'reconcile.orphans_failed',
        error: err instanceof Error ? err.message : 'unknown',
      })
    }
  }

  log(report.failed ? 'error' : 'info', { msg: 'reconcile.done', ...report })
  if (report.failed) throw new Error(`reconcile: ${report.failed} step(s) failed`)
  return report
}

async function deleteStageOrphans(env: Env, now: number): Promise<number> {
  const db = getDb(env.DB)
  const cfg = streamConfig(env)
  const cutoff = now - ORPHAN_AFTER_MS
  let deleted = 0
  let end: string | undefined

  for (let page = 0; page < ORPHAN_PAGES && deleted < ORPHAN_DELETES; page++) {
    const listed = await listVideos(cfg, { limit: ORPHAN_PAGE_SIZE, end })
    const candidates = listed
      .filter((v) => v.meta.env === 'stage' && Date.parse(v.created) < cutoff)
      .map((v) => v.uid)
    if (candidates.length) {
      const known = await db
        .select({ uid: videos.streamUid })
        .from(videos)
        .where(inArray(videos.streamUid, candidates))
        .all()
      const knownUids = new Set(known.map((k) => k.uid))
      for (const uid of candidates) {
        if (knownUids.has(uid) || deleted >= ORPHAN_DELETES) continue
        await deleteVideo(cfg, uid)
        deleted++
        log('info', { msg: 'reconcile.orphan_deleted', streamUid: uid })
      }
    }
    if (listed.length < ORPHAN_PAGE_SIZE) break
    end = listed.at(-1)!.created
  }
  return deleted
}
