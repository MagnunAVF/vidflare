import { RefreshCwIcon } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { useRecheckVideo } from '@/lib/videos'

// Stream's state, in words, for when a re-check finds nothing new yet.
const streamStateLabels: Record<string, string> = {
  pendingupload: 'Stream is still waiting for the upload',
  downloading: 'Stream is receiving the file',
  queued: 'Stream has it queued for encoding',
  inprogress: 'Stream is still encoding it',
}

// For videos stuck in uploading/processing: asks Stream directly instead of waiting for the
// webhook. The table refreshes with the new status; if nothing changed, says what Stream reports.
export function RecheckButton(props: { id: string; status: string }) {
  const recheck = useRecheckVideo()
  const [note, setNote] = useState<string>()

  return (
    <span className="flex items-center gap-2">
      {note && (
        <span role="status" className="text-xs text-muted-foreground">
          {note}
        </span>
      )}
      <Button
        variant="outline"
        size="sm"
        disabled={recheck.isPending}
        onClick={async () => {
          setNote(undefined)
          try {
            const result = await recheck.mutateAsync(props.id)
            if (result.status === props.status) {
              setNote(streamStateLabels[result.streamState ?? ''] ?? 'No change yet')
            }
          } catch {
            setNote('Could not reach Stream. Try again.')
          }
        }}
      >
        <RefreshCwIcon aria-hidden className={recheck.isPending ? 'animate-spin' : undefined} />
        Re-check
      </Button>
    </span>
  )
}
