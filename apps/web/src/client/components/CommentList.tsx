import { useInfiniteQuery } from '@tanstack/react-query'
import type { CommentItem } from '@vidflare/shared'
import { useState } from 'react'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { commentsQuery, useDeleteComment } from '@/lib/comments'
import { formatRelativeTime } from '@/lib/format'

// A video's comments, newest first, with a button to load older ones. The author of a
// comment can delete it.
export function CommentList({ videoId }: { videoId: string }) {
  const query = useInfiniteQuery(commentsQuery(videoId))

  if (query.isPending) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Loading comments…
      </p>
    )
  }
  if (query.isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        Could not load comments.
      </p>
    )
  }

  const items = query.data.pages.flatMap((page) => page.items)
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">No comments yet.</p>
  }

  return (
    <div className="grid gap-4">
      <ul className="grid gap-4">
        {items.map((comment) => (
          <CommentRow key={comment.id} videoId={videoId} comment={comment} />
        ))}
      </ul>
      {query.hasNextPage && (
        <Button
          variant="ghost"
          size="sm"
          className="justify-self-start"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {query.isFetchingNextPage ? 'Loading…' : 'Show more comments'}
        </Button>
      )}
    </div>
  )
}

function CommentRow({ videoId, comment }: { videoId: string; comment: CommentItem }) {
  return (
    <li className="grid gap-1">
      <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
        <span className="font-medium">{comment.author.name}</span>
        <span className="text-muted-foreground">@{comment.author.handle}</span>
        <time
          className="text-xs text-muted-foreground"
          dateTime={new Date(comment.createdAt).toISOString()}
        >
          {formatRelativeTime(comment.createdAt)}
        </time>
        {comment.isMine && <DeleteCommentButton videoId={videoId} id={comment.id} />}
      </div>
      <p className="whitespace-pre-wrap break-words text-sm">{comment.body}</p>
    </li>
  )
}

function DeleteCommentButton({ videoId, id }: { videoId: string; id: string }) {
  const remove = useDeleteComment(videoId)
  const [error, setError] = useState<string>()
  return (
    <AlertDialog onOpenChange={() => setError(undefined)}>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="sm" className="ml-auto h-auto px-2 py-0.5 text-xs">
          Delete
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this comment?</AlertDialogTitle>
          <AlertDialogDescription>It will be removed from this video.</AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={remove.isPending}
            onClick={async (event) => {
              // Keep the dialog open until the delete finishes (or fails).
              event.preventDefault()
              try {
                await remove.mutateAsync(id)
              } catch {
                setError('Could not delete the comment. Please try again.')
              }
            }}
          >
            {remove.isPending ? 'Deleting…' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
