import { useSuspenseInfiniteQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { searchPageParams } from '@vidflare/shared'
import { useCallback } from 'react'

import { VideoList } from '@/components/VideoList'
import { searchQuery } from '@/lib/search'

export const Route = createFileRoute('/search')({
  // Missing, blank or too-long q becomes undefined (see searchPageParams), never an error.
  validateSearch: searchPageParams,
  loaderDeps: ({ search }) => ({ q: search.q }),
  // The first page of results starts loading before the page renders.
  loader: ({ context, deps }) =>
    deps.q ? context.queryClient.ensureInfiniteQueryData(searchQuery(deps.q)) : undefined,
  component: SearchPage,
})

function SearchPage() {
  const { q } = Route.useSearch()

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6">
      {q ? (
        // Keyed so a new query starts from its own first page.
        <SearchResults key={q} q={q} />
      ) : (
        <div className="py-16 text-center">
          <h1 className="text-xl font-semibold">Search videos</h1>
          <p className="mt-2 text-muted-foreground">Type in the search box to find videos.</p>
        </div>
      )}
    </main>
  )
}

function SearchResults({ q }: { q: string }) {
  const results = useSuspenseInfiniteQuery(searchQuery(q))
  const videos = results.data.pages.flatMap((page) => page.items)
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = results
  const loadMore = useCallback(() => void fetchNextPage(), [fetchNextPage])

  return (
    <>
      <h1 className="mb-4 text-lg font-semibold">
        Results for <q className="break-words">{q}</q>
      </h1>
      {videos.length === 0 ? (
        <div className="py-12 text-center">
          <p className="font-medium">No videos found.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Try different or fewer words. Search looks at video titles and descriptions.
          </p>
        </div>
      ) : (
        <VideoList
          videos={videos}
          hasMore={hasNextPage}
          loadingMore={isFetchingNextPage}
          onLoadMore={loadMore}
        />
      )}
    </>
  )
}
