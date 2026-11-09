# TODO

Task tracker for the MVP, derived from [Roadmap.md](Roadmap.md). Tick items as they land; when a phase's exit criterion is met, tick it here and in the roadmap.

## Phase 1: Foundation (weeks 1–2)

**Repo and tooling**
- [x] pnpm workspace with `apps/web` and `packages/shared`
- [ ] Scaffold `apps/web` with `pnpm create cloudflare@latest web --framework=react`
- [ ] Add `hono`, `drizzle-orm`, `drizzle-kit`, `zod`, `@hono/zod-validator`
- [ ] `vite.config.ts` with `react()` + `cloudflare()` (`@cloudflare/vite-plugin`)
- [ ] TypeScript strict, ESLint, Prettier; root `typecheck`, `lint`, `test` scripts
- [ ] Tailwind CSS + shadcn/ui
- [ ] TanStack Router (file-based) + TanStack Query
- [ ] `packages/shared` set up as `@vidflare/shared` (Zod only)

**Local environment**
- [ ] `vite dev` running the Worker with local D1, KV, R2, Queues and Durable Objects
- [ ] `.dev.vars.example` committed; `.dev.vars` gitignored
- [ ] Local D1 migrations + seed script (sample users, channels, videos)
- [ ] Document which services point at `stage` locally (Stream, Turnstile) and how

**Cloudflare resources (`stage` and `production`)**
- [ ] D1 `vidflare-db`, KV `CACHE`, R2 `vidflare-media`, Queue `stream-events`, per environment
- [ ] `wrangler.jsonc` with all bindings, `nodejs_compat`, SPA assets config, `VideoStats` DO migration, `CF_VERSION_METADATA`, `ENVIRONMENT`
- [ ] Enable Stream; API token with Stream:Edit
- [ ] Secrets per environment: `STREAM_ACCOUNT_ID`, `STREAM_API_TOKEN`, `STREAM_WEBHOOK_SECRET`, `TURNSTILE_SECRET`, `AUTH_SECRET`, `SENTRY_DSN`
- [ ] `wrangler types` generating `Env`

**Data model**
- [ ] Drizzle schema: `users`, `sessions`, `channels`, `videos`, `likes`, `comments`, `subscriptions`
- [ ] Indexes: home feed, channel videos, comments, `subscriptions (channel_id)`
- [ ] Initial migration generated and applied locally

**API skeleton and auth**
- [ ] Hono app under `/api` with chained routes and exported `AppType`
- [ ] Middleware: request id + logger, JSON error handler, session loader, `requireUser`
- [ ] Typed client `hc<AppType>` in `client/lib/api.ts`
- [ ] Shared schemas for sign-up, login
- [ ] `POST /api/auth/signup` (PBKDF2, user + channel + session in one `db.batch()`)
- [ ] `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/me`
- [ ] Session cookie: HttpOnly, Secure, SameSite=Lax
- [ ] `/login` and `/signup` pages with `AuthForm`

**CI/CD**
- [ ] GitHub Actions: typecheck + lint + tests on every PR
- [ ] Preview URL per PR via `wrangler versions upload`
- [ ] On merge to main: `wrangler d1 migrations apply --remote` then `wrangler deploy`

**Sentry**
- [ ] Worker: `@sentry/cloudflare`, `withSentry`, `sentryOptions(env)`, `captureException` in `onError`
- [ ] React: `@sentry/react` init, `ErrorBoundary`, TanStack Router tracing, `tracePropagationTargets`
- [ ] `setUser({ id })` on login, `setUser(null)` on logout
- [ ] `@sentry/vite-plugin` source map upload in CI (`SENTRY_AUTH_TOKEN`), hidden source maps

**Exit criteria**
- [ ] A user can sign up and log in on a stage URL
- [ ] CI deploys a preview per PR
- [ ] A test error and its trace show up in Sentry for stage

## Phase 2: Upload and watch (weeks 3–4)

**Upload**
- [ ] `services/stream.ts`: direct creator upload, delete, status lookup
- [ ] `POST /api/videos/uploads` (row in `uploading`, Stream URL with `maxDurationSeconds` + `meta.videoId`, Turnstile)
- [ ] `POST /api/videos/:id/uploaded` (`processing` only `WHERE status = 'uploading'`)
- [ ] `/upload` page: `UploadDropzone` with tus-js-client, progress bar, metadata form
- [ ] Poll status until `ready` / `error`

**Webhook and queue**
- [ ] `POST /api/webhooks/stream`: verify `Webhook-Signature` HMAC, enqueue, return 200
- [ ] Queue consumer: set `ready`/`error`, `duration_s`, `thumbnail_url`, `published_at`; idempotent
- [ ] Configure the Stream webhook URL per environment
- [ ] Recorded webhook payloads as test fixtures

