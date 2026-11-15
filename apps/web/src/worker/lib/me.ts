import type { MeResponse } from '@vidflare/shared'

import type { SessionUser } from '../types'

// The public shape of the signed-in user (shared DTO); drops the session id.
export const toMeResponse = (user: Omit<SessionUser, 'sessionId'>): MeResponse => ({
  user: { id: user.id, email: user.email },
  channel: user.channel,
})
