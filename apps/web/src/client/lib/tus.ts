import { Upload } from 'tus-js-client'

// The browser side of an upload, in its own module: only UploadDropzone (the /upload route)
// imports it, so tus-js-client stays in that route's chunk instead of the main bundle.

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
