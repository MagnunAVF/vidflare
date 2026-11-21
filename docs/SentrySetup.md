# Sentry setup

How to connect vidflare to Sentry for errors, traces and session replays (on error only). The code is already wired; this is the account and configuration side. Commands are run from the repo root.

Without any of this, Sentry stays off: an empty DSN disables the SDK in the Worker and skips it entirely in the browser.

## What the app reads

| Setting | Where it lives | Used by | Secret? |
| --- | --- | --- | --- |
| `SENTRY_DSN` | Worker secret per environment (`wrangler secret put`); `.dev.vars` locally | Worker SDK | Treat as secret (it's not sensitive, but it's a runtime secret by convention) |
| `VITE_SENTRY_DSN` | GitHub variable `STAGE_SENTRY_DSN` / `PRODUCTION_SENTRY_DSN`, passed at build time; `apps/web/.env.local` locally | Browser SDK | No, it ends up in the public bundle |
| `SENTRY_AUTH_TOKEN` | GitHub secret | Source map upload in CI | **Yes**, CI only, never a Worker secret |
| `SENTRY_ORG`, `SENTRY_PROJECT` | GitHub variables | Source map upload in CI | No |
| Release | Automatic: the git sha (`VITE_RELEASE` for the client, `wrangler deploy --tag` for the Worker) | Both SDKs and the upload | — |
| Environment | Automatic: `local`, `stage` or `production` | Both SDKs | — |

## 1. Create the project

