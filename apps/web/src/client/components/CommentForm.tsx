import { zodResolver } from '@hookform/resolvers/zod'
import type { TurnstileInstance } from '@marsidev/react-turnstile'
import { COMMENT_MAX, createCommentInput } from '@vidflare/shared'
import { useRef } from 'react'
import { useForm } from 'react-hook-form'
import type { z } from 'zod'

import { TurnstileField } from '@/components/TurnstileField'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ApiRequestError } from '@/lib/api'
import { useCreateComment } from '@/lib/comments'

const errorMessages: Record<string, string> = {
  turnstile_failed: 'The challenge failed. Please try again.',
  rate_limited: 'You’re commenting too fast. Wait a minute and try again.',
  unauthorized: 'Your session ended. Sign in again to comment.',
  not_found: 'This video can’t take comments right now.',
}

// Add a comment. Validated with the API's own schema; the Turnstile token is sent along and
// replaced after every attempt, since tokens are single-use.
export function CommentForm({ videoId }: { videoId: string }) {
  const create = useCreateComment(videoId)
  const turnstile = useRef<TurnstileInstance>(undefined)
  const form = useForm<
    z.input<typeof createCommentInput>,
    unknown,
    z.output<typeof createCommentInput>
  >({
    resolver: zodResolver(createCommentInput),
    defaultValues: { body: '', turnstileToken: '' },
  })
  const setToken = (token: string) =>
    form.setValue('turnstileToken', token, { shouldValidate: form.formState.isSubmitted })
  const errors = form.formState.errors

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await create.mutateAsync(values)
      form.reset({ body: '', turnstileToken: '' })
    } catch (err) {
      const code = err instanceof ApiRequestError ? err.code : ''
      form.setError('root', {
        message: errorMessages[code] ?? 'Could not post your comment. Please try again.',
      })
    } finally {
      setToken('')
      turnstile.current?.reset()
    }
  })

  return (
    <form onSubmit={(event) => void onSubmit(event)} className="grid gap-3" noValidate>
      <Label htmlFor="comment-body" className="sr-only">
        Add a comment
      </Label>
      <Textarea
        id="comment-body"
        placeholder="Add a comment…"
        rows={3}
        maxLength={COMMENT_MAX}
        aria-invalid={Boolean(errors.body)}
        {...form.register('body')}
      />
      {errors.body && <p className="text-sm text-destructive">{errors.body.message}</p>}
      <TurnstileField ref={turnstile} onToken={setToken} error={errors.turnstileToken?.message} />
      {errors.root && (
        <p role="alert" className="text-sm text-destructive">
          {errors.root.message}
        </p>
      )}
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? 'Posting…' : 'Comment'}
        </Button>
      </div>
    </form>
  )
}
