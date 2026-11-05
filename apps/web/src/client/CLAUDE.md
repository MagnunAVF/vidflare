# Client (React SPA)

React + Vite app served as static assets by the Worker. Same origin as the API, so there's no CORS and auth is cookie-based.

## Structure

- `main.tsx`: Sentry init, router, `QueryClientProvider`, `Sentry.ErrorBoundary` at the root
- `routes/`: TanStack Router file-based routes
- `components/`: feature components plus shadcn/ui primitives
- `lib/api.ts`: `export const api = hc<AppType>('/')`

## Routes (MVP)

`/` home · `/watch/$id` · `/c/$handle` · `/feed/subscriptions` (auth) · `/search?q=` · `/upload` (auth) · `/studio` (auth) · `/login` · `/signup` · `/settings` (auth)

Don't add routes outside this list without updating the roadmap.

## Data fetching

- All API calls go through `api` (Hono RPC), wrapped in TanStack Query hooks. No raw `fetch` to `/api`.
- Import `AppType` as a type only (`import type`) so no Worker code ends up in the bundle.
- Route loaders prefetch with `queryClient.ensureQueryData(...)`, using the same query options as the component.
- Feeds and comments use `useInfiniteQuery` with the API's cursor.
- Likes and subscribes are optimistic updates with rollback in `onError` and invalidation in `onSettled`.
- Validate search params with Zod (`validateSearch`).

## Forms

React Hook Form + `zodResolver` with schemas from `@vidflare/shared`, the same ones the API validates with. Sign-up, comment and upload forms include the Turnstile widget and send its token.

## Video

- `StreamPlayer` wraps the Stream iframe (`https://customer-<code>.cloudflarestream.com/<uid>/iframe`). Only the watch route loads it, so keep it code-split.
- Post `/api/videos/:id/view` once per load, after about 10 s of playback.
- Uploads use tus-js-client straight to the Stream URL returned by `POST /api/videos/uploads`, then call `POST /api/videos/:id/uploaded`. Video bytes never go to our API.
- After upload, poll the studio/video endpoint every few seconds until the status is `ready` or `error`.

## Styling

Tailwind + shadcn/ui. Reach for existing shadcn components before writing custom ones.

## Sentry

- `tanstackRouterBrowserTracingIntegration(router)`, `tracePropagationTargets: [/^\/api\//]`, replays on error only with `maskAllText: true`.
- `Sentry.setUser({ id })` on login, `setUser(null)` on logout. Never email.
- Client metrics: `upload.client_duration`, `player.start_time`.

## Testing

Component tests with Vitest. Playwright E2E covers the core journey: sign up → upload short video → watch → like → comment, run against stage.
