import { zValidator } from '@hono/zod-validator'
import type { Context, ValidationTargets } from 'hono'
import type { ZodType } from 'zod'

import type { AppEnv } from '../types'

// zValidator with the API's JSON error shape. Use it for every json/param/query input,
// with schemas from @vidflare/shared.
export const validate = <Target extends keyof ValidationTargets, Schema extends ZodType>(
  target: Target,
  schema: Schema,
) =>
  zValidator(target, schema, (result, c) => {
    if (!result.success) {
      const issues = result.error.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      }))
      // The hook's context isn't typed with AppEnv, but it is the same request context.
      const requestId = (c as unknown as Context<AppEnv>).get('requestId')
      return c.json({ error: 'invalid_request', requestId, issues }, 400)
    }
  })
