import { hc } from 'hono/client'

// Type-only import: no Worker code ends up in the client bundle.
import type { AppType } from '../../worker'

// The only way the client talks to the API: same origin, cookie auth, fully typed routes.
// Usage: const res = await api.api.health.$get()
export const api = hc<AppType>('/')
