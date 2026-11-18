import { type QueryClient, useMutation, useQueryClient } from '@tanstack/react-query'
import type { MeResponse, UpdateProfileInput } from '@vidflare/shared'

import { api, unwrap } from './api'
import { meQuery } from './auth'

// The image URL for a channel's avatarKey (served by GET /api/media/avatars/...). A plain URL
// for <img src>, not an API call.
export const avatarUrl = (avatarKey: string) => `/api/media/${avatarKey}`

// The signed-in user changed; anything showing their channel's name, handle or avatar
// (channel pages, watch pages, feeds, comments) refetches next time it's shown.
async function applyMe(queryClient: QueryClient, me: MeResponse) {
  queryClient.setQueryData(meQuery.queryKey, me)
  await Promise.all(
    [['channels'], ['videos'], ['feed']].map((queryKey) =>
      queryClient.invalidateQueries({ queryKey }),
    ),
  )
}

// PATCH /api/me (name and/or handle)
export function useUpdateProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (changes: UpdateProfileInput) =>
      unwrap(await api.api.me.$patch({ json: changes })),
    onSuccess: (me) => applyMe(queryClient, me),
  })
}

// POST /api/me/avatar (multipart)
export function useUploadAvatar() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (file: File) => unwrap(await api.api.me.avatar.$post({ form: { file } })),
    onSuccess: (me) => applyMe(queryClient, me),
  })
}

// DELETE /api/me/avatar
export function useRemoveAvatar() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => unwrap(await api.api.me.avatar.$delete()),
    onSuccess: (me) => applyMe(queryClient, me),
  })
}
