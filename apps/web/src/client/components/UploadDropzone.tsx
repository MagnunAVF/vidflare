import { zodResolver } from '@hookform/resolvers/zod'
import type { TurnstileInstance } from '@marsidev/react-turnstile'
import { createUploadInput, UPLOAD_MAX_BYTES, VIDEO_TITLE_MAX } from '@vidflare/shared'
import { UploadIcon } from 'lucide-react'
import { useEffect, useRef, useState, type DragEvent, type FormEventHandler } from 'react'
import { useForm } from 'react-hook-form'
import type { z } from 'zod'

import { TurnstileField } from '@/components/TurnstileField'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Textarea } from '@/components/ui/textarea'
import { UploadStatus } from '@/components/UploadStatus'
import { ApiRequestError } from '@/lib/api'
import { uploadToStream, useCreateUpload, useMarkUploaded } from '@/lib/videos'

// The API's upload schema minus the size, which comes from the picked file.
const uploadForm = createUploadInput.omit({ sizeBytes: true })
type UploadFormInput = z.input<typeof uploadForm>
type UploadFormOutput = z.output<typeof uploadForm>

type Phase =
  | { name: 'editing' }
  | { name: 'uploading'; progress: number }
  | { name: 'finishing' }
  | { name: 'done'; videoId: string }

const errorMessages: Record<string, string> = {
  turnstile_failed: 'The challenge failed. Please try again.',
  unauthorized: 'Your session ended. Sign in again to upload.',
}

const formatBytes = (n: number) =>
  n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : `${(n / 1024 ** 2).toFixed(1)} MB`

// "my_clip.final.mp4" → "my_clip.final", within the title limit.
const titleFromFile = (file: File) => file.name.replace(/\.[^.]+$/, '').slice(0, VIDEO_TITLE_MAX)

// Pick a video, fill in the metadata, and upload it straight to Stream with tus. Our API only
// creates the upload (and the video row) and is told when the bytes are in.
export function UploadDropzone(props: { onUploaded?: (videoId: string) => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string>()
  const [phase, setPhase] = useState<Phase>({ name: 'editing' })
  const abort = useRef<AbortController | null>(null)
  const turnstile = useRef<TurnstileInstance>(undefined)
  const createUpload = useCreateUpload()
  const markUploaded = useMarkUploaded()

  const form = useForm<UploadFormInput, unknown, UploadFormOutput>({
    resolver: zodResolver(uploadForm),
    defaultValues: { title: '', description: '', visibility: 'public', turnstileToken: '' },
  })
  const setToken = (token: string) =>
    form.setValue('turnstileToken', token, { shouldValidate: form.formState.isSubmitted })

  // Leaving the page mid-upload would lose it: ask first.
  const busy = phase.name === 'uploading' || phase.name === 'finishing'
  useEffect(() => {
    if (!busy) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [busy])

  function pick(picked: File | undefined) {
    if (!picked) return
    if (!picked.type.startsWith('video/')) return setFileError('Choose a video file.')
    if (picked.size === 0) return setFileError('This file is empty.')
    if (picked.size > UPLOAD_MAX_BYTES)
      return setFileError(`Videos can be up to ${formatBytes(UPLOAD_MAX_BYTES)}.`)
    setFileError(undefined)
    setFile(picked)
    if (!form.getValues('title')) form.setValue('title', titleFromFile(picked))
  }

  const onDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault()
    pick(event.dataTransfer.files[0])
  }

  const onSubmit: FormEventHandler<HTMLFormElement> = (event) =>
    form.handleSubmit(async (values) => {
      if (!file) return setFileError('Choose a video to upload.')
      let created: { videoId: string; uploadUrl: string }
      try {
        created = await createUpload.mutateAsync({ ...values, sizeBytes: file.size })
      } catch (err) {
        const code = err instanceof ApiRequestError ? err.code : ''
        form.setError('root', {
          message: errorMessages[code] ?? 'Could not start the upload. Please try again.',
        })
        return
      } finally {
        // Turnstile tokens are single-use: get a fresh one for any next attempt.
        setToken('')
        turnstile.current?.reset()
      }

      abort.current = new AbortController()
      setPhase({ name: 'uploading', progress: 0 })
      try {
        await uploadToStream(file, created.uploadUrl, {
          signal: abort.current.signal,
          onProgress: (progress) => setPhase({ name: 'uploading', progress }),
        })
        setPhase({ name: 'finishing' })
        await markUploaded.mutateAsync(created.videoId)
        setPhase({ name: 'done', videoId: created.videoId })
        props.onUploaded?.(created.videoId)
      } catch (err) {
        setPhase({ name: 'editing' })
        const cancelled = err instanceof DOMException && err.name === 'AbortError'
        form.setError('root', {
          message: cancelled ? 'Upload cancelled.' : 'The upload failed. Please try again.',
        })
      }
    })(event)

  if (phase.name === 'done') {
    return (
      <UploadStatus
        videoId={phase.videoId}
        onUploadAnother={() => {
          setFile(null)
          form.reset()
          setPhase({ name: 'editing' })
        }}
      />
    )
  }

  if (busy) {
    const percent = phase.name === 'uploading' ? Math.round(phase.progress * 100) : 100
    return (
      <div className="grid gap-3" aria-live="polite">
        <p className="text-sm font-medium">{file?.name}</p>
        <Progress value={percent} aria-label="Upload progress" />
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{phase.name === 'uploading' ? `Uploading… ${percent}%` : 'Finishing…'}</span>
          {phase.name === 'uploading' && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => abort.current?.abort()}
            >
              Cancel
            </Button>
          )}
        </div>
      </div>
    )
  }

  const errors = form.formState.errors
  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      <label
        onDragOver={(event) => event.preventDefault()}
        onDrop={onDrop}
        className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed p-8 text-center has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
      >
        <UploadIcon aria-hidden className="size-8 text-muted-foreground" />
        {file ? (
          <span className="text-sm">
            {file.name} · {formatBytes(file.size)}
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">
            Drop a video here, or click to choose one
          </span>
        )}
        <input
          type="file"
          accept="video/*"
          className="sr-only"
          onChange={(event) => pick(event.target.files?.[0])}
        />
      </label>
      {fileError && (
        <p role="alert" className="text-sm text-destructive">
          {fileError}
        </p>
      )}

      <div className="grid gap-2">
        <Label htmlFor="upload-title">Title</Label>
        <Input id="upload-title" aria-invalid={Boolean(errors.title)} {...form.register('title')} />
        {errors.title && <p className="text-sm text-destructive">{errors.title.message}</p>}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="upload-description">Description</Label>
        <Textarea
          id="upload-description"
          rows={4}
          aria-invalid={Boolean(errors.description)}
          {...form.register('description')}
        />
        {errors.description && (
          <p className="text-sm text-destructive">{errors.description.message}</p>
        )}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="upload-visibility">Visibility</Label>
        <select
          id="upload-visibility"
          className="h-9 rounded-md border bg-transparent px-3 text-sm"
          {...form.register('visibility')}
        >
          <option value="public">Public: listed on the home page and your channel</option>
          <option value="unlisted">Unlisted: only people with the link</option>
        </select>
      </div>

      <TurnstileField ref={turnstile} onToken={setToken} error={errors.turnstileToken?.message} />

      {errors.root && (
        <p role="alert" className="text-sm text-destructive">
          {errors.root.message}
        </p>
      )}
      <Button type="submit" disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting ? 'Starting…' : 'Upload'}
      </Button>
    </form>
  )
}
