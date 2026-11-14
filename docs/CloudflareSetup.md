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

Then apply the D1 schema remotely (after that, CI does it on every deploy: push to `dev` for stage, push to `main` for production):

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

Both environments share this account's Stream library, and `STREAM_ACCOUNT_ID` is the same value in both. Stream has a single webhook URL per account, so it points at production, which routes each event to the right environment's queue by the upload's `meta.env`. The design is in the roadmap under "Stream across environments".

4. Register the webhook once the production Worker serves `/api/webhooks/stream` (Phase 2): set the account's webhook URL to `https://<production domain>/api/webhooks/stream`. Stream returns the signing secret; store it as production's `STREAM_WEBHOOK_SECRET`.

## 4. Secrets per environment

Set each one per environment. Piping a value keeps it out of your shell history; `wrangler secret put NAME --env <env>` with no pipe prompts for it instead.

| Secret | Where the value comes from |
| --- | --- |
| `STREAM_ACCOUNT_ID` | Step 3 (same account id in both environments) |
| `STREAM_API_TOKEN` | Step 3 (that environment's own token) |
| `STREAM_WEBHOOK_SECRET` | production: the secret Stream returns in step 3.4 (Phase 2). stage: any generated value (`openssl rand -hex 32`), since real webhooks never reach stage directly; it only signs replayed test payloads. |
| `TURNSTILE_SECRET` | Dashboard → **Turnstile** → add a widget per environment with that environment's hostname(s) → secret key. The widget's public **site key** isn't a secret: pass it at build time as `VITE_TURNSTILE_SITE_KEY` (for example `VITE_TURNSTILE_SITE_KEY=<key> pnpm deploy:stage`, or a CI variable). |
| `AUTH_SECRET` | Generate: `openssl rand -hex 32 \| pnpm exec wrangler secret put AUTH_SECRET --env stage` (new value per environment) |
| `SENTRY_DSN` | The Sentry project's DSN; see [SentrySetup.md](SentrySetup.md) |

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

Normally you don't deploy by hand: CI does it (next section).

## 6. CI (GitHub Actions)

| Workflow | Trigger | Does | Needs |
| --- | --- | --- | --- |
| `ci.yml` | every PR, push to main | format check, typecheck, lint, tests, build | nothing |
| `preview.yml` | PRs from this repo | uploads a version of `vidflare-stage` with alias `pr-<n>` and comments the preview URL | secrets + `STAGE_TURNSTILE_SITE_KEY` |
| `deploy-stage.yml` | push to `dev` | `ci.yml`, then stage's remote D1 migrations, then deploy `vidflare-stage` | everything below (stage values) |
| `deploy-production.yml` | push to `main` | `ci.yml`, then production's remote D1 migrations, then deploy `vidflare-production` | everything below (production values) |

`preview.yml` and both deploy workflows skip with a notice until the Cloudflare secrets exist, and each deploy workflow stops while `wrangler.jsonc` still has placeholder ids for its environment (step 2).

1. **API token for CI.** Dashboard → **My Profile → API Tokens → Create Token**, starting from the *Edit Cloudflare Workers* template, then add *Account · D1 · Edit* and *Account · Queues · Edit* (needed for remote migrations and the queue consumer). Limit it to this account.
2. **Repository secrets** (Settings → Secrets and variables → Actions → Secrets): `CLOUDFLARE_API_TOKEN` (step 1), `CLOUDFLARE_ACCOUNT_ID`, and `SENTRY_AUTH_TOKEN` (a Sentry organization auth token with release and source map upload scope; CI only, never a Worker secret).
3. **Repository variables** (same page → Variables):
   - `STAGE_TURNSTILE_SITE_KEY`, `PRODUCTION_TURNSTILE_SITE_KEY`: the public site keys from step 4's Turnstile widgets
   - `STAGE_SENTRY_DSN`, `PRODUCTION_SENTRY_DSN`: the client DSN for each environment (public; usually the same value as that environment's `SENTRY_DSN` Worker secret)
   - `SENTRY_ORG`, `SENTRY_PROJECT`: where source maps are uploaded (all Sentry values: [SentrySetup.md](SentrySetup.md))

Each deploy uses the git sha as the Sentry release everywhere: the client build reports it (`VITE_RELEASE`), the Worker is deployed with `--tag <sha>` (read back from `CF_VERSION_METADATA.tag`), and the Sentry Vite plugin uploads hidden source maps for both bundles under that release, then deletes the client maps so they are never served. Builds without `SENTRY_AUTH_TOKEN` (local, previews) produce no source maps. A wrong token only logs upload errors; it doesn't fail the deploy.
4. **Environments** (Settings → Environments): `stage` and `production` are created on the first run. Add required reviewers to `production` if production deploys should wait for an approval.

Previews run the PR's code against stage's resources and don't apply the PR's migrations, so a PR that adds a migration only works fully on stage after it merges. Migrations run before each deploy, so every migration must also work with the code that is still live.
