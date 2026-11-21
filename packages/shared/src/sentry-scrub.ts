// Last line of privacy before an event leaves for Sentry, shared by the Worker and the browser
// SDK (beforeSend / beforeSendTransaction). The SDKs are already configured to collect no
// cookies, bodies or query strings; this removes what still slips through: credential headers
// (session cookie, the moderation bearer token, webhook signatures) and query strings, which can
// hold text a person typed (/search?q=...). Pure TypeScript, no Sentry import: the event types
// are structural so both SDKs' events fit.

const SENSITIVE_HEADERS = new Set([
  'cookie',
  'set-cookie',
  'authorization',
  'proxy-authorization',
  'webhook-signature',
])
export const FILTERED = '[Filtered]'

// Keys that hold a URL or path in breadcrumbs and span data.
const URL_KEYS = ['url', 'to', 'from', 'http.url', 'url.full']
// Keys that hold only a query string.
const QUERY_KEYS = ['http.query', 'url.query']

type Headers = Record<string, string>

export interface ScrubbableEvent {
  request?: {
    url?: string
    headers?: Headers
    cookies?: unknown
    data?: unknown
    query_string?: unknown
  }
  contexts?: { response?: { headers?: Headers } }
  breadcrumbs?: { message?: string; data?: Record<string, unknown> }[]
  spans?: { description?: string; data?: Record<string, unknown> }[]
}

// "/search?q=cats#top" → "/search". Leaves anything without a query alone.
export function stripQuery(value: string): string {
  const cut = value.search(/[?#]/)
  return cut === -1 ? value : value.slice(0, cut)
}

function scrubHeaders(headers: Headers | undefined) {
  if (!headers) return
  for (const key of Object.keys(headers)) {
    if (SENSITIVE_HEADERS.has(key.toLowerCase())) headers[key] = FILTERED
  }
}

function scrubData(data: Record<string, unknown> | undefined) {
  if (!data) return
  for (const key of URL_KEYS) {
    const value = data[key]
    if (typeof value === 'string') data[key] = stripQuery(value)
  }
  for (const key of QUERY_KEYS) delete data[key]
}

// Scrubs the event in place and returns it (the beforeSend contract).
export function scrubSentryEvent<T extends ScrubbableEvent>(event: T): T {
  const request = event.request
  if (request) {
    scrubHeaders(request.headers)
    if (request.url) request.url = stripQuery(request.url)
    delete request.cookies
    delete request.data
    delete request.query_string
  }
  scrubHeaders(event.contexts?.response?.headers)
  for (const crumb of event.breadcrumbs ?? []) scrubData(crumb.data)
  for (const span of event.spans ?? []) {
    // Span descriptions are "GET /api/search?q=..." for HTTP spans.
    if (span.description) span.description = stripQuery(span.description)
    scrubData(span.data)
  }
  return event
}
