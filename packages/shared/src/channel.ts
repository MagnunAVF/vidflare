import { z } from 'zod'

import { channelHandle } from './auth'

// Route params for /api/channels/:handle/... (normalized to lowercase, like sign-up).
export const channelHandleParam = z.object({ handle: channelHandle })

// Route params for /api/channels/:id/subscribe
export const channelIdParam = z.object({ id: z.uuid() })