1. Sign in to [sentry.io](https://sentry.io) and pick (or create) the organization.
2. **Projects → Create Project**, platform **React** (the Worker reports into the same project). Name it `vidflare`.

One project holds the browser and the Worker; `environment` (`stage` / `production` / `local`) and the shared release keep them apart, and a browser trace continues into the Worker in the same project. Source maps for both bundles upload to it too.

The project slug (`vidflare`) is `SENTRY_PROJECT`. The organization slug (in the URL, `sentry.io/organizations/<slug>/`) is `SENTRY_ORG`.

## 2. Get the DSN

**Settings → Projects → vidflare → Client Keys (DSN)** and copy the DSN (`https://<key>@o<n>.ingest.<region>.sentry.io/<project-id>`).

The same DSN works for every environment; events are told apart by `environment`. If you'd rather keep stage noise out of production's quotas, create a second key in the same screen and use one per environment.

## 3. Lock down privacy in the project

The SDKs already send no cookies, headers (beyond a small allow-list), request bodies, query strings or IPs; only the user **id**. On top of that, both run `scrubSentryEvent` (`packages/shared/src/sentry-scrub.ts`) as `beforeSend` and `beforeSendTransaction`: `Cookie`, `Set-Cookie`, `Authorization` and `Webhook-Signature` become `[Filtered]`, and query strings are cut from request URLs, breadcrumbs and spans (search text lives in `?q=`). Add Sentry's server-side safety net on top:

**Settings → Projects → vidflare → Security & Privacy**
- **Data Scrubber**: on
- **Use Default Scrubbers**: on
- **Prevent Storing of IP Addresses**: on

Session replays already mask all text and block media in the client.

Optionally, **Inbound Filters → Filter out events coming from localhost**, so local testing never reaches the project unless you want it to.

## 4. Worker secret per environment

```sh
pnpm --filter web exec wrangler secret put SENTRY_DSN --env stage
pnpm --filter web exec wrangler secret put SENTRY_DSN --env production
```

Paste the DSN when prompted. Check with `pnpm --filter web exec wrangler secret list --env stage` (names only).

## 5. Auth token for source maps (CI)

**Settings → Developer Settings → Organization Tokens → Create New Token**, name it `vidflare-ci`. Organization tokens carry exactly the scopes needed to create releases and upload source maps. Copy it once; Sentry won't show it again.

It goes into GitHub only (next step). Never put it in `wrangler.jsonc`, `.dev.vars` or a Worker secret.

## 6. GitHub configuration

Repository **Settings → Secrets and variables → Actions**:

| Kind | Name | Value |
| --- | --- | --- |
| Secret | `SENTRY_AUTH_TOKEN` | the token from step 5 |
| Variable | `SENTRY_ORG` | organization slug |
| Variable | `SENTRY_PROJECT` | `vidflare` |
| Variable | `STAGE_SENTRY_DSN` | DSN for stage (step 2) |
| Variable | `PRODUCTION_SENTRY_DSN` | DSN for production (step 2) |

What CI then does on each deploy (`.github/workflows/deploy-stage.yml` and `deploy-production.yml`): builds with `VITE_SENTRY_DSN` and `VITE_RELEASE=<git sha>`, generates hidden source maps, uploads them for the client and Worker under that release, deletes the client maps so they're never served, and deploys the Worker with `--tag <git sha>` so it reports the same release.

A wrong or missing token only logs upload errors; the deploy still succeeds, but stack traces stay minified. Check the deploy log for `sentry-vite-plugin` errors after the first run.

## 7. Verify

After the first deploy to stage:

1. **Releases**: Sentry → Releases shows the git sha of the deploy, with source map artifacts attached.
2. **Error**: sign in on the stage URL, then open `/api/debug/error` in the same browser (the Phase 1 exit criterion). It answers `500 internal_error` and reports a `Sentry test error (stage, request <id>)` issue. The route needs a session, works on local and stage, and is a 404 in production. The issue should show `environment: stage`, the release sha, a readable (source-mapped) stack trace, and only `user.id`.
3. **Trace**: open the issue's trace. A browser page load should continue into the Worker request (`GET /api/...`) in the same trace.
4. **Nothing private**: in the event's request section there should be no cookie, body or query string, and no email anywhere.

## Local testing (optional)

Point a local session at Sentry to try changes to the instrumentation:

```sh
# apps/web/.dev.vars       (Worker)
SENTRY_DSN=<stage DSN>

# apps/web/.env.local      (client)
VITE_SENTRY_DSN=<stage DSN>
```

Events are tagged `environment: local`. Local builds never produce source maps. Leave both empty again when done (or keep the localhost inbound filter on).

## What the app sends

Beyond errors and traces (see "Observability with Sentry" in [Roadmap.md](Roadmap.md)):

- **Request names:** every Worker request's root span is named by its route pattern (`GET /api/videos/:id`, with `http.route` set), so latency groups by route, never by video id.
- **Custom spans:** `stream.create_upload` (op `http.client`), `queue.stream_event` (op `queue.process`, attribute `video.id`), `stats.flush`.
- **Application metrics** (Explore → Metrics):

| Metric | Kind | Attributes |
| --- | --- | --- |
| `upload.started` | counter | — |
| `upload.ready` | counter | `source`: `webhook` \| `recheck` |
| `upload.failed` | counter | `source`: `webhook` \| `recheck` \| `reconcile`; `reason`: Stream's error code or `abandoned` |
| `video.processing_time` | distribution (ms) | `source` |
| `webhook.signature_invalid` | counter | — |
| `auth.login_failed` | counter | `reason`: `invalid_credentials` \| `rate_limited` |
| `video.view_recorded` | counter | — |
| `stats.flush_rows` | distribution | views written to D1 per flush |
| `upload.client_duration` | distribution (ms) | browser |
| `player.start_time` | distribution (ms) | browser |

- **Cron monitor:** `reconcile-videos`, created by the first nightly run in each environment (schedule `0 3 * * *` UTC, 30 min check-in margin, 15 min max runtime).

## 8. Alerts

Create these once the first production deploy has sent data (the metrics and the cron monitor only appear after their first event). Scope every one to **environment `production`** unless noted, and send them to the team's channel (**Notify on preferred channel** → the team). Re-check the names here against Sentry's UI, which evolves.

| # | Alert | Type and source | Query / condition | Fires when |
| --- | --- | --- | --- | --- |
| 1 | New production issue | Alert on issues, **A new issue is created** | environment `production` | any new issue |
| 2 | `/api` 5xx rate | Monitor, dataset **Spans** | `span.op:http.server` and `http.route:/api/*`; value = requests with status ≥ 500 ÷ all requests (an equation of two counts) | above **2%** over **5 minutes** |
| 3 | Video detail latency | Monitor, dataset **Spans** | `span.op:http.server transaction:"GET /api/videos/:id"`, aggregate `p95(span.duration)` | above **500 ms** over 10 minutes |
| 4 | Upload failures | Monitor, dataset **Application Metrics** | `sum(upload.failed)` | above **5 in 1 hour** (or anomaly detection, once there's a few weeks of data) |
| 5 | Webhook signature | Monitor, dataset **Application Metrics** | `sum(webhook.signature_invalid)` | above **0** in 5 minutes |
| 6 | Nightly reconcile | Alert on issues from **specific monitors** → `reconcile-videos` | missed or failed check-ins become issues | any, in `stage` and `production` |

Notes:

- **#2 must count 5xx only.** Sentry's `failure_rate()` treats any non-OK status as a failure, including our expected 4xx answers (every signed-out page load gets a 401 from `/api/me`, unknown ids get 404s), so it would alert all the time.
- **#5** only means something in production: the account's single Stream webhook lands there. Any count is either a misconfigured `STREAM_WEBHOOK_SECRET` or someone probing the endpoint.
- **#6**: the monitor already knows its schedule from the Worker, so a night with no check-in, or a run that throws, becomes an issue. Set its failure tolerance to 1.
