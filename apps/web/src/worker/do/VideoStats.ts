import { DurableObject } from 'cloudflare:workers'
import { eq, sql } from 'drizzle-orm'

import { getDb } from '../db/client'
import { videos } from '../db/schema'
import { telemetry } from '../lib/telemetry'

// How often accepted views are written to D1, at most.
export const VIEW_FLUSH_INTERVAL_MS = 60_000
// A viewer counts once per video within this window; after it, watching again is a new view.
export const VIEW_DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000

export interface RecordViewInput {
  videoId: string
  // Opaque, already-hashed viewer identity (signed-in session or anonymous viewer cookie).
  viewerKey: string
  // videos.view_count as the Worker just read it: the starting total for a fresh object.
  baseViewCount: number
}

export interface RecordViewResult {
  recorded: boolean
  viewCount: number
}

interface StatsRow extends Record<string, SqlStorageValue> {
  video_id: string
  views: number
  flushed: number
}

/**
 * Per-video view counter: one instance per video (`idFromName(videoId)`), SQLite storage.
 *
 * Views are deduped by viewer key and counted here, never written to D1 from a request. An
 * alarm flushes the absolute total to D1 at most every VIEW_FLUSH_INTERVAL_MS. The write is
 * `view_count = max(view_count, total)`, so a retried or repeated flush can't double-count.
 */
export class VideoStats extends DurableObject<Env> {
  private readonly sql: SqlStorage

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.sql = ctx.storage.sql
    // Synchronous, so it finishes before any request or alarm reaches this instance.
    this.migrate()
  }

  private migrate() {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS viewers (key TEXT PRIMARY KEY, seen_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS stats (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        video_id TEXT NOT NULL,
        views INTEGER NOT NULL,
        flushed INTEGER NOT NULL
      );
    `)
  }

  private stats(): StatsRow | undefined {
    return this.sql
      .exec<StatsRow>('SELECT video_id, views, flushed FROM stats WHERE id = 1')
      .toArray()[0]
  }

  // Counts a view unless this viewer was already counted within the dedupe window, and makes
  // sure a flush is scheduled. Returns the current total either way.
  async recordView(input: RecordViewInput, now = Date.now()): Promise<RecordViewResult> {
    const current = this.stats()
    if (!current) {
      this.sql.exec(
        'INSERT INTO stats (id, video_id, views, flushed) VALUES (1, ?, ?, ?)',
        input.videoId,
        input.baseViewCount,
        input.baseViewCount,
      )
    } else if (current.video_id !== input.videoId) {
      throw new Error('VideoStats: object addressed with another video id')
    } else if (input.baseViewCount > current.views) {
      // D1 is ahead (e.g. a manual fix): never count below it.
      this.sql.exec('UPDATE stats SET views = ? WHERE id = 1', input.baseViewCount)
    }

    const seen = this.sql
      .exec<{ seen_at: number }>('SELECT seen_at FROM viewers WHERE key = ?', input.viewerKey)
      .toArray()[0]
    if (seen && seen.seen_at > now - VIEW_DEDUPE_WINDOW_MS) {
      return { recorded: false, viewCount: this.stats()!.views }
    }

    this.sql.exec(
      'INSERT INTO viewers (key, seen_at) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET seen_at = excluded.seen_at',
      input.viewerKey,
      now,
    )
    this.sql.exec('UPDATE stats SET views = views + 1 WHERE id = 1')
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(now + VIEW_FLUSH_INTERVAL_MS)
    }
    return { recorded: true, viewCount: this.stats()!.views }
  }

  // Flush: write the total to D1 if it moved since the last flush. A thrown error (D1 down)
  // makes the runtime retry the alarm with backoff; the max() keeps retries harmless.
  override async alarm(): Promise<void> {
    const now = Date.now()
    this.sql.exec('DELETE FROM viewers WHERE seen_at <= ?', now - VIEW_DEDUPE_WINDOW_MS)

    const pending = this.stats()
    if (!pending || pending.views === pending.flushed) return

    const videoGone = await telemetry.startSpan(
      { name: 'stats.flush', op: 'db.update', attributes: { 'video.id': pending.video_id } },
      async () => {
        const updated = await getDb(this.env.DB)
          .update(videos)
          .set({ viewCount: sql`max(${videos.viewCount}, ${pending.views})` })
          .where(eq(videos.id, pending.video_id))
          .returning({ id: videos.id })
        return updated.length === 0
      },
    )

    if (videoGone) {
      // The video was deleted: nothing left to count for.
      await this.ctx.storage.deleteAlarm()
      await this.ctx.storage.deleteAll()
      this.migrate()
      return
    }

    this.sql.exec('UPDATE stats SET flushed = ? WHERE id = 1', pending.views)
    // Views that arrived while D1 was being written still need a flush.
    const after = this.stats()
    if (after && after.views > after.flushed && (await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + VIEW_FLUSH_INTERVAL_MS)
    }
  }
}
