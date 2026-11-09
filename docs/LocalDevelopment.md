# Local development

Everything runs on your machine except the few services that can't be simulated. Those point at **stage**, never at production.

## First run

```sh
pnpm install
cp apps/web/.dev.vars.example apps/web/.dev.vars   # then fill in the blanks (see below)
pnpm --filter web db:setup:local                   # apply D1 migrations + load seed data
pnpm dev                                           # SPA + Worker on http://localhost:5173
```

`pnpm --filter web db:seed:local` resets the sample data at any time. To start completely fresh, delete `apps/web/.wrangler/state` and run `db:setup:local` again.

## What runs locally

`vite dev` (via `@cloudflare/vite-plugin`) runs the Worker in workerd, and Miniflare simulates these bindings, with state kept in `apps/web/.wrangler/state`:

| Binding | Service | Local |
| --- | --- | --- |
| `DB` | D1 `vidflare-db` | ✅ migrations + `seed/seed.sql` |
| `CACHE` | KV | ✅ |
| `MEDIA` | R2 `vidflare-media` | ✅ |
| `EVENTS` | Queue `stream-events` (producer + consumer) | ✅ |
| `VIDEO_STATS` | Durable Object `VideoStats` (SQLite) | ✅ |

Tests (`pnpm test`) use the same bindings, isolated per test, with migrations applied automatically.

## What points at stage, and how

| Service | Why it can't run locally | How it points at stage |
| --- | --- | --- |
| Stream API: direct uploads, encoding, status, delete | Hosted service; no local emulator | `STREAM_ACCOUNT_ID` + `STREAM_API_TOKEN` in `.dev.vars` are the **stage** account's (token with Stream:Edit). Uploads go from your browser straight to stage Stream and show up in its library. |
| Stream webhooks | Stream calls one webhook URL per account, which is the stage Worker, so it can't reach localhost | Don't repoint the stage webhook. Locally, send recorded payloads to `POST /api/webhooks/stream`, signed with your local `STREAM_WEBHOOK_SECRET`, or use the studio re-check, which queries the Stream API (both arrive in Phase 2). |
| Turnstile verification | Verified by Cloudflare's siteverify API | By default `.dev.vars` uses Cloudflare's [test secret](https://developers.cloudflare.com/turnstile/troubleshooting/testing/) that always passes, so no stage keys are needed. To exercise a real challenge, use the stage widget's secret and add `localhost` to that widget's hostnames. |
| Sentry (optional) | Hosted service | Leave `SENTRY_DSN` empty to keep it off, or use the stage DSN. |

Stream isn't a Worker binding (the Worker calls its REST API with a token), so it's switched by credentials, not by `remote: true`.

## Rules

- Never put production credentials in `.dev.vars`, and never point local dev at a production resource.
- `.dev.vars` is gitignored; `.dev.vars.example` is the committed template. When you add a secret, add it to both, and to `secrets.required` in `wrangler.jsonc`.
- After changing bindings in `wrangler.jsonc`, run `pnpm --filter web exec wrangler types`.
