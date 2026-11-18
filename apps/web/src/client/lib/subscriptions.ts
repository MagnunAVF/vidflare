import {
  infiniteQueryOptions,
  type Query,
  type QueryKey,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query'

import { api, unwrap } from './api'

interface ChannelState {
  id: string
  subscribedByMe: boolean
  subscriberCount: number
}

const isChannelState = (value: unknown): value is ChannelState =>
  typeof value === 'object' &&
  value !== null &&
  'id' in value &&
  'subscribedByMe' in value &&
  'subscriberCount' in value

// Cached data that shows a channel's subscribe state: channel pages (['channels', handle]) and
// watch pages (['videos', id], whose `channel` carries it). Lists and feeds don't.
const showsSubscribeState = (query: Query) =>
  query.queryKey.length === 2 &&
  (query.queryKey[0] === 'channels' || query.queryKey[0] === 'videos')

// The subscriptions feed (GET /api/feed/subscriptions?cursor=), page by page.
export const SUBSCRIPTIONS_FEED_KEY = ['feed', 'subscriptions'] as const
export const subscriptionsFeedQuery = infiniteQueryOptions({
  queryKey: SUBSCRIPTIONS_FEED_KEY,
  queryFn: async ({ pageParam }) =>
    unwrap(
      await api.api.feed.subscriptions.$get({ query: pageParam ? { cursor: pageParam } : {} }),
    ),
  initialPageParam: undefined as string | undefined,
  getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  staleTime: 60_000,
})

// Subscribe or unsubscribe (PUT / DELETE /api/channels/:id/subscribe). Optimistic: every
// cached channel page and watch page for this channel flips at once, rolls back if the
// request fails, and refetches once it settles (along with the subscriptions feed).
export function useToggleSubscribe(channelId: string) {
  const queryClient = useQueryClient()

  const patch = (channel: ChannelState, subscribed: boolean): ChannelState =>
    channel.id !== channelId || channel.subscribedByMe === subscribed
      ? channel
      : {
          ...channel,
          subscribedByMe: subscribed,
          subscriberCount: Math.max(0, channel.subscriberCount + (subscribed ? 1 : -1)),
        }

  const apply = (data: unknown, subscribed: boolean): unknown => {
    if (isChannelState(data)) return patch(data, subscribed)
    if (
      typeof data === 'object' &&
      data !== null &&
      'channel' in data &&
      isChannelState(data.channel)
    ) {
      const channel = patch(data.channel, subscribed)
      return channel === data.channel ? data : { ...data, channel }
    }
    return data
  }

  return useMutation({
    mutationFn: async (subscribed: boolean) => {
      const req = { param: { id: channelId } }
      return unwrap(
        await (subscribed
          ? api.api.channels[':id'].subscribe.$put(req)
          : api.api.channels[':id'].subscribe.$delete(req)),
      )
    },
    onMutate: async (subscribed) => {
      await queryClient.cancelQueries({ predicate: showsSubscribeState })
      const previous: [QueryKey, unknown][] = queryClient.getQueriesData({
        predicate: showsSubscribeState,
      })
      queryClient.setQueriesData({ predicate: showsSubscribeState }, (data: unknown) =>
        apply(data, subscribed),
      )
      return { previous }
    },
    onError: (_err, _subscribed, context) => {
      for (const [key, data] of context?.previous ?? []) queryClient.setQueryData(key, data)
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ predicate: showsSubscribeState }),
        queryClient.invalidateQueries({ queryKey: SUBSCRIPTIONS_FEED_KEY }),
      ]),
  })
}
