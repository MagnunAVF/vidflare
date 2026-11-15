import { Hono } from 'hono'

import { toMeResponse } from '../lib/me'
import { requireUser } from '../middleware/session'
import type { AppEnv } from '../types'

export const me = new Hono<AppEnv>().get('/', requireUser, (c) =>
  c.json(toMeResponse(c.var.user), 200),
)
