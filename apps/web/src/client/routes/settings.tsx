import { zodResolver } from '@hookform/resolvers/zod'
import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { AVATAR_TYPES, avatarUploadInput, type MeResponse, profileInput } from '@vidflare/shared'
import { useRef, useState, type ChangeEvent } from 'react'
import { useForm } from 'react-hook-form'
import type { z } from 'zod'

import { ChannelAvatar } from '@/components/ChannelAvatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ApiRequestError } from '@/lib/api'
import { meQuery } from '@/lib/auth'
import { useRemoveAvatar, useUpdateProfile, useUploadAvatar } from '@/lib/profile'

export const Route = createFileRoute('/settings')({
  // Signed-in only.
  beforeLoad: async ({ context }) => {
    if (!(await context.queryClient.ensureQueryData(meQuery))) throw redirect({ to: '/login' })
  },
  component: SettingsPage,
})

function SettingsPage() {
  const { data: me } = useSuspenseQuery(meQuery)
  // beforeLoad guarantees a user; this only narrows the type (and covers signing out here).
  if (!me) return null

  return (
    <main className="mx-auto grid w-full max-w-xl gap-8 px-4 py-6">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-xl font-semibold">Settings</h1>
        <Link
          to="/c/$handle"
          params={{ handle: me.channel.handle }}
          className="text-sm text-muted-foreground hover:underline"
        >
          View your channel
        </Link>
      </div>
      <AvatarSection channel={me.channel} />
      <ProfileForm channel={me.channel} />
    </main>
  )
}

const avatarErrors: Record<string, string> = {
  unsupported_image: 'That file isn’t a PNG, JPEG or WebP image.',
  unauthorized: 'Your session ended. Sign in again.',
}

function AvatarSection({ channel }: { channel: MeResponse['channel'] }) {
  const upload = useUploadAvatar()
  const remove = useRemoveAvatar()
  const input = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string>()
  const busy = upload.isPending || remove.isPending

  async function onPick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // Allow picking the same file again after an error.
    event.target.value = ''
    if (!file) return
    // Same schema as the API, for an immediate message.
    const checked = avatarUploadInput.safeParse({ file })
    if (!checked.success) return setError(checked.error.issues[0]?.message)
    setError(undefined)
    try {
      await upload.mutateAsync(file)
    } catch (err) {
      const code = err instanceof ApiRequestError ? err.code : ''
      setError(avatarErrors[code] ?? 'Could not upload the image. Please try again.')
    }
  }

  async function onRemove() {
    setError(undefined)
    try {
      await remove.mutateAsync()
    } catch {
      setError('Could not remove the image. Please try again.')
    }
  }

  return (
    <section aria-labelledby="avatar-heading" className="grid gap-3">
      <h2 id="avatar-heading" className="font-medium">
        Avatar
      </h2>
      <div className="flex flex-wrap items-center gap-4">
        <ChannelAvatar channel={channel} className="size-20 text-2xl" />
        <div className="flex flex-wrap gap-2">
          <input
            ref={input}
            type="file"
            accept={AVATAR_TYPES.join(',')}
            className="sr-only"
            id="avatar-file"
            aria-label="Choose an avatar image"
            onChange={(event) => void onPick(event)}
          />
          <Button size="sm" disabled={busy} onClick={() => input.current?.click()}>
            {upload.isPending ? 'Uploading…' : channel.avatarKey ? 'Change image' : 'Upload image'}
          </Button>
          {channel.avatarKey && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void onRemove()}>
              {remove.isPending ? 'Removing…' : 'Remove'}
            </Button>
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">PNG, JPEG or WebP, up to 2 MB.</p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  )
}

function ProfileForm({ channel }: { channel: MeResponse['channel'] }) {
  const update = useUpdateProfile()
  const [saved, setSaved] = useState(false)
  const form = useForm<z.input<typeof profileInput>, unknown, z.output<typeof profileInput>>({
    resolver: zodResolver(profileInput),
    defaultValues: { name: channel.name, handle: channel.handle },
  })
  const errors = form.formState.errors

  const onSubmit = form.handleSubmit(async (values) => {
    setSaved(false)
    try {
      const me = await update.mutateAsync(values)
      // Show what was stored (trimmed, lowercased handle) and make it the new baseline.
      form.reset({ name: me.channel.name, handle: me.channel.handle })
      setSaved(true)
    } catch (err) {
      const code = err instanceof ApiRequestError ? err.code : ''
      if (code === 'handle_taken') {
        form.setError('handle', { message: 'That handle is taken.' })
      } else {
        form.setError('root', { message: 'Could not save your changes. Please try again.' })
      }
    }
  })

  return (
    <section aria-labelledby="profile-heading" className="grid gap-3">
      <h2 id="profile-heading" className="font-medium">
        Channel
      </h2>
      <form onSubmit={(event) => void onSubmit(event)} className="grid gap-4" noValidate>
        <div className="grid gap-2">
          <Label htmlFor="settings-name">Channel name</Label>
          <Input
            id="settings-name"
            aria-invalid={Boolean(errors.name)}
            {...form.register('name', { onChange: () => setSaved(false) })}
          />
          {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
        </div>
        <div className="grid gap-2">
          <Label htmlFor="settings-handle">Handle</Label>
          <Input
            id="settings-handle"
            autoComplete="username"
            aria-invalid={Boolean(errors.handle)}
            aria-describedby="settings-handle-hint"
            {...form.register('handle', { onChange: () => setSaved(false) })}
          />
          <p id="settings-handle-hint" className="text-xs text-muted-foreground">
            Your channel’s address is /c/{channel.handle}. Changing the handle changes it, and old
            links stop working.
          </p>
          {errors.handle && <p className="text-sm text-destructive">{errors.handle.message}</p>}
        </div>
        {errors.root && (
          <p role="alert" className="text-sm text-destructive">
            {errors.root.message}
          </p>
        )}
        <div className="flex items-center gap-3">
          <Button type="submit" size="sm" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? 'Saving…' : 'Save'}
          </Button>
          {saved && (
            <p role="status" className="text-sm text-muted-foreground">
              Saved.
            </p>
          )}
        </div>
      </form>
    </section>
  )
}
