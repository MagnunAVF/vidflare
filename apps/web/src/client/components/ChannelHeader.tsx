import type { ReactNode } from 'react'

import { ChannelAvatar } from '@/components/ChannelAvatar'
import { formatSubscribers } from '@/lib/format'

// The top of a channel page: avatar, name, handle and subscriber count, plus an action slot
// (the subscribe button).
export function ChannelHeader({
  channel,
  action,
}: {
  channel: { name: string; handle: string; avatarKey: string | null; subscriberCount: number }
  action?: ReactNode
}) {
  return (
    <header className="flex flex-wrap items-center gap-4 border-b pb-6">
      <ChannelAvatar channel={channel} className="size-16 text-2xl sm:size-20" />
      <div className="grid min-w-0 gap-0.5">
        <h1 className="truncate text-2xl font-semibold">{channel.name}</h1>
        <p className="text-sm text-muted-foreground">
          @{channel.handle} · {formatSubscribers(channel.subscriberCount)}
        </p>
      </div>
      {action && <div className="ml-auto">{action}</div>}
    </header>
  )
}
