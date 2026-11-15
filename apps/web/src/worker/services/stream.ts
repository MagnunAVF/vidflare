import { utf8 } from '../lib/encoding'

// Cloudflare Stream REST client. Stream isn't a Worker binding for tus uploads, so the Worker
// calls the API with this environment's token. Video bytes never come through here: the
// browser uploads straight to the one-time tus URL that createDirectUpload returns.

const API_BASE = 'https://api.cloudflare.com/client/v4/accounts'

export interface StreamConfig {
  accountId: string
  apiToken: string
}

export const streamConfig = (env: Env): StreamConfig => ({
  accountId: env.STREAM_ACCOUNT_ID,
  apiToken: env.STREAM_API_TOKEN,
})

// A failed Stream API call. Carries Stream's error codes, never the token or request body.
export class StreamApiError extends Error {
  readonly status: number

  constructor(operation: string, status: number, codes: number[] = []) {
    super(
      `Stream ${operation} failed (${status}${codes.length ? `, codes ${codes.join(',')}` : ''})`,
    )
    this.name = 'StreamApiError'
    this.status = status
  }
}

// Tags that route Stream's webhook events back to the right environment and row.
export interface StreamUploadMeta {
  env: string
  videoId: string
}

export interface DirectUpload {
  uid: string
  // One-time tus URL for the browser. It needs no credentials.
  uploadUrl: string
}

// tus Upload-Metadata: comma-separated `key base64(value)` pairs.
function tusMetadata(entries: Record<string, string | number>): string {
  return Object.entries(entries)
    .map(([key, value]) => `${key} ${toBase64(String(value))}`)
    .join(',')
}

function toBase64(value: string): string {
  let bin = ''
  for (const b of utf8(value)) bin += String.fromCharCode(b)
  return btoa(bin)
}

const authHeaders = (cfg: StreamConfig) => ({ Authorization: `Bearer ${cfg.apiToken}` })
const videoUrl = (cfg: StreamConfig, uid: string) =>
  `${API_BASE}/${cfg.accountId}/stream/${encodeURIComponent(uid)}`

async function errorCodes(res: Response): Promise<number[]> {
  const body = await res.json<{ errors?: { code?: number }[] }>().catch(() => null)
  return (body?.errors ?? []).flatMap((e) => (typeof e.code === 'number' ? [e.code] : []))
}

// Creates a direct creator upload for tus (resumable, any size up to Stream's limits).
// Arbitrary Upload-Metadata keys become the video's `meta`, so env and videoId are set in
// the same request that creates the video.
export async function createDirectUpload(
  cfg: StreamConfig,
  input: { sizeBytes: number; maxDurationSeconds: number; meta: StreamUploadMeta },
): Promise<DirectUpload> {
  const res = await fetch(`${API_BASE}/${cfg.accountId}/stream?direct_user=true`, {
    method: 'POST',
    headers: {
      ...authHeaders(cfg),
      'Tus-Resumable': '1.0.0',
      'Upload-Length': String(input.sizeBytes),
      'Upload-Metadata': tusMetadata({
        maxDurationSeconds: input.maxDurationSeconds,
        env: input.meta.env,
        videoId: input.meta.videoId,
      }),
    },
  })
  if (!res.ok) throw new StreamApiError('create upload', res.status, await errorCodes(res))

  // Stream says to read the uid from this header, never to parse it out of Location.
  const uploadUrl = res.headers.get('Location')
  const uid = res.headers.get('stream-media-id')
  if (!uploadUrl || !uid) throw new StreamApiError('create upload', res.status)
  return { uid, uploadUrl }
}

// The parts of a Stream video the app uses.
export interface StreamVideo {
  uid: string
  // pendingupload | downloading | queued | inprogress | ready | error | live-inprogress
  state: string
  errorReasonCode: string | null
  readyToStream: boolean
  durationS: number | null
  thumbnailUrl: string | null
  meta: Record<string, unknown>
}

interface StreamVideoBody {
  result?: {
    uid: string
    status?: { state?: string; errorReasonCode?: string }
    readyToStream?: boolean
    duration?: number
    thumbnail?: string
    meta?: Record<string, unknown>
  }
}

// Status lookup for one video; null when Stream doesn't know the uid (e.g. already deleted).
export async function getVideo(cfg: StreamConfig, uid: string): Promise<StreamVideo | null> {
  const res = await fetch(videoUrl(cfg, uid), { headers: authHeaders(cfg) })
  if (res.status === 404) return null
  if (!res.ok) throw new StreamApiError('get video', res.status, await errorCodes(res))

  const body = await res.json<StreamVideoBody>()
  const v = body.result
  if (!v) throw new StreamApiError('get video', res.status)
  return {
    uid: v.uid,
    state: v.status?.state ?? 'unknown',
    errorReasonCode: v.status?.errorReasonCode || null,
    readyToStream: v.readyToStream === true,
    // Stream reports -1 while the duration is unknown.
    durationS: typeof v.duration === 'number' && v.duration >= 0 ? Math.round(v.duration) : null,
    thumbnailUrl: v.thumbnail || null,
    meta: v.meta ?? {},
  }
}

// Deletes a video and its copies. Deleting one that's already gone counts as success.
export async function deleteVideo(cfg: StreamConfig, uid: string): Promise<void> {
  const res = await fetch(videoUrl(cfg, uid), { method: 'DELETE', headers: authHeaders(cfg) })
  if (res.ok || res.status === 404) return
  throw new StreamApiError('delete video', res.status, await errorCodes(res))
}