**Watch and feeds**
- [ ] `GET /api/videos/:id` (video + channel + counts)
- [ ] `/watch/$id` page with `StreamPlayer` (iframe, code-split)
- [ ] `GET /api/videos?cursor=` home feed (public + ready, cursor on `(published_at, id)`)
- [ ] `/` page: `VideoGrid`, `VideoCard`, infinite scroll

**Studio**
- [ ] `GET /api/studio/videos` (own videos, all statuses)
- [ ] `PATCH /api/videos/:id` and `DELETE /api/videos/:id` (Stream + D1, owner check in SQL)
- [ ] `/studio` page: `StudioTable` with status badges, edit, delete
- [ ] Re-check button that queries the Stream API for stuck videos

**Exit criteria**
- [ ] A 5-minute video uploads, turns `ready` via webhook, and plays on the watch page

## Phase 3: Social (weeks 5–6)

**Likes and comments**
- [ ] `PUT / DELETE /api/videos/:id/like` (`ON CONFLICT DO NOTHING` + `like_count` in one batch)
- [ ] `LikeButton` with optimistic update and rollback
- [ ] `GET /api/videos/:id/comments?cursor=`, `POST` (Turnstile), `DELETE /api/comments/:id` (soft delete, owner)
- [ ] `CommentList` + `CommentForm`; `comment_count` updated in the same batch

**Views**
- [ ] `VideoStats` Durable Object: dedupe by session, SQLite counters, 60 s alarm flush to D1
- [ ] `POST /api/videos/:id/view` forwarding to the DO
- [ ] Player posts a view after ~10 s of playback

**Channels and subscriptions**
- [ ] `GET /api/channels/:handle` and `/api/channels/:handle/videos?cursor=`
- [ ] `/c/$handle` page: `ChannelHeader`, `VideoGrid`
- [ ] `PUT / DELETE /api/channels/:id/subscribe` (recompute `subscriber_count` in batch, no self-subscribe)
- [ ] `SubscribeButton` with optimistic update
- [ ] `GET /api/feed/subscriptions?cursor=` + `/feed/subscriptions` page

**Profile**
- [ ] `POST /api/me/avatar` to R2
- [ ] `/settings` page: name, handle, avatar

**Exit criteria**
- [ ] Likes, comments, views and subscriptions work and counters stay correct after a DO flush

## Phase 4: Launch prep (weeks 7–8)

**Search**
- [ ] `videos_fts` FTS5 table + sync triggers (raw SQL migration)
- [ ] `GET /api/search?q=` joined to `videos` with the public-listing filter
- [ ] `/search` page: `SearchBar`, `VideoList`, Zod-validated search params

**Cache and abuse protection**
- [ ] KV cache for home feed, channel pages and video detail (60 s); purge on writes and in the queue consumer
- [ ] Turnstile on sign-up, comment and upload (verified end to end)
- [ ] Rate limiting rules (login, comments, uploads, views)
- [ ] Upload length cap (e.g. 15 min) and per-creator storage cap

**Reliability**
- [ ] Nightly `scheduled` reconcile job wrapped in `Sentry.withMonitor`
- [ ] Report button + manual takedown flow

**Observability**
- [ ] Custom spans: `stream.create_upload`, `queue.stream_event`, `stats.flush`
- [ ] Metrics from the roadmap table (upload, webhook, views, flush, auth, client timings)
- [ ] `beforeSend` scrubbing `Cookie` / `Authorization`; replay text masking
- [ ] Alerts: new prod issue, `/api` error rate > 2%, p95 video detail > 500 ms, `upload.failed` spike, `webhook.signature_invalid` > 0, missed cron check-in
- [ ] Dashboards: upload funnel, API p95 per route, queue processing time, views per hour

**Testing and launch**
- [ ] Vitest route/unit tests in the Workers runtime (status transitions, idempotency, ownership)
- [ ] Playwright E2E against stage: sign up → upload → watch → like → comment
- [ ] Budget alerts on Stream and Workers usage
- [ ] Production deploy behind the custom domain

**Exit criteria**
- [ ] E2E suite green
- [ ] Sentry alerts and dashboards in place, source maps resolving
- [ ] Production deployed behind the domain → **Public beta**

## Post-MVP backlog

- [ ] Live streaming (Stream Live inputs) + chat via Durable Objects and WebSockets
- [ ] Private videos with signed playback tokens
- [ ] Auto-captions and tags with Workers AI; semantic search and related videos with Vectorize
- [ ] Notifications for new uploads (Queues + email provider)
- [ ] Playlists, comment replies, watch history, Analytics Engine creator dashboards
- [ ] Monetization with an external payment provider
