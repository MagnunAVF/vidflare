# vidflare

A YouTube-style video platform running 100% on Cloudflare: creators upload videos; viewers watch, like, comment, subscribe and search. One Worker serves the React app and the Hono API; Cloudflare Stream handles every video byte.

## Docs

- [Local development](docs/LocalDevelopment.md): run it on your machine, run the tests (Vitest and the Playwright journey)
- [Cloudflare setup](docs/CloudflareSetup.md): stage and production resources, secrets, deploys
- [Sentry setup](docs/SentrySetup.md): errors, traces, metrics, alerts and dashboards
- [Moderation](docs/Moderation.md): reports and the manual takedown runbook
- [Roadmap](docs/Roadmap.md) (the plan of record) and [TODO](docs/TODO.md) (progress)

## Quick start

```sh
pnpm install
cp apps/web/.dev.vars.example apps/web/.dev.vars   # then fill it in, see Local development
pnpm --filter web db:setup:local
pnpm dev
```
