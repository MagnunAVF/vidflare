import { queryOptions, useMutation } from '@tanstack/react-query'
import type { CreateUploadInput, VideoStatus } from '@vidflare/shared'
import { Upload } from 'tus-js-client'

import { api, unwrap } from './api'

// Creates the video row and a one-time Stream upload URL (POST /api/videos/uploads).
export function useCreateUpload() {
  return useMutation({
    mutationFn: async (input: CreateUploadInput) =>
      unwrap(await api.api.videos.uploads.$post({ json: input })),
  })
}

// Tells the API the bytes are in Stream: uploading → processing.
export function useMarkUploaded() {
  return useMutation({
    mutationFn: async (id: string) =>
      unwrap(await api.api.videos[':id'].uploaded.$post({ param: { id } })),
  })
}

const POLL_INTERVAL_MS = 5000
const isFinal = (status: VideoStatus | undefined) => status === 'ready' || status === 'error'

// An uploaded video's status, refetched every few seconds until Stream is done with it
// (`ready` or `error`, set by the webhook's queue consumer).
export const videoStatusQuery = (id: string) =>
  queryOptions({
    queryKey: ['videos', id, 'status'],
    queryFn: async () => unwrap(await api.api.videos[':id'].status.$get({ param: { id } })),
    refetchInterval: (query) => (isFinal(query.state.data?.status) ? false : POLL_INTERVAL_MS),
    // Keep polling when the user switches tabs; uploads often run in the background.
    refetchIntervalInBackground: true,
  })

// Stream's tus rules: every chunk the same size, a multiple of 256 KiB, 5–200 MiB.
// 50 MiB is Stream's recommendation for reliable connections.
const CHUNK_SIZE = 50 * 1024 * 1024

// Sends the file straight from the browser to Stream's one-time tus URL (never through our
// API). Resolves when Stream has every byte; rejects on failure or when `signal` aborts.
export function uploadToStream(
  file: File,
  uploadUrl: string,
  options: { onProgress: (fraction: number) => void; signal: AbortSignal },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const upload = new Upload(file, {
      // The upload already exists (our API created it), so tus resumes it instead of creating.
      uploadUrl,
      chunkSize: CHUNK_SIZE,
      retryDelays: [0, 1000, 3000, 5000, 10000],
      // One-time URLs: there's nothing to resume across page loads.
      storeFingerprintForResuming: false,
      onProgress: (sent, total) => options.onProgress(total > 0 ? sent / total : 0),
      onSuccess: () => resolve(),
      onError: reject,
    })
    options.signal.addEventListener(
      'abort',
      () => {
        void upload.abort()
        reject(new DOMException('Upload cancelled', 'AbortError'))
      },
      { once: true },
    )
    upload.start()
  })
}
