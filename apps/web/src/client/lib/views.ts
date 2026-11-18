import { useMutation, useQueryClient } from '@tanstack/react-query'

import { api, unwrap } from './api'
import { videoQuery } from './videos'

// Records a view (POST /api/videos/:id/view). The response carries the live total from the
// video's VideoStats object, which can be ahead of D1 until the next flush, so the watch
// page shows it right away (never lower than what it already shows).
export function useRecordView(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => unwrap(await api.api.videos[':id'].view.$post({ param: { id } })),
    onSuccess: ({ viewCount }) =>
      queryClient.setQueryData(videoQuery(id).queryKey, (video) =>
        video ? { ...video, viewCount: Math.max(video.viewCount, viewCount) } : video,
      ),
  })
}
