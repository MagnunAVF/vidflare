import { zodResolver } from '@hookform/resolvers/zod'
import { Link } from '@tanstack/react-router'
import {
  createReportInput,
  REPORT_DETAILS_MAX,
  REPORT_REASONS,
  type ReportReason,
} from '@vidflare/shared'
import { FlagIcon } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import type { z } from 'zod'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ApiRequestError } from '@/lib/api'
import { useReportVideo } from '@/lib/reports'

const reasonLabels: Record<ReportReason, string> = {
  copyright: 'Copyright infringement',
  sexual: 'Sexual content',
  violence: 'Violent or graphic content',
  harassment: 'Harassment or hate',
  illegal: 'Illegal content',
  spam: 'Spam or scam',
  other: 'Something else',
}

const errorMessages: Record<string, string> = {
  unauthorized: 'Your session ended. Sign in again to report.',
  not_found: 'This video is no longer available.',
}

// Report a video for review by a person (docs/Moderation.md). Signed-out viewers are sent to
// sign in; the watch page hides it on one's own videos.
export function ReportButton({ videoId, signedIn }: { videoId: string; signedIn: boolean }) {
  const [open, setOpen] = useState(false)
  const [sent, setSent] = useState(false)
  const reportVideo = useReportVideo(videoId)
  const form = useForm<
    z.input<typeof createReportInput>,
    unknown,
    z.output<typeof createReportInput>
  >({
    resolver: zodResolver(createReportInput),
    defaultValues: { details: '' },
  })
  const errors = form.formState.errors

  if (!signedIn) {
    return (
      <Button asChild variant="ghost" size="sm">
        <Link to="/login">
          <FlagIcon aria-hidden />
          Report
        </Link>
      </Button>
    )
  }

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await reportVideo.mutateAsync(values)
      setSent(true)
    } catch (err) {
      const code = err instanceof ApiRequestError ? err.code : ''
      form.setError('root', {
        message: errorMessages[code] ?? 'Could not send your report. Please try again.',
      })
    }
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        // Start fresh next time, unless this viewer already sent one.
        if (!next && !sent) form.reset({ details: '' })
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <FlagIcon aria-hidden />
          Report
        </Button>
      </DialogTrigger>
      <DialogContent>
        {sent ? (
          <>
            <DialogHeader>
              <DialogTitle>Thanks for your report</DialogTitle>
              <DialogDescription>
                A person will review this video and take it down if it breaks the rules.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button onClick={() => setOpen(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={onSubmit} noValidate className="grid gap-4">
            <DialogHeader>
              <DialogTitle>Report video</DialogTitle>
              <DialogDescription>
                What’s wrong with this video? Reports are reviewed by a person.
              </DialogDescription>
            </DialogHeader>

            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">Reason</legend>
              {REPORT_REASONS.map((reason) => (
                <label key={reason} className="flex items-center gap-2 text-sm">
                  <input type="radio" value={reason} {...form.register('reason')} />
                  {reasonLabels[reason]}
                </label>
              ))}
              {errors.reason && <p className="text-sm text-destructive">Choose a reason.</p>}
            </fieldset>

            <div className="grid gap-2">
              <Label htmlFor="report-details">Details (optional)</Label>
              <Textarea
                id="report-details"
                rows={3}
                maxLength={REPORT_DETAILS_MAX}
                placeholder="For copyright, say who owns the work and where it appears."
                aria-invalid={Boolean(errors.details)}
                {...form.register('details')}
              />
              {errors.details && (
                <p className="text-sm text-destructive">{errors.details.message}</p>
              )}
            </div>

            {errors.root && (
              <p role="alert" className="text-sm text-destructive">
                {errors.root.message}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? 'Sending…' : 'Send report'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
