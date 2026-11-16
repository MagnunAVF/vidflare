import { infiniteQueryOptions, queryOptions, useMutation } from '@tanstack/react-query'
import type { CreateUploadInput, VideoStatus } from '@vidflare/shared'

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
