import { infiniteQueryOptions } from '@tanstack/react-query'

import { api, unwrap } from './api'

// Search results for q, page by page (GET /api/search?q=&cursor=). q is already trimmed by the
// page's search params.
export const searchQuery = (q: string) =>
  infiniteQueryOptions({
    queryKey: ['search', q],
    queryFn: async ({ pageParam }) =>
      unwrap(
        await api.api.search.$get({
          query: pageParam ? { q, cursor: pageParam } : { q },
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 60_000,
  })
