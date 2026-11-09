# Cloudflare setup (stage and production)

One-time setup of the remote environments. Both live in the same Cloudflare account with names suffixed per environment; local development needs none of this (see [LocalDevelopment.md](LocalDevelopment.md)).

| | stage | production |
| --- | --- | --- |
| Worker | `vidflare-stage` | `vidflare-production` |
| D1 (`DB`) | `vidflare-db-stage` | `vidflare-db-production` |
| KV (`CACHE`) | `CACHE-stage` | `CACHE-production` |
| R2 (`MEDIA`) | `vidflare-media-stage` | `vidflare-media-production` |
| Queue (`EVENTS`) | `stream-events-stage` | `stream-events-production` |
| `ENVIRONMENT` | `stage` | `production` |

All commands run from `apps/web` (or prefix them with `pnpm --filter web`).

## 1. Log in

```sh
pnpm exec wrangler login        # or export CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID
pnpm exec wrangler whoami       # confirm the account
```

## 2. Resources

```sh
pnpm cf:setup stage
pnpm cf:setup production
pnpm exec wrangler types        # then commit wrangler.jsonc and worker-configuration.d.ts
```

The script is idempotent: it reuses resources that exist, creates the missing ones and writes the D1/KV ids over the placeholders in `wrangler.jsonc`. It never deletes anything.

Then apply the D1 schema remotely (CI does this on every merge to main once the CI task lands):

```sh
pnpm exec wrangler d1 migrations apply vidflare-db-stage --remote --env stage
pnpm exec wrangler d1 migrations apply vidflare-db-production --remote --env production
```

## 3. Stream and its API token

1. Dashboard → **Stream** → enable it (it's a paid add-on billed on minutes stored and delivered).
2. **My Profile → API Tokens → Create Token → Custom token**:
   - Permissions: *Account* · *Stream* · *Edit*
   - Account resources: only this account
   - Name it after the environment it's for (for example `vidflare-stage-stream`). Use one token per environment so either can be rotated alone.
3. Note the account id (dashboard sidebar, or `wrangler whoami`) for `STREAM_ACCOUNT_ID`.

> **Webhooks are per account.** Stream has a single webhook URL per Cloudflare account, so with both environments in one account only one Worker can receive Stream webhooks. This needs a decision before the Phase 2 webhook work. The options are: (a) use a separate account for stage's Stream (`STREAM_ACCOUNT_ID` is already a per-env secret, so only Stream moves); (b) send webhooks to production and let stage rely on polling and the reconcile job; or (c) send them to one Worker that forwards the other env's events using `meta.env` on the upload.

## 4. Secrets per environment

Set each one per environment. Piping a value keeps it out of your shell history; `wrangler secret put NAME --env <env>` with no pipe prompts for it instead.

| Secret | Where the value comes from |
| --- | --- |
| `STREAM_ACCOUNT_ID` | Step 3 |
| `STREAM_API_TOKEN` | Step 3 (that environment's token) |
| `STREAM_WEBHOOK_SECRET` | Returned by Stream when the webhook URL is registered (Phase 2: "Configure the Stream webhook URL per environment"). Set it then. |
| `TURNSTILE_SECRET` | Dashboard → **Turnstile** → add a widget per environment with that environment's hostname(s) → secret key |
| `AUTH_SECRET` | Generate: `openssl rand -hex 32 \| pnpm exec wrangler secret put AUTH_SECRET --env stage` (new value per environment) |
| `SENTRY_DSN` | The Sentry project's DSN (Sentry task) |

```sh
pnpm exec wrangler secret put STREAM_API_TOKEN --env stage
pnpm exec wrangler secret list --env stage        # names only, never values
```

If the Worker hasn't been deployed yet, `secret put` creates it. Missing secrets are listed in `secrets.required` in `wrangler.jsonc`, and wrangler warns when one isn't set.

## 5. Deploy

```sh
pnpm deploy:stage
pnpm deploy:production
```

These build with `CLOUDFLARE_ENV=<env>`, because the Vite plugin picks the environment at build time. Never run a plain `wrangler deploy` after a plain `vite build`: it would deploy the local config as a Worker named `vidflare`.
