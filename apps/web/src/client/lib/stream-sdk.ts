// Cloudflare Stream's Player API SDK. It wraps an existing Stream <iframe> and exposes
// media-element-like properties and events (currentTime, paused, timeupdate, ...).
// https://developers.cloudflare.com/stream/viewing-videos/using-the-stream-player/using-the-player-api/
const SDK_URL = 'https://embed.cloudflarestream.com/embed/sdk.latest.js'

// The subset of the SDK's player this app uses.
export interface StreamPlayerApi {
  readonly currentTime: number
  addEventListener(type: string, listener: () => void): void
  removeEventListener?(type: string, listener: () => void): void
}

type StreamFactory = (iframe: HTMLIFrameElement) => StreamPlayerApi

declare global {
  interface Window {
    Stream?: StreamFactory
  }
}

let loading: Promise<StreamFactory> | undefined

// Loads the SDK script once per page; later calls share the same promise. A failed load (e.g.
// blocked by an extension) rejects, and the next call tries again.
export function loadStreamSdk(): Promise<StreamFactory> {
  if (window.Stream) return Promise.resolve(window.Stream)
  loading ??= new Promise<StreamFactory>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SDK_URL
    script.async = true
    script.onload = () =>
      window.Stream ? resolve(window.Stream) : reject(new Error('Stream SDK did not load'))
    script.onerror = () => reject(new Error('Stream SDK failed to load'))
    document.head.append(script)
  }).catch((err: unknown) => {
    loading = undefined
    throw err
  })
  return loading
}
