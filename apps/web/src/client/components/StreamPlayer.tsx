import { useEffect, useRef } from 'react'

import { clientMetrics } from '@/lib/sentry'
import { loadStreamSdk } from '@/lib/stream-sdk'

// Seconds of actual playback before the video counts as watched.
const WATCHED_AFTER_S = 10
// timeupdate fires a few times per second while playing; a bigger jump is a seek, not playback.
const MAX_PLAYBACK_STEP_S = 1.5

// Cloudflare Stream's player in an iframe. Video segments come from Stream's CDN, never from
// our Worker. Only the watch route imports this, so it ships in that route's chunk.
// onWatched fires once per mount, after WATCHED_AFTER_S seconds of playback (seeking ahead
// doesn't count). Remount it (key) for another video.
export function StreamPlayer(props: { src: string; title: string; onWatched?: () => void }) {
  const iframe = useRef<HTMLIFrameElement>(null)
  const onWatched = useRef(props.onWatched)
  useEffect(() => {
    onWatched.current = props.onWatched
  })

  useEffect(() => {
    const el = iframe.current
    if (!el) return
    let disposed = false
    let detach: (() => void) | undefined

    loadStreamSdk()
      .then((Stream) => {
        if (disposed) return
        const player = Stream(el)
        let last: number | null = null
        let watched = 0
        let fired = false
        const onTimeUpdate = () => {
          const now = player.currentTime
          const step = last === null ? 0 : now - last
          last = now
          // Paused or rewound: no progress. A big jump: a seek. Neither counts as watching.
          // (The SDK's `paused` isn't reliable enough to use here; currentTime is.)
          if (fired || step <= 0 || step > MAX_PLAYBACK_STEP_S) return
          watched += step
          if (watched >= WATCHED_AFTER_S) {
            fired = true
            onWatched.current?.()
          }
        }
        // A seek resets the reference point, so the jump itself is never counted.
        const onSeeked = () => {
          last = player.currentTime
        }
        // player.start_time: from the first play request to the first frame, once per load.
        let playRequestedAt: number | null = null
        let startReported = false
        const onPlay = () => {
          if (playRequestedAt === null) playRequestedAt = performance.now()
        }
        const onPlaying = () => {
          if (startReported || playRequestedAt === null) return
          startReported = true
          clientMetrics.playerStartTime(performance.now() - playRequestedAt)
        }
        player.addEventListener('timeupdate', onTimeUpdate)
        player.addEventListener('seeked', onSeeked)
        player.addEventListener('play', onPlay)
        player.addEventListener('playing', onPlaying)
        detach = () => {
          player.removeEventListener?.('timeupdate', onTimeUpdate)
          player.removeEventListener?.('seeked', onSeeked)
          player.removeEventListener?.('play', onPlay)
          player.removeEventListener?.('playing', onPlaying)
        }
      })
      // Without the SDK the video still plays; it just isn't counted.
      .catch(() => {})

    return () => {
      disposed = true
      detach?.()
    }
  }, [])

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black">
      <iframe
        ref={iframe}
        src={props.src}
        title={props.title}
        className="absolute inset-0 size-full border-0"
        allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture"
        allowFullScreen
      />
    </div>
  )
}
