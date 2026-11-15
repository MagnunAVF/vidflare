import { useQuery } from '@tanstack/react-query'
import { CircleAlertIcon, CircleCheckIcon, LoaderCircleIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { videoStatusQuery } from '@/lib/videos'

// After an upload: polls the video's status until Stream has finished processing it.
export function UploadStatus(props: { videoId: string; onUploadAnother: () => void }) {
  const { data, isError } = useQuery(videoStatusQuery(props.videoId))
  const status = data?.status

  let icon = <LoaderCircleIcon aria-hidden className="size-5 animate-spin" />
  let message = 'Upload complete. Stream is processing your video…'
  if (status === 'ready') {
    icon = <CircleCheckIcon aria-hidden className="size-5 text-green-600" />
    message = 'Your video is ready.'
  } else if (status === 'error' || isError) {
    icon = <CircleAlertIcon aria-hidden className="size-5 text-destructive" />
    message =
      status === 'error'
        ? 'Stream could not process this video. Try another file.'
        : 'Could not check the video status. It keeps processing; check back later.'
  }

  return (
    <div className="grid gap-4">
      <p role="status" className="flex items-center gap-2 text-sm">
        {icon}
        {message}
      </p>
      <Button type="button" variant="outline" onClick={props.onUploadAnother}>
        Upload another video
      </Button>
    </div>
  )
}
