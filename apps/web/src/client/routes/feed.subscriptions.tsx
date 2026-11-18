import { useSuspenseInfiniteQuery } from '@tanstack/react-query'
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { useCallback } from 'react'

import { Button } from '@/components/ui/button'
import { VideoGrid } from '@/components/VideoGrid'
import { meQuery } from '@/lib/auth'
import { subscriptionsFeedQuery } from '@/lib/subscriptions'

export const Route = createFileRoute('/feed/subscriptions')({
  // Signed-in only.
  beforeLoad: async ({ context }) => {
    if (!(await context.queryClient.ensureQueryData(meQuery))) throw redirect({ to: '/login' })
  },
  loader: ({ context }) => context.queryClient.ensureInfiniteQueryData(subscriptionsFeedQuery),
  component: SubscriptionsPage,
})

function SubscriptionsPage() {
  const feed = useSuspenseInfiniteQuery(subscriptionsFeedQuery)
  const videos = feed.data.pages.flatMap((page) => page.items)
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = feed
  const loadMore = useCallback(() => void fetchNextPage(), [fetchNextPage])

  return (
    <main className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-6">
      <h1 className="text-xl font-semibold">Subscriptions</h1>
      {videos.length === 0 ? (
        <div className="flex flex-col items-center gap-4 py-16 text-center">
          <p className="text-muted-foreground">
            Videos from channels you subscribe to will show up here.
          </p>
          <Button asChild variant="outline">
            <Link to="/">Find channels on the home page</Link>
          </Button>
        </div>
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
