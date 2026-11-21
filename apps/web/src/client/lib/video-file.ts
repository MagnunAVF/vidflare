// How long a picked video file is, read from its metadata in the browser (no bytes leave the
// device). null when the browser can't tell (an unsupported codec, or no answer in time): the
// upload then goes ahead and Stream enforces the length itself.
export function readVideoDuration(file: File, timeoutMs = 10_000): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    const done = (seconds: number | null) => {
      clearTimeout(timer)
      video.removeAttribute('src')
      video.load()
      URL.revokeObjectURL(url)
      resolve(seconds !== null && Number.isFinite(seconds) && seconds > 0 ? seconds : null)
    }
    const timer = setTimeout(() => done(null), timeoutMs)
    video.preload = 'metadata'
    video.onloadedmetadata = () => done(video.duration)
    video.onerror = () => done(null)
    video.src = url
  })
}
