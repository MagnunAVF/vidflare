import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import type { LoginInput, SignupInput } from '@vidflare/shared'

import { api, unwrap } from './api'

// The signed-in user, or null when signed out. Shared by the header and route guards.
export const meQuery = queryOptions({
  queryKey: ['me'],
  queryFn: async () => {
    const res = await api.api.me.$get()
    if ((res.status as number) === 401) return null
    return unwrap(res)
  },
  staleTime: 60_000,
})

export function useLogin() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: LoginInput) =>
      unwrap(await api.api.auth.login.$post({ json: input })),
    onSuccess: (me) => queryClient.setQueryData(meQuery.queryKey, me),
  })
}

export function useSignup() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: SignupInput) =>
      unwrap(await api.api.auth.signup.$post({ json: input })),
    onSuccess: (me) => queryClient.setQueryData(meQuery.queryKey, me),
  })
}

export function useLogout() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      await api.api.auth.logout.$post()
    },
    // Signed out locally even if the request failed; the cookie is cleared or stale anyway.
    onSettled: () => queryClient.setQueryData(meQuery.queryKey, null),
  })
}
