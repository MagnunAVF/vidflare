import { createFileRoute, redirect } from '@tanstack/react-router'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { UploadDropzone } from '@/components/UploadDropzone'
import { meQuery } from '@/lib/auth'

export const Route = createFileRoute('/upload')({
  // Uploads belong to a channel: signed-out visitors sign in first.
  beforeLoad: async ({ context }) => {
    if (!(await context.queryClient.ensureQueryData(meQuery))) throw redirect({ to: '/login' })
  },
  component: UploadPage,
})

function UploadPage() {
  return (
    <main className="flex justify-center px-4 py-10">
      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle>Upload a video</CardTitle>
          <CardDescription>
            Up to 15 minutes. Your video goes straight to Cloudflare Stream.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <UploadDropzone />
        </CardContent>
      </Card>
    </main>
  )
}
