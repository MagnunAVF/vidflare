# Worker (Hono API)

Hono app on Cloudflare Workers. It also exports the queue consumer, the `scheduled` reconcile job and the `VideoStats` Durable Object.

## Structure

- `index.ts`: builds the app, chains routes, exports `AppType`, the default handler (`fetch`, `queue`, `scheduled`) wrapped in `Sentry.withSentry`, and `VideoStats` wrapped in `Sentry.instrumentDurableObjectWithSentry`
- `routes/`: `auth`, `videos`, `channels`, `comments`, `feed`, `search`, `studio`, `me`, `webhooks`, `debug` (`GET /debug/error` throws on purpose to verify Sentry; signed-in only, 404 in production)
- `middleware/`: request id + logger, error handler, session loader, `requireUser`, rate limit
- `db/schema.ts`: Drizzle schema (the source of truth for migrations)
- `services/stream.ts`: Stream API client (direct upload, delete, status lookup)
- `do/VideoStats.ts`: per-video view/like counters
- `sentry.ts`: `sentryOptions(env)`

## Hono conventions

- App type: `new Hono<{ Bindings: Env; Variables: { user?: User; requestId: string } }>().basePath('/api')`.
- Chain `.route()` calls in a single expression so `typeof app` carries every route. Breaking the chain silently drops routes from the client types.
- Middleware order: Sentry (outermost) → request id + logger → error handler → session loader (`c.var.user`) → `requireUser` → `zValidator`.
- Validate every input (`json`, `param`, `query`) with `zValidator` using schemas from `@vidflare/shared`.
- Errors are JSON: `{ error: '<code>', requestId }`. In `onError`, call `Sentry.captureException(err)` before responding.
- Owner-only routes (edit/delete video, delete comment) must check ownership in the SQL `WHERE` clause, not just in app code.

## D1 rules

- No `db.transaction()`. D1 has no interactive transactions, so multi-statement writes go in one `db.batch()`.
- Keep invariants in SQL: `INSERT ... ON CONFLICT DO NOTHING` for likes/subscriptions, conditional `WHERE` for status transitions (e.g. `uploading → processing` only `WHERE status = 'uploading'`).
- IDs are UUIDv7/ULID generated in the Worker. Timestamps are integer epoch ms.
- Pagination is a cursor on `(published_at, id)`. Never `OFFSET`.
- Public listings filter `visibility = 'public' AND status = 'ready'`. Search joins `videos_fts` back to `videos` and applies the same filter.
- Read the denormalized counters (`view_count`, `like_count`, `comment_count`, `subscriber_count`). Never `COUNT(*)` in feeds. The exception: subscribe/unsubscribe recompute `subscriber_count` from `subscriptions` inside the same batch.

## Video lifecycle

`uploading → processing → ready | error`

1. `POST /videos/uploads`: generate the video id, create a tus Stream direct creator upload (needs the file size) with `maxDurationSeconds` and `meta: { env: env.ENVIRONMENT, videoId }`, then insert the row (`uploading`, with `stream_uid`). Delete the Stream video if the insert fails. Return the one-time tus URL.
2. `POST /videos/:id/uploaded`: set `processing` only from `uploading`.
3. `POST /webhooks/stream`: verify the `Webhook-Signature` HMAC (`STREAM_WEBHOOK_SECRET`), then route by `meta.env` and return 200 fast: `production` goes to `EVENTS`, `stage` to `STAGE_EVENTS` (a producer bound only in production), and `local` or untagged gets a `warn` log and is dropped. No D1 work and no other logic here: the account's single Stream webhook lands on production, so this handler serves every environment. An invalid signature gets a `warn` log and the `webhook.signature_invalid` metric.
4. Queue consumer: set `ready`/`error`, `duration_s`, `thumbnail_url`, `published_at`, then purge the home feed and channel KV keys. Look the video up by `stream_uid` in this environment's D1; an unknown uid is logged and acked. Must be idempotent, because messages can be redelivered.
5. Nightly `scheduled` reconcile re-checks this environment's stuck videos against the Stream API, wrapped in `Sentry.withMonitor`. The Stream library is shared across environments, so only act on videos that have a row in this environment's D1, plus (stage only) delete stage-tagged Stream videos that have no row.

## VideoStats Durable Object

- One instance per video (`idFromName(videoId)`), SQLite storage.
- Dedupe views by session id. Increment in DO storage and flush totals to D1 every 60 s with an alarm, inside a `stats.flush` span.
- Never write view counts to D1 straight from a request.

## Auth

- Passwords: PBKDF2 via Web Crypto. Session id goes in an `HttpOnly; Secure; SameSite=Lax` cookie.
- Sign-up creates user + channel + session in one `db.batch()` after verifying Turnstile.
- Turnstile is required on sign-up, comment creation and upload creation.

## Caching

KV `CACHE`: home feed, channel pages and video detail (60 s). Any write that changes what those show must delete the affected keys.

## Observability

- Custom spans: `stream.create_upload`, `queue.stream_event` (attr `video.id`), `stats.flush`.
- Metrics and log names follow the table in the roadmap's "Observability with Sentry" section. Reuse those names.
- Structured attributes only (ids, durations). No emails, tokens or free text.

## Testing

Vitest with `@cloudflare/vitest-plugin`, against local D1/KV/DO. Mock the Stream API; replay recorded webhook payloads for the queue consumer. Cover status transitions, idempotency (repeat likes, redelivered queue messages) and ownership checks.
