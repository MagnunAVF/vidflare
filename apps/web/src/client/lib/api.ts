import { hc } from 'hono/client'

// Type-only import: no Worker code ends up in the client bundle.
import type { AppType } from '../../worker'

// The only way the client talks to the API: same origin, cookie auth, fully typed routes.
// Usage: const me = await unwrap(await api.api.me.$get())
export const api = hc<AppType>('/')

// The API's error body: `{ error, requestId }`, plus field issues for invalid_request.
export class ApiRequestError extends Error {
  readonly status: number
  readonly code: string
  readonly issues: { path: string; message: string }[]

  constructor(status: number, body: { error?: string; issues?: ApiRequestError['issues'] }) {
    super(body.error ?? `http_${status}`)
    this.name = 'ApiRequestError'
    this.status = status
    this.code = body.error ?? `http_${status}`
    this.issues = body.issues ?? []
  }
}

interface AnyResponse {
  ok: boolean
  status: number
  json(): Promise<unknown>
}
// The JSON type of the success (`ok: true`) branches of a typed client response.
type SuccessJson<R extends AnyResponse> = Awaited<ReturnType<Extract<R, { ok: true }>['json']>>

// The typed JSON of a successful response; throws ApiRequestError otherwise.
export async function unwrap<R extends AnyResponse>(res: R): Promise<SuccessJson<R>> {
  if (res.ok) return (await res.json()) as SuccessJson<R>
  const body = (await res.json().catch(() => ({}))) as ConstructorParameters<
    typeof ApiRequestError
  >[1]
  throw new ApiRequestError(res.status, body)
}
