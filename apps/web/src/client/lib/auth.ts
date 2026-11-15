import * as Sentry from '@sentry/react'
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import type { LoginInput, MeResponse, SignupInput } from '@vidflare/shared'

import { api, unwrap } from './api'

// Sentry knows the signed-in user by id only, never email.
const identify = (me: MeResponse | null) => Sentry.setUser(me ? { id: me.user.id } : null)

// The signed-in user, or null when signed out. Shared by the header and route guards.
// Also identifies the user to Sentry on every (re)load, e.g. after a page refresh.
export const meQuery = queryOptions({
  queryKey: ['me'],
  queryFn: async () => {
    const res = await api.api.me.$get()
    const me = (res.status as number) === 401 ? null : await unwrap(res)
    identify(me)
    return me
  },
  staleTime: 60_000,
})

export function useLogin() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: LoginInput) =>
      unwrap(await api.api.auth.login.$post({ json: input })),
    onSuccess: (me) => {
      identify(me)
      queryClient.setQueryData(meQuery.queryKey, me)
    },
  })
}

export function useSignup() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: SignupInput) =>
      unwrap(await api.api.auth.signup.$post({ json: input })),
    onSuccess: (me) => {
      identify(me)
      queryClient.setQueryData(meQuery.queryKey, me)
    },
  })
}

export function useLogout() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      await api.api.auth.logout.$post()
    },
    // Signed out locally even if the request failed; the cookie is cleared or stale anyway.
    onSettled: () => {
      identify(null)
      queryClient.setQueryData(meQuery.queryKey, null)
    },
  })
}
