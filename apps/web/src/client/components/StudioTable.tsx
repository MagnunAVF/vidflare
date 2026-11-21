import { Link } from '@tanstack/react-router'
import type { VideoStatus, VideoVisibility } from '@vidflare/shared'
import { PlayIcon } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { EditVideoDialog } from '@/components/EditVideoDialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatDuration, formatViews } from '@/lib/format'
import { useDeleteVideo } from '@/lib/videos'

export interface StudioVideo {
  id: string
  title: string
  description: string
  status: VideoStatus
  visibility: VideoVisibility
  durationS: number | null
  thumbnailUrl: string | null
  viewCount: number
  likeCount: number
  commentCount: number
  createdAt: number
  // Set when a moderator took the video down after a report: hidden everywhere.
  takenDownAt: number | null
}

const statusBadges: Record<
  VideoStatus,
  { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }
> = {
  uploading: { label: 'Uploading', variant: 'outline' },
  processing: { label: 'Processing', variant: 'secondary' },
  ready: { label: 'Ready', variant: 'default' },
  error: { label: 'Failed', variant: 'destructive' },
}

export function StatusBadge({ status }: { status: VideoStatus }) {
  const { label, variant } = statusBadges[status]
  return <Badge variant={variant}>{label}</Badge>
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })

// The creator's videos with status, visibility, stats and actions. `extraActions` lets the
// page add per-row actions (the Stream re-check).
export function StudioTable(props: {
  videos: StudioVideo[]
  extraActions?: (video: StudioVideo) => ReactNode
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Video</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Visibility</TableHead>
          <TableHead>Uploaded</TableHead>
          <TableHead className="text-right">Views</TableHead>
          <TableHead className="text-right">
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {props.videos.map((video) => (
          <TableRow key={video.id}>
            <TableCell>
              <div className="flex items-center gap-3">
                <div className="relative aspect-video w-28 shrink-0 overflow-hidden rounded bg-muted">
                  {video.thumbnailUrl ? (
                    <img
                      src={video.thumbnailUrl}
                      alt=""
                      loading="lazy"
                      className="size-full object-cover"
                    />
                  ) : (
                    <PlayIcon
                      aria-hidden
                      className="absolute inset-0 m-auto size-5 text-muted-foreground"
                    />
                  )}
                  {video.durationS !== null && (
                    <span className="absolute right-1 bottom-1 rounded bg-black/80 px-1 text-[10px] text-white tabular-nums">
                      {formatDuration(video.durationS)}
                    </span>
                  )}
                </div>
                {video.status === 'ready' && video.takenDownAt === null ? (
                  <Link
                    to="/watch/$id"
                    params={{ id: video.id }}
                    className="line-clamp-2 max-w-xs font-medium hover:underline"
                  >
                    {video.title}
                  </Link>
                ) : (
                  <span className="line-clamp-2 max-w-xs font-medium">{video.title}</span>
                )}
              </div>
            </TableCell>
            <TableCell>
              {video.takenDownAt !== null ? (
                <Badge
                  variant="destructive"
                  title="Removed after a report. It no longer plays or shows anywhere."
                >
                  Taken down
                </Badge>
              ) : (
                <StatusBadge status={video.status} />
              )}
            </TableCell>
            <TableCell className="capitalize">{video.visibility}</TableCell>
            <TableCell>{dateFormat.format(video.createdAt)}</TableCell>
            <TableCell className="text-right tabular-nums">
              {formatViews(video.viewCount)}
            </TableCell>
            <TableCell>
              <div className="flex justify-end gap-2">
                {props.extraActions?.(video)}
                <EditVideoDialog video={video} />
                <DeleteVideoButton id={video.id} title={video.title} />
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function DeleteVideoButton(props: { id: string; title: string }) {
  const remove = useDeleteVideo()
  const [error, setError] = useState<string>()
  return (
    <AlertDialog onOpenChange={() => setError(undefined)}>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" className="text-destructive">
          Delete
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete “{props.title}”?</AlertDialogTitle>
          <AlertDialogDescription>
            The video, its likes and its comments are removed for good. This can’t be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={remove.isPending}
            onClick={async (event) => {
              // Keep the dialog open until the delete finishes (or fails).
              event.preventDefault()
              try {
                await remove.mutateAsync(props.id)
              } catch {
                setError('Could not delete the video. Please try again.')
              }
            }}
          >
            {remove.isPending ? 'Deleting…' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
