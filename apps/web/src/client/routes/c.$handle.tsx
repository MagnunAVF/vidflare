import { useSuspenseInfiniteQuery, useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { useCallback } from 'react'

import { ChannelHeader } from '@/components/ChannelHeader'
import { Button } from '@/components/ui/button'
import { VideoGrid } from '@/components/VideoGrid'
import { ApiRequestError } from '@/lib/api'
import { channelQuery, channelVideosQuery } from '@/lib/channels'

export const Route = createFileRoute('/c/$handle')({
  // Header and first page of videos load in parallel; an unknown or invalid handle is a
  // not-found page.
  loader: async ({ context, params }) => {
    try {
      await Promise.all([
        context.queryClient.ensureQueryData(channelQuery(params.handle)),
        context.queryClient.ensureInfiniteQueryData(channelVideosQuery(params.handle)),
      ])
    } catch (err) {
      if (err instanceof ApiRequestError && (err.status === 404 || err.status === 400)) {
        throw notFound()
      }
      throw err
    }
  },
  notFoundComponent: ChannelNotFound,
  component: ChannelPage,
})

function ChannelPage() {
  const { handle } = Route.useParams()
  const { data: channel } = useSuspenseQuery(channelQuery(handle))
  const feed = useSuspenseInfiniteQuery(channelVideosQuery(handle))
  const videos = feed.data.pages.flatMap((page) => page.items)
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = feed
  const loadMore = useCallback(() => void fetchNextPage(), [fetchNextPage])

  return (
    <main className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-6">
      <ChannelHeader channel={channel} />
      {videos.length === 0 ? (
        <p className="py-12 text-center text-muted-foreground">
          {channel.isOwner ? 'You haven’t published any public videos yet.' : 'No videos yet.'}
        </p>
      ) : (
        <VideoGrid
          videos={videos}
          hasMore={hasNextPage}
          loadingMore={isFetchingNextPage}
          onLoadMore={loadMore}
        />
      )}
    </main>
  )
}

function ChannelNotFound() {
  return (
    <main className="flex flex-col items-center gap-4 px-4 py-16 text-center">
      <h1 className="text-xl font-semibold">Channel not found</h1>
      <p className="text-sm text-muted-foreground">The link may be wrong.</p>
      <Button asChild variant="outline">
        <Link to="/">Back to home</Link>
      </Button>
    </main>
  )
}
