import { useQuery } from '@tanstack/react-query'
import { createFileRoute, redirect } from '@tanstack/react-router'
import { UPLOAD_MAX_DURATION_S } from '@vidflare/shared'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { UploadDropzone } from '@/components/UploadDropzone'
import { meQuery } from '@/lib/auth'
import { formatMinutes } from '@/lib/format'
import { studioStorageQuery } from '@/lib/videos'

export const Route = createFileRoute('/upload')({
  // Uploads belong to a channel: signed-out visitors sign in first.
  beforeLoad: async ({ context }) => {
    if (!(await context.queryClient.ensureQueryData(meQuery))) throw redirect({ to: '/login' })
  },
  component: UploadPage,
})

function UploadPage() {
  // Loads alongside the form; until it's in, the API alone enforces the limits.
  const { data: storage } = useQuery(studioStorageQuery)

  return (
    <main className="flex justify-center px-4 py-10">
      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle>Upload a video</CardTitle>
          <CardDescription>
            Up to {formatMinutes(UPLOAD_MAX_DURATION_S)} per video. Your video goes straight to
            Cloudflare Stream.
            {storage && (
              <span className="mt-1 block">
                Storage: {formatMinutes(storage.usedS)} of {formatMinutes(storage.limitS)} used.
              </span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <UploadDropzone maxUploadS={storage?.maxUploadS} />
        </CardContent>
      </Card>
    </main>
  )
}
