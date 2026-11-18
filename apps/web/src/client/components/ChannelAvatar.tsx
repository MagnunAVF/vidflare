import { avatarUrl } from '@/lib/profile'
import { cn } from '@/lib/utils'

// A channel's avatar image, or its initial when it has none. Decorative: the channel's name is
// always shown next to it, so it is hidden from assistive tech.
export function ChannelAvatar({
  channel,
  className,
}: {
  channel: { name: string; avatarKey: string | null }
  className?: string
}) {
  const base = cn('size-8 shrink-0 rounded-full bg-muted', className)
  if (channel.avatarKey) {
    return <img src={avatarUrl(channel.avatarKey)} alt="" className={cn(base, 'object-cover')} />
  }
  return (
    <div
      aria-hidden
      className={cn(
        base,
        'flex items-center justify-center font-semibold text-muted-foreground uppercase',
      )}
    >
      {channel.name.trim().charAt(0) || '?'}
    </div>
  )
}
