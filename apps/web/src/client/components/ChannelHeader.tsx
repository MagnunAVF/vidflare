import type { ReactNode } from 'react'

import { formatSubscribers } from '@/lib/format'

// The top of a channel page: avatar, name, handle and subscriber count, plus an action slot
// (the subscribe button). Avatars are uploaded in a later phase; until then it shows the
// channel's initial.
export function ChannelHeader({
  channel,
  action,
}: {
  channel: { name: string; handle: string; subscriberCount: number }
  action?: ReactNode
}) {
  return (
    <header className="flex flex-wrap items-center gap-4 border-b pb-6">
      <div
        aria-hidden
        className="flex size-16 shrink-0 items-center justify-center rounded-full bg-muted text-2xl font-semibold text-muted-foreground uppercase sm:size-20"
      >
        {channel.name.trim().charAt(0) || '?'}
      </div>
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
