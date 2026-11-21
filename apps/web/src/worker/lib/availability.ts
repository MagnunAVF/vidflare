import { and, eq, isNull } from 'drizzle-orm'

import { videos } from '../db/schema'

// A video viewers can watch and act on (view, like, comment, report): Stream has it ready and no
// moderator has taken it down. Anything else answers like a missing video (404).

// As a SQL condition on `videos`.
export const availableVideo = () => and(eq(videos.status, 'ready'), isNull(videos.takenDownAt))

// For a row already read.
export const isAvailable = (video: { status: string; takenDownAt: number | null }) =>
  video.status === 'ready' && video.takenDownAt === null
