import { useMutation, useQueryClient } from '@tanstack/react-query'

import { api, unwrap } from './api'
import { videoQuery } from './videos'

// Like or unlike a video (PUT / DELETE /api/videos/:id/like). Optimistic: the watch page's
// cached video flips likedByMe and moves likeCount at once, rolls back if the request fails,
// and refetches the real numbers once it settles.
export function useToggleLike(id: string) {
  const queryClient = useQueryClient()
  const { queryKey } = videoQuery(id)

  return useMutation({
    mutationFn: async (liked: boolean) => {
      const req = { param: { id } }
      return unwrap(
        await (liked
          ? api.api.videos[':id'].like.$put(req)
          : api.api.videos[':id'].like.$delete(req)),
      )
    },
    onMutate: async (liked) => {
      // A refetch landing now would overwrite the optimistic value.
      await queryClient.cancelQueries({ queryKey, exact: true })
      const previous = queryClient.getQueryData(queryKey)
      queryClient.setQueryData(queryKey, (video) =>
        video && video.likedByMe !== liked
          ? {
              ...video,
              likedByMe: liked,
              likeCount: Math.max(0, video.likeCount + (liked ? 1 : -1)),
            }
          : video,
      )
      return { previous }
    },
    onError: (_err, _liked, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey, exact: true }),
  })
}
