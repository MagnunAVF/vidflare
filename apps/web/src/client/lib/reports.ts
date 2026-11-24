import { useMutation } from '@tanstack/react-query'
import type { CreateReportInput } from '@vidflare/shared'

import { api, unwrap } from './api'

// Reports a video for review (POST /api/videos/:id/report). Repeats are no-ops on the API.
export function useReportVideo(videoId: string) {
  return useMutation({
    mutationFn: async (input: CreateReportInput) =>
      unwrap(await api.api.videos[':id'].report.$post({ param: { id: videoId }, json: input })),
  })
}
