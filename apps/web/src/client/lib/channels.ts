import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query'

import { api, unwrap } from './api'

// A channel page's header data (GET /api/channels/:handle). Throws ApiRequestError (404) for
// an unknown handle.
export const channelQuery = (handle: string) =>
  queryOptions({
    queryKey: ['channels', handle.toLowerCase()],
    queryFn: async () => unwrap(await api.api.channels[':handle'].$get({ param: { handle } })),
    staleTime: 60_000,
  })

// The channel's public videos, page by page (GET /api/channels/:handle/videos?cursor=).
export const channelVideosQuery = (handle: string) =>
  infiniteQueryOptions({
    queryKey: ['channels', handle.toLowerCase(), 'videos'],
    queryFn: async ({ pageParam }) =>
      unwrap(
        await api.api.channels[':handle'].videos.$get({
          param: { handle },
          query: pageParam ? { cursor: pageParam } : {},
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 60_000,
  })
