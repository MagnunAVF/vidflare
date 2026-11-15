import { DurableObject } from 'cloudflare:workers'

/**
 * Per-video view/like counters (one instance per video, SQLite storage).
 * Placeholder until the Views work in Phase 3: dedupe, counters and the D1 flush alarm.
 */
export class VideoStats extends DurableObject<Env> {}
