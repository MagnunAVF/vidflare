import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link, notFound } from '@tanstack/react-router'

import { CommentForm } from '@/components/CommentForm'
import { CommentList } from '@/components/CommentList'
import { LikeButton } from '@/components/LikeButton'
import { StreamPlayer } from '@/components/StreamPlayer'
import { SubscribeButton } from '@/components/SubscribeButton'
import { Button } from '@/components/ui/button'
import { ApiRequestError } from '@/lib/api'
import { meQuery } from '@/lib/auth'
import { formatRelativeTime, formatViews } from '@/lib/format'
import { videoQuery } from '@/lib/videos'
import { useRecordView } from '@/lib/views'

export const Route = createFileRoute('/watch/$id')({
  // Prefetch before rendering; a missing (or not yet visible) video is a not-found page.
  loader: async ({ context, params }) => {
    try {
      await context.queryClient.ensureQueryData(videoQuery(params.id))
    } catch (err) {
      if (err instanceof ApiRequestError && (err.status === 404 || err.status === 400)) {
        throw notFound()
      }
      throw err
    }
  },
  notFoundComponent: VideoNotFound,
  component: WatchPage,
})

function WatchPage() {
  const { id } = Route.useParams()
  const { data: video } = useSuspenseQuery(videoQuery(id))
  const { data: me } = useQuery(meQuery)
  const recordView = useRecordView(id)

  return (
    <main className="mx-auto grid w-full max-w-5xl gap-4 px-4 py-6">
      {video.playerUrl ? (
        <StreamPlayer
          // Remount per video: the watched timer and its one view belong to one video.
          key={video.id}
          src={video.playerUrl}
          title={video.title}
          onWatched={() => recordView.mutate()}
        />
      ) : (
        // Only the owner sees a video that isn't ready.
        <div className="flex aspect-video w-full items-center justify-center rounded-lg bg-muted p-6 text-center text-sm text-muted-foreground">
          {video.status === 'error'
            ? 'Stream could not process this video.'
            : 'This video is still processing. It will play here once it’s ready.'}
        </div>
      )}

      <h1 className="text-xl font-semibold">{video.title}</h1>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
        <Link
          to="/c/$handle"
          params={{ handle: video.channel.handle }}
          className="font-medium text-foreground hover:underline"
        >
          {video.channel.name}
        </Link>
        <span>@{video.channel.handle}</span>
        <SubscribeButton
          channelId={video.channel.id}
          subscribed={video.channel.subscribedByMe}
          signedIn={Boolean(me)}
          isOwner={video.isOwner}
        />
        <span aria-hidden>·</span>
        <span>{formatViews(video.viewCount)}</span>
        {video.publishedAt !== null && (
          <>
            <span aria-hidden>·</span>
            <time dateTime={new Date(video.publishedAt).toISOString()}>
              {formatRelativeTime(video.publishedAt)}
            </time>
          </>
        )}
        {video.visibility === 'unlisted' && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-xs">Unlisted</span>
        )}
        {video.status === 'ready' && (
          <div className="ml-auto">
            <LikeButton
              videoId={video.id}
              liked={video.likedByMe}
              count={video.likeCount}
              signedIn={Boolean(me)}
            />
          </div>
        )}
      </div>

      {video.description && (
        <p className="whitespace-pre-wrap rounded-lg bg-muted/50 p-3 text-sm">
          {video.description}
        </p>
      )}

      {video.status === 'ready' && (
        <section aria-labelledby="comments-heading" className="grid gap-4 pt-2">
          <h2 id="comments-heading" className="text-lg font-semibold">
            {video.commentCount === 1 ? '1 comment' : `${video.commentCount} comments`}
          </h2>
          {me ? (
            <CommentForm videoId={video.id} />
          ) : (
            <p className="text-sm text-muted-foreground">
              <Link to="/login" className="font-medium text-foreground underline">
                Sign in
              </Link>{' '}
              to comment.
            </p>
          )}
          <CommentList videoId={video.id} />
        </section>
      )}
    </main>
  )
}

function VideoNotFound() {
  return (
    <main className="flex flex-col items-center gap-4 px-4 py-16 text-center">
      <h1 className="text-xl font-semibold">Video not found</h1>
      <p className="text-sm text-muted-foreground">
        It may have been removed, or the link is wrong.
      </p>
      <Button asChild variant="outline">
        <Link to="/">Back to home</Link>
      </Button>
    </main>
  )
}
