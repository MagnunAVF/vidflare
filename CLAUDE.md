# vidflare

YouTube-style video platform running 100% on Cloudflare. Creators upload videos; viewers watch, like, comment and subscribe. Cloudflare Stream handles all video bytes.

The plan of record is [docs/Roadmap.md](docs/Roadmap.md). Read it before designing anything new; if a change conflicts with it, update the roadmap in the same change or ask first.

Task progress is tracked in [docs/TODO.md](docs/TODO.md). Before starting work, pick the next open item there; when an item is done, tick it in the same change.

## Status

MVP in progress: Phases 1–3 are done and Phase 4 (launch prep) is under way. [docs/TODO.md](docs/TODO.md) has the live state. Keep to the layout below; don't invent an alternative structure.

## Layout (pnpm workspace)

```
apps/web/            # the only deployable: one Worker serving the React SPA + Hono API under /api
  src/client/        # React + Vite SPA          → see apps/web/src/client/CLAUDE.md
  src/worker/        # Hono API, queue consumer, Durable Objects → see apps/web/src/worker/CLAUDE.md
  migrations/        # D1 migrations (drizzle-kit; FTS5 table and triggers hand-written)
  e2e/               # Playwright E2E of the core journey (pnpm test:e2e)
packages/shared/     # Zod schemas + DTO types shared by client and worker → see packages/shared/CLAUDE.md
.github/workflows/   # CI/CD
```

## Stack at a glance

TypeScript (strict) · React + Vite + `@cloudflare/vite-plugin` · TanStack Router + Query · Tailwind + shadcn/ui · Hono on Workers · Zod · Drizzle ORM (D1) · Cloudflare Stream, D1, KV, R2, Queues, Durable Objects, Turnstile · Sentry · Vitest (`@cloudflare/vitest-plugin`) + Playwright · GitHub Actions + Wrangler.

## Project-wide rules

- One Worker, one domain, no CORS. Don't add a second deployable or a separate API origin.
- Video bytes never pass through the Worker. Uploads go browser → Stream (tus); playback comes from Stream's CDN.
- Types flow from the server: the client calls the API only through the typed Hono RPC client (`hc<AppType>`). No hand-written fetch calls, no codegen.
- Validation schemas live once in `packages/shared` and are used by both Hono validators and React forms.
- Public listings (home, channel, subscriptions feed, search) always filter `visibility = 'public' AND status = 'ready'`.
- No PII in logs, metrics or Sentry: user id only, never email or free text. Both Sentry SDKs set `dataCollection` with user info, cookies, bodies and query strings off, and scrub what's left in `beforeSend` / `beforeSendSpan` (`packages/shared/src/sentry-scrub.ts`).
- Secrets go through `wrangler secret put` (runtime) or CI secrets (`SENTRY_AUTH_TOKEN`). Never commit them or put them in `wrangler.jsonc` `vars`.
- Keep to MVP scope. Live streaming, playlists, notifications, recommendations, private/signed videos, monetization and comment replies are post-MVP; don't build them unless asked.

## Commands

```sh
pnpm install
pnpm dev                 # vite dev (runs the Worker inside Vite)
pnpm typecheck && pnpm lint && pnpm test                  # Vitest, Worker tests in the Workers runtime
pnpm test:e2e            # Playwright journey; local dev by default, E2E_BASE_URL=<stage> for stage
pnpm --filter web exec wrangler types                     # regenerate Env after binding changes
pnpm --filter web db:setup:local                          # local D1: apply migrations + seed
```

## Environments and deploy

- Local first: develop and test against a local environment on the developer's machine. Use local bindings (D1, KV, R2, Queues, Durable Objects) through `vite dev` / Miniflare, seeded with local data and `.dev.vars`. Every new feature must run and pass its tests locally.
- If a resource can't run locally (e.g. Cloudflare Stream uploads and encoding, or Turnstile verification), point only that binding or service at its `stage` resource (`remote: true` or stage credentials in `.dev.vars`). Never point local dev at `production`. Stream webhooks never reach local dev; replay recorded payloads instead.
- [docs/LocalDevelopment.md](docs/LocalDevelopment.md) lists which services point at `stage` locally and how. Update it when that changes.
- `stage` and `production` are separate environments in one Cloudflare account, each with its own D1, KV, R2 and Queue. They share one Stream library and its single webhook: uploads are tagged `meta.env`, and the production Worker routes each event to that environment's queue. See "Stream across environments" in the roadmap.
- CI: typecheck + lint + tests on every PR (no per-PR previews; `stage` is where changes are tried before production); push to `dev` deploys `stage` and push to `main` deploys `production` (`wrangler d1 migrations apply --remote` then `wrangler deploy`, plus a Sentry release and source map upload).

## Done means

Typecheck, lint and tests pass, and any binding change has been followed by `wrangler types`. When a phase exit criterion in the roadmap is met, tick it there.
