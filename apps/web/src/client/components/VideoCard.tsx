import { Link } from '@tanstack/react-router'
import { PlayIcon } from 'lucide-react'

import { formatDuration, formatRelativeTime, formatViews } from '@/lib/format'

export interface VideoCardData {
  id: string
  title: string
  thumbnailUrl: string | null
  durationS: number | null
  viewCount: number
  publishedAt: number
  channel: { handle: string; name: string }
}

// One video in a grid: thumbnail (with duration), title, channel, views and age.
export function VideoCard({ video }: { video: VideoCardData }) {
  return (
    <Link
      to="/watch/$id"
      params={{ id: video.id }}
      className="group grid gap-2 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
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
      <div className="grid gap-0.5">
        <h3 className="line-clamp-2 text-sm leading-snug font-medium">{video.title}</h3>
        <p className="text-sm text-muted-foreground">{video.channel.name}</p>
        <p className="text-sm text-muted-foreground">
          {formatViews(video.viewCount)} · {formatRelativeTime(video.publishedAt)}
        </p>
      </div>
    </Link>
  )
}
