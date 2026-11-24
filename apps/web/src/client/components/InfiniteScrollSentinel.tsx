import { useEffect, useRef } from 'react'

// Goes below an infinite list: when it comes near the viewport, onLoadMore fetches the next
// page. Also shows the "loading more" status line.
export function InfiniteScrollSentinel(props: {
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
      <div ref={sentinel} aria-hidden className="h-px" />
      {loadingMore && (
        <p role="status" className="py-6 text-center text-sm text-muted-foreground">
          Loading more videos…
        </p>
      )}
    </>
  )
}
