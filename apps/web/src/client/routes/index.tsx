import { useQuery, useSuspenseInfiniteQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useCallback } from 'react'

import { Button } from '@/components/ui/button'
import { VideoGrid } from '@/components/VideoGrid'
import { meQuery } from '@/lib/auth'
import { homeFeedQuery } from '@/lib/videos'

export const Route = createFileRoute('/')({
  // The first page starts loading before the page renders.
  loader: ({ context }) => context.queryClient.ensureInfiniteQueryData(homeFeedQuery),
  component: HomePage,
})

function HomePage() {
  const feed = useSuspenseInfiniteQuery(homeFeedQuery)
  const { data: me } = useQuery(meQuery)
  const videos = feed.data.pages.flatMap((page) => page.items)
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = feed
  const loadMore = useCallback(() => void fetchNextPage(), [fetchNextPage])

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6">
      <h1 className="sr-only">Latest videos</h1>
      {videos.length === 0 ? (
        <div className="flex flex-col items-center gap-4 py-16 text-center">
          <p className="text-muted-foreground">No videos yet.</p>
          {me && (
            <Button asChild>
              <Link to="/upload">Upload the first one</Link>
            </Button>
          )}
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
