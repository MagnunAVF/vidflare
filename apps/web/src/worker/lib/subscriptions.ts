import { sql } from 'drizzle-orm'

import { channels, subscriptions } from '../db/schema'

// SELECT expression: 1 when this user subscribes to the row's channel (`channels` must be in
// the query), else 0; always 0 when signed out. Served by the subscriptions primary key.
export const subscribedBy = (userId: string | undefined) =>
  userId
    ? sql<number>`exists(select 1 from ${subscriptions} where ${subscriptions.subscriberId} = ${userId} and ${subscriptions.channelId} = ${channels.id})`
    : sql<number>`0`
