import { Link } from '@tanstack/react-router'
import { PlayIcon } from 'lucide-react'

import { ChannelAvatar } from '@/components/ChannelAvatar'
import { InfiniteScrollSentinel } from '@/components/InfiniteScrollSentinel'
import type { VideoCardData } from '@/components/VideoCard'
import { formatDuration, formatRelativeTime, formatViews } from '@/lib/format'

export type VideoListItemData = VideoCardData & {
  channel: { avatarKey: string | null }
}

// Videos as full-width rows (thumbnail beside the details), for search results, with the same
// infinite scroll as VideoGrid.
export function VideoList(props: {
  videos: VideoListItemData[]
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => void
}) {
  return (
    <>
      <ul className="grid gap-4">
        {props.videos.map((video) => (
          <li key={video.id}>
            <VideoListItem video={video} />
          </li>
        ))}
      </ul>
      <InfiniteScrollSentinel
        hasMore={props.hasMore}
        loadingMore={props.loadingMore}
        onLoadMore={props.onLoadMore}
      />
    </>
  )
}

function VideoListItem({ video }: { video: VideoListItemData }) {
  return (
    <Link
      to="/watch/$id"
      params={{ id: video.id }}
      className="group grid grid-cols-[minmax(0,10rem)_1fr] gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring sm:grid-cols-[minmax(0,22rem)_1fr] sm:gap-4"
    >
      <div className="relative aspect-video overflow-hidden rounded-lg bg-muted">
        {video.thumbnailUrl ? (
          <img
            src={video.thumbnailUrl}
            alt=""
            loading="lazy"
            className="size-full object-cover transition-transform group-hover:scale-[1.02]"
          />
        ) : (
          <div className="flex size-full items-center justify-center text-muted-foreground">
            <PlayIcon aria-hidden className="size-8" />
          </div>
        )}
        {video.durationS !== null && (
          <span className="absolute right-1.5 bottom-1.5 rounded bg-black/80 px-1 py-0.5 text-xs font-medium text-white tabular-nums">
            {formatDuration(video.durationS)}
          </span>
        )}
      </div>
      <div className="grid content-start gap-1">
        <h3 className="line-clamp-2 leading-snug font-medium sm:text-lg">{video.title}</h3>
        <p className="text-sm text-muted-foreground">
          {formatViews(video.viewCount)} · {formatRelativeTime(video.publishedAt)}
        </p>
        {/* A div, not a p: the avatar placeholder is a div. */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ChannelAvatar channel={video.channel} className="size-6 text-xs" />
          <span className="truncate">{video.channel.name}</span>
        </div>
      </div>
    </Link>
  )
}
