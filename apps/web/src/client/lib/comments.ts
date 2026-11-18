import { infiniteQueryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import type { CreateCommentInput } from '@vidflare/shared'

import { api, unwrap } from './api'
import { videoQuery } from './videos'

// A video's comments, newest first, page by page (GET /api/videos/:id/comments?cursor=).
export const commentsQuery = (videoId: string) =>
  infiniteQueryOptions({
    queryKey: ['videos', videoId, 'comments'],
    queryFn: async ({ pageParam }) =>
      unwrap(
        await api.api.videos[':id'].comments.$get({
          param: { id: videoId },
          query: pageParam ? { cursor: pageParam } : {},
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  })

// After a comment is added or removed, the list and the video's comment count are stale.
function useInvalidateComments(videoId: string) {
  const queryClient = useQueryClient()
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: commentsQuery(videoId).queryKey }),
      queryClient.invalidateQueries({ queryKey: videoQuery(videoId).queryKey, exact: true }),
    ])
}

// POST /api/videos/:id/comments (with a Turnstile token)
export function useCreateComment(videoId: string) {
  const invalidate = useInvalidateComments(videoId)
  return useMutation({
    mutationFn: async (input: CreateCommentInput) =>
      unwrap(await api.api.videos[':id'].comments.$post({ param: { id: videoId }, json: input })),
    onSuccess: invalidate,
  })
}

// DELETE /api/comments/:id (author only, soft delete)
export function useDeleteComment(videoId: string) {
  const invalidate = useInvalidateComments(videoId)
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await api.api.comments[':id'].$delete({ param: { id } })
      if (!res.ok) await unwrap(res)
    },
    onSuccess: invalidate,
  })
}
