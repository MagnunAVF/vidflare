import { useSuspenseInfiniteQuery } from '@tanstack/react-query'
import { createFileRoute, Link, redirect } from '@tanstack/react-router'

import { RecheckButton } from '@/components/RecheckButton'
import { StudioTable } from '@/components/StudioTable'
import { Button } from '@/components/ui/button'
import { meQuery } from '@/lib/auth'
import { studioVideosQuery } from '@/lib/videos'

export const Route = createFileRoute('/studio')({
  // The studio is the signed-in creator's own space.
  beforeLoad: async ({ context }) => {
    if (!(await context.queryClient.ensureQueryData(meQuery))) throw redirect({ to: '/login' })
  },
  loader: ({ context }) => context.queryClient.ensureInfiniteQueryData(studioVideosQuery),
  component: StudioPage,
})

function StudioPage() {
  const studio = useSuspenseInfiniteQuery(studioVideosQuery)
  const videos = studio.data.pages.flatMap((page) => page.items)

  return (
    <main className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">Your videos</h1>
        <Button asChild>
          <Link to="/upload">Upload</Link>
        </Button>
      </div>

      {videos.length === 0 ? (
        <p className="py-16 text-center text-muted-foreground">
          You haven’t uploaded anything yet.
        </p>
      ) : (
        <>
          <StudioTable
            videos={videos}
            extraActions={(video) =>
              video.status === 'uploading' || video.status === 'processing' ? (
                <RecheckButton id={video.id} status={video.status} />
              ) : null
            }
          />
          {studio.hasNextPage && (
            <Button
              variant="outline"
              className="justify-self-center"
              disabled={studio.isFetchingNextPage}
              onClick={() => void studio.fetchNextPage()}
            >
              {studio.isFetchingNextPage ? 'Loading…' : 'Load more'}
            </Button>
          )}
        </>
      )}
    </main>
  )
}
