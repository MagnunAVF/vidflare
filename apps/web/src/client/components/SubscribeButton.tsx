import { Link } from '@tanstack/react-router'

import { Button } from '@/components/ui/button'
import { useToggleSubscribe } from '@/lib/subscriptions'

// Subscribe toggle for channel and watch pages. State and count come from the cached page
// data and update optimistically. Hidden on one's own channel; signed-out viewers get a link
// to sign in instead.
export function SubscribeButton({
  channelId,
  subscribed,
  signedIn,
  isOwner,
}: {
  channelId: string
  subscribed: boolean
  signedIn: boolean
  isOwner: boolean
}) {
  const toggle = useToggleSubscribe(channelId)
  if (isOwner) return null

  if (!signedIn) {
    return (
      <Button asChild size="sm" title="Sign in to subscribe">
        <Link to="/login">Subscribe</Link>
      </Button>
    )
  }

  return (
    <Button
      size="sm"
      variant={subscribed ? 'secondary' : 'default'}
      aria-pressed={subscribed}
      // One request at a time keeps the optimistic state and its rollback in step.
      disabled={toggle.isPending}
      onClick={() => toggle.mutate(!subscribed)}
    >
      {subscribed ? 'Subscribed' : 'Subscribe'}
    </Button>
  )
}
