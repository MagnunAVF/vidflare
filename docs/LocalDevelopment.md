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
| `triggers.crons` | Nightly reconcile (`lib/reconcile.ts`) | ✅ never fires on its own; run it with `curl "http://localhost:5173/cdn-cgi/handler/scheduled?cron=0+3+*+*+*"`. It asks the Stream API (the shared library, like every local Stream call) about this D1's videos stuck for over an hour, so the seeded demo rows with fake uids turn `error`. |

Tests (`pnpm test`) use the same bindings, isolated per test, with migrations applied automatically.

## What points at stage, and how

| Service | Why it can't run locally | How it points at stage |
| --- | --- | --- |
| Stream API: direct uploads, encoding, status, delete | Hosted service; no local emulator | `.dev.vars` uses the account id and **stage's** `STREAM_API_TOKEN` (Stream:Edit). The Stream library is shared by every environment, so local uploads land in it tagged `meta.env = "local"`. |
| Stream webhooks | The account's single webhook goes to production, which routes by `meta.env` and drops `local` events | Never repoint the account webhook. Locally, replay a recorded payload with `pnpm --filter web webhook:replay src/worker/test/fixtures/stream-webhook-ready.json --uid <stream_uid> --video-id <videos.id>` (or `stream-webhook-error.json`), which signs it with your local `STREAM_WEBHOOK_SECRET` and posts it to the running `pnpm dev`. Or, simpler for a real upload: click **Re-check** on the video in `/studio`, which asks the Stream API for its state and applies it. See "Stream across environments" in the roadmap. |
| Turnstile verification | Verified by Cloudflare's siteverify API | By default `.dev.vars` uses Cloudflare's [test secret](https://developers.cloudflare.com/turnstile/troubleshooting/testing/) that always passes, and in dev the sign-up widget falls back to the matching test site key, so no stage keys are needed. To exercise a real challenge, use the stage widget's secret in `.dev.vars`, its site key as `VITE_TURNSTILE_SITE_KEY` (in `apps/web/.env.local`), and add `localhost` to that widget's hostnames. |
| Sentry (optional) | Hosted service | Off by default: `SENTRY_DSN` (Worker, `.dev.vars`) and `VITE_SENTRY_DSN` (client, `apps/web/.env.local`) are empty. Set them to the stage DSN to test reporting; events are tagged `environment: local`. Source maps are never built locally. See [SentrySetup.md](SentrySetup.md). |

Stream isn't a Worker binding (the Worker calls its REST API with a token), so it's switched by credentials, not by `remote: true`.

## End-to-end tests

`apps/web/e2e/journey.spec.ts` (Playwright) walks the core journey through the real UI: sign up → upload → watch → like → comment.

```sh
pnpm --filter web exec playwright install chromium    # once per machine / Playwright version
pnpm test:e2e                                         # local: starts `pnpm dev` if it isn't running
E2E_BASE_URL=https://<stage host> pnpm test:e2e       # stage
```

- **What it creates:** a fresh account (`e2e…@example.com`, kept: accounts can't be deleted in the MVP) and one real Stream video from `e2e/fixtures/clip.mp4` (5 s), which it deletes at the end, pass or fail.
- **Encoding:** on stage the webhook marks the video ready; locally no webhook arrives, so the test clicks **Re-check** in the studio until it's ready (harmless on stage). It allows Stream up to 4 minutes.
- **Turnstile:** locally the test keys always pass. On stage the real widget runs, and it may challenge a headless browser; if the run stops at "the Turnstile widget did not pass", that's why.
- Failures keep a trace, screenshot and video in `apps/web/test-results/` (open the trace with `pnpm --filter web exec playwright show-trace <trace.zip>`).

## Rules

- Never put production credentials in `.dev.vars`, and never point local dev at a production resource.
- `.dev.vars` is gitignored; `.dev.vars.example` is the committed template. When you add a secret, add it to both, and to `secrets.required` in `wrangler.jsonc`.
- After changing bindings in `wrangler.jsonc`, run `pnpm --filter web exec wrangler types`.
