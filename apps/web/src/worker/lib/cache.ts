import { eq } from 'drizzle-orm'
import type { Context } from 'hono'

import type { Db } from '../db/client'
import { channels, videos } from '../db/schema'
import type { AppEnv } from '../types'

// KV read cache (binding CACHE) for the busiest public reads: the first page of the home feed
// and of each channel's videos, and the channel and watch pages as a signed-out visitor sees
// them. Signed-in responses carry per-viewer fields (likedByMe, subscribedByMe, isOwner) and
// must show the viewer's own likes, comments and subscribes at once, so they read D1.
//
// Entries live CACHE_TTL_S. Writes that change a cached response delete its keys; counters
// (views, likes, comments, subscribers) are left to the TTL: purging on every like would also
// run into KV's limit of one write per second per key. KV is eventually consistent, so a purge
// can take up to the TTL to reach other locations.
export const CACHE_TTL_S = 60 // KV's minimum expirationTtl

// Bump the version when a cached response changes shape, so old entries are never read.
const V = 'v1'
export const cacheKeys = {
  homeFeed: () => `${V}:feed:home`,
  channel: (handle: string) => `${V}:channel:${handle}`,
  channelVideos: (handle: string) => `${V}:channel:${handle}:videos`,
  video: (id: string) => `${V}:video:${id}`,
}

// Everything that lists or shows one video: its watch page, the home feed and its channel's
// videos.
export const videoCacheKeys = (videoId: string, channelHandle: string) => [
  cacheKeys.video(videoId),
  cacheKeys.homeFeed(),
  cacheKeys.channelVideos(channelHandle),
]

// Everything that shows a channel's name, handle or avatar, apart from watch pages (one per
// video, left to the TTL).
export const channelCacheKeys = (channelHandle: string) => [
  cacheKeys.channel(channelHandle),
  cacheKeys.channelVideos(channelHandle),
  cacheKeys.homeFeed(),
]

const warn = (msg: string, fields: Record<string, unknown>) =>
  console.warn(JSON.stringify({ msg, ...fields }))

// The cached value under key, or load() stored there for CACHE_TTL_S. Only successful loads
// are stored: a load that throws (e.g. a 404) caches nothing. A KV failure falls back to load()
// instead of failing the request. Sets X-Cache: HIT | MISS.
export async function cached<T>(
  c: Context<AppEnv>,
  key: string,
  load: () => Promise<T>,
): Promise<T> {
  const hit = await c.env.CACHE.get<T>(key, 'json').catch((err: unknown) => {
    warn('cache.read_failed', { error: String(err) })
    return null
  })
  if (hit !== null) {
    c.header('X-Cache', 'HIT')
    return hit
  }

  const value = await load()
  c.header('X-Cache', 'MISS')
  // After the response: the client doesn't wait for the KV write.
  c.executionCtx.waitUntil(
    c.env.CACHE.put(key, JSON.stringify(value), { expirationTtl: CACHE_TTL_S }).catch(
      (err: unknown) => warn('cache.write_failed', { error: String(err) }),
    ),
  )
  return value
}

// Deletes keys after a write. Awaited, so the writer's next read misses (in this location). A
// failure is logged, not thrown: the write already happened, and the TTL bounds the staleness.
export async function purgeCache(kv: KVNamespace, keys: string[]): Promise<void> {
  const results = await Promise.allSettled([...new Set(keys)].map((key) => kv.delete(key)))
  const failed = results.filter((r) => r.status === 'rejected').length
  if (failed) warn('cache.purge_failed', { failed, total: results.length })
}

// Purge for a video known only by its Stream uid (queue consumer, studio re-check).
export async function purgeVideoByStreamUid(kv: KVNamespace, db: Db, streamUid: string) {
  const row = await db
    .select({ id: videos.id, handle: channels.handle })
    .from(videos)
    .innerJoin(channels, eq(channels.id, videos.channelId))
    .where(eq(videos.streamUid, streamUid))
    .get()
  if (row) await purgeCache(kv, videoCacheKeys(row.id, row.handle))
}
