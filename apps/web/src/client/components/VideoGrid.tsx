import { InfiniteScrollSentinel } from '@/components/InfiniteScrollSentinel'
import { VideoCard, type VideoCardData } from '@/components/VideoCard'

// A responsive grid of video cards with infinite scroll: when the sentinel below the grid
// comes near the viewport, onLoadMore fetches the next page.
export function VideoGrid(props: {
  videos: VideoCardData[]
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => void
}) {
  return (
    <>
      <div className="grid grid-cols-1 gap-x-4 gap-y-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {props.videos.map((video) => (
          <VideoCard key={video.id} video={video} />
        ))}
      </div>
      <InfiniteScrollSentinel
        hasMore={props.hasMore}
        loadingMore={props.loadingMore}
        onLoadMore={props.onLoadMore}
      />
    </>
  )
}
