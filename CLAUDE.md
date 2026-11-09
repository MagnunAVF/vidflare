# vidflare

YouTube-style video platform running 100% on Cloudflare. Creators upload videos; viewers watch, like, comment and subscribe. Cloudflare Stream handles all video bytes.

The plan of record is [docs/Roadmap.md](docs/Roadmap.md). Read it before designing anything new; if a change conflicts with it, update the roadmap in the same change or ask first.

Task progress is tracked in [docs/TODO.md](docs/TODO.md). Before starting work, pick the next open item there; when an item is done, tick it in the same change.

## Status

Pre-code. The repo layout and commands below are the planned target from the roadmap; scaffold them as described, don't invent an alternative structure.

## Layout (pnpm workspace)

```
apps/web/            # the only deployable: one Worker serving the React SPA + Hono API under /api
  src/client/        # React + Vite SPA          → see apps/web/src/client/CLAUDE.md
  src/worker/        # Hono API, queue consumer, Durable Objects → see apps/web/src/worker/CLAUDE.md
  migrations/        # D1 migrations (drizzle-kit)
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
- No PII in logs, metrics or Sentry (`sendDefaultPii: false`; user id only, never email).
- Secrets go through `wrangler secret put` (runtime) or CI secrets (`SENTRY_AUTH_TOKEN`). Never commit them or put them in `wrangler.jsonc` `vars`.
- Keep to MVP scope. Live streaming, playlists, notifications, recommendations, private/signed videos, monetization and comment replies are post-MVP; don't build them unless asked.

## Commands (planned)

```sh
pnpm install
pnpm dev                 # vite dev (runs the Worker inside Vite)
pnpm typecheck && pnpm lint && pnpm test
pnpm --filter web exec wrangler types                     # regenerate Env after binding changes
pnpm --filter web exec wrangler d1 migrations apply vidflare-db --local
```

## Environments and deploy

- Local first: develop and test against a local environment on the developer's machine. Use local bindings (D1, KV, R2, Queues, Durable Objects) through `vite dev` / Miniflare, seeded with local data and `.dev.vars`. Every new feature must run and pass its tests locally.
- If a resource can't run locally (e.g. Cloudflare Stream uploads, encoding, webhooks, or Turnstile verification), point only that binding or service at its `stage` resource (`remote: true` or stage credentials in `.dev.vars`). Never point local dev at `production`.
- [docs/LocalDevelopment.md](docs/LocalDevelopment.md) lists which services point at `stage` locally and how. Update it when that changes.
- `stage` and `production` are separate Cloudflare environments, each with its own D1, KV, Queue and Stream webhook secret.
- CI: typecheck + lint + tests on every PR, `wrangler versions upload` for a preview URL; on merge to main, `wrangler d1 migrations apply --remote` then `wrangler deploy`, plus a Sentry release and source map upload.

## Done means

Typecheck, lint and tests pass, and any binding change has been followed by `wrangler types`. When a phase exit criterion in the roadmap is met, tick it there.
