import { Link } from '@tanstack/react-router'
import { ThumbsUpIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useToggleLike } from '@/lib/likes'
import { cn } from '@/lib/utils'

const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })

// Like toggle for the watch page. The count and state come from the cached video and update
// optimistically; signed-out viewers get a link to sign in instead.
export function LikeButton({
  videoId,
  liked,
  count,
  signedIn,
}: {
  videoId: string
  liked: boolean
  count: number
  signedIn: boolean
}) {
  const toggle = useToggleLike(videoId)
  const content = (
    <>
      <ThumbsUpIcon className={cn(liked && 'fill-current')} aria-hidden />
      <span>{compact.format(count)}</span>
    </>
  )

  if (!signedIn) {
    return (
      <Button asChild variant="outline" size="sm" title="Sign in to like this video">
        <Link to="/login">{content}</Link>
      </Button>
    )
  }

  return (
    <Button
      variant={liked ? 'secondary' : 'outline'}
      size="sm"
      aria-pressed={liked}
      aria-label={liked ? 'Unlike' : 'Like'}
      // One request at a time keeps the optimistic state and its rollback in step.
      disabled={toggle.isPending}
      onClick={() => toggle.mutate(!liked)}
    >
      {content}
    </Button>
  )
}
