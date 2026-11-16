import {
  infiniteQueryOptions,
  queryOptions,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'
import type { CreateUploadInput, UpdateVideoInput, VideoStatus } from '@vidflare/shared'

import { api, unwrap } from './api'

// Creates the video row and a one-time Stream upload URL (POST /api/videos/uploads).
export function useCreateUpload() {
  return useMutation({
    mutationFn: async (input: CreateUploadInput) =>
      unwrap(await api.api.videos.uploads.$post({ json: input })),
  })
}

// Tells the API the bytes are in Stream: uploading → processing.
export function useMarkUploaded() {
  return useMutation({
    mutationFn: async (id: string) =>
      unwrap(await api.api.videos[':id'].uploaded.$post({ param: { id } })),
  })
}

// The home feed, page by page (GET /api/videos?cursor=). Each page carries the next cursor.
export const homeFeedQuery = infiniteQueryOptions({
  queryKey: ['videos', 'feed', 'home'],
  queryFn: async ({ pageParam }) =>
    unwrap(await api.api.videos.$get({ query: pageParam ? { cursor: pageParam } : {} })),
  initialPageParam: undefined as string | undefined,
  getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  staleTime: 60_000,
})

// The watch page's data (GET /api/videos/:id). Throws ApiRequestError (404) for a video that
// doesn't exist or isn't visible to this user.
export const videoQuery = (id: string) =>
  queryOptions({
    queryKey: ['videos', id],
    queryFn: async () => unwrap(await api.api.videos[':id'].$get({ param: { id } })),
    staleTime: 60_000,
  })

const POLL_INTERVAL_MS = 5000
const isFinal = (status: VideoStatus | undefined) => status === 'ready' || status === 'error'

// An uploaded video's status, refetched every few seconds until Stream is done with it
// (`ready` or `error`, set by the webhook's queue consumer).
export const videoStatusQuery = (id: string) =>
  queryOptions({
    queryKey: ['videos', id, 'status'],
    queryFn: async () => unwrap(await api.api.videos[':id'].status.$get({ param: { id } })),
    refetchInterval: (query) => (isFinal(query.state.data?.status) ? false : POLL_INTERVAL_MS),
    // Keep polling when the user switches tabs; uploads often run in the background.
    refetchIntervalInBackground: true,
  })

// The creator's own videos, every status (GET /api/studio/videos), page by page.
export const studioVideosQuery = infiniteQueryOptions({
  queryKey: ['studio', 'videos'],
  queryFn: async ({ pageParam }) =>
    unwrap(await api.api.studio.videos.$get({ query: pageParam ? { cursor: pageParam } : {} })),
  initialPageParam: undefined as string | undefined,
  getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
})

// After an edit or delete, the studio list, the video's page and the home feed may all be
// stale (title, visibility, or the video itself).
function useInvalidateVideo() {
  const queryClient = useQueryClient()
  return (id: string) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: studioVideosQuery.queryKey }),
      queryClient.invalidateQueries({ queryKey: ['videos', id] }),
      queryClient.invalidateQueries({ queryKey: homeFeedQuery.queryKey }),
    ])
}

// PATCH /api/videos/:id
export function useUpdateVideo() {
  const invalidate = useInvalidateVideo()
  return useMutation({
    mutationFn: async ({ id, changes }: { id: string; changes: UpdateVideoInput }) =>
      unwrap(await api.api.videos[':id'].$patch({ param: { id }, json: changes })),
    onSuccess: (_data, { id }) => invalidate(id),
  })
}

// DELETE /api/videos/:id (Stream and D1)
export function useDeleteVideo() {
  const invalidate = useInvalidateVideo()
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await api.api.videos[':id'].$delete({ param: { id } })
      if (!res.ok) await unwrap(res)
    },
    onSuccess: (_data, id) => invalidate(id),
  })
}

// Asks the API to re-check a stuck video against Stream (POST /api/studio/videos/:id/recheck).
export function useRecheckVideo() {
  const invalidate = useInvalidateVideo()
  return useMutation({
    mutationFn: async (id: string) =>
      unwrap(await api.api.studio.videos[':id'].recheck.$post({ param: { id } })),
    onSuccess: (_data, id) => invalidate(id),
  })
}
