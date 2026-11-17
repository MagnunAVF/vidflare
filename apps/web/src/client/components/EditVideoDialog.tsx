import { zodResolver } from '@hookform/resolvers/zod'
import { videoMetadataInput, type VideoVisibility } from '@vidflare/shared'
import { useState, type FormEventHandler } from 'react'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useUpdateVideo } from '@/lib/videos'

type FormInput = z.input<typeof videoMetadataInput>
type FormOutput = z.output<typeof videoMetadataInput>

// Edit a video's title, description and visibility (the same shared schema the API checks).
export function EditVideoDialog(props: {
  video: { id: string; title: string; description: string; visibility: VideoVisibility }
}) {
  const [open, setOpen] = useState(false)
  const update = useUpdateVideo()
  const form = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(videoMetadataInput),
    values: {
      title: props.video.title,
      description: props.video.description,
      visibility: props.video.visibility,
    },
  })

  const onSubmit: FormEventHandler<HTMLFormElement> = (event) =>
    form.handleSubmit(async (changes) => {
      try {
        await update.mutateAsync({ id: props.video.id, changes })
        setOpen(false)
      } catch {
        form.setError('root', { message: 'Could not save. Please try again.' })
      }
    })(event)

  const errors = form.formState.errors
  const id = (field: string) => `edit-${props.video.id}-${field}`
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) form.reset()
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={onSubmit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Edit video</DialogTitle>
            <DialogDescription>Changes show up on the watch page right away.</DialogDescription>
          </DialogHeader>

          <div className="grid gap-2">
            <Label htmlFor={id('title')}>Title</Label>
            <Input
              id={id('title')}
              aria-invalid={Boolean(errors.title)}
              {...form.register('title')}
            />
            {errors.title && <p className="text-sm text-destructive">{errors.title.message}</p>}
          </div>
          <div className="grid gap-2">
            <Label htmlFor={id('description')}>Description</Label>
            <Textarea
              id={id('description')}
              rows={4}
              aria-invalid={Boolean(errors.description)}
              {...form.register('description')}
            />
            {errors.description && (
              <p className="text-sm text-destructive">{errors.description.message}</p>
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor={id('visibility')}>Visibility</Label>
            <select
              id={id('visibility')}
              className="h-9 rounded-md border bg-transparent px-3 text-sm"
              {...form.register('visibility')}
            >
              <option value="public">Public</option>
              <option value="unlisted">Unlisted</option>
            </select>
          </div>

          {errors.root && (
            <p role="alert" className="text-sm text-destructive">
              {errors.root.message}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
