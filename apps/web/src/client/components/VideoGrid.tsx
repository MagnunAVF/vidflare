import { useEffect, useRef } from 'react'

import { VideoCard, type VideoCardData } from '@/components/VideoCard'

// A responsive grid of video cards with infinite scroll: when the sentinel below the grid
// comes near the viewport, onLoadMore fetches the next page.
export function VideoGrid(props: {
  videos: VideoCardData[]
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => void
}) {
  const { hasMore, loadingMore, onLoadMore } = props
  const sentinel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = sentinel.current
    if (!el || !hasMore || loadingMore) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) onLoadMore()
      },
      // Start loading a bit before the user reaches the end.
      { rootMargin: '600px 0px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasMore, loadingMore, onLoadMore])

  return (
    <>
      <div className="grid grid-cols-1 gap-x-4 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {props.videos.map((video) => (
          <VideoCard key={video.id} video={video} />
        ))}
      </div>
      <div ref={sentinel} aria-hidden className="h-px" />
      {loadingMore && (
        <p role="status" className="py-6 text-center text-sm text-muted-foreground">
          Loading more videos…
        </p>
      )}
    </>
  )
}
