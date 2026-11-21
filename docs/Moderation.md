# Moderation: reports and manual takedown

Viewers report videos from the watch page. A person reviews each report and, when a video breaks the rules, takes it down with the moderation API. There is no moderation UI in the MVP (moderation tooling is post-MVP in the roadmap); the API below is called with `curl`.

## How it works

- **Reporting:** any signed-in viewer can report a video they can watch (not their own) from the **Report** button: a reason (copyright, sexual, violence, harassment, illegal, spam, other) and optional details. One report per viewer per video; reporting again changes nothing. Reports never hide a video by themselves.
- **Takedown:** sets `videos.taken_down_at`, marks the video's open reports `actioned`, purges its KV cache keys and turns on `requireSignedURLs` in Stream. From then on the video is gone from every listing, search and its watch page (404 for everyone, the owner included), and it can't be viewed, liked, commented on or reported. The owner sees **Taken down** in the studio. The Stream video is kept, and it still counts toward the creator's storage.
- **Restore:** turns `requireSignedURLs` off, clears `taken_down_at` and purges the cache. Reports stay `actioned`.
- **Dismiss:** marks a report `dismissed` when no action is needed.

Stream applies `requireSignedURLs` within seconds, in both directions. A manifest or segment URL already cached at the CDN can keep playing for anyone who had it open until that cache expires (minutes); new requests are refused (401).

## Setup

Each environment has its own `MODERATION_TOKEN` secret (see [CloudflareSetup.md](CloudflareSetup.md)). It's required: `wrangler deploy` fails while it's unset.

```sh
openssl rand -hex 32 | pnpm --filter web exec wrangler secret put MODERATION_TOKEN --env stage
openssl rand -hex 32 | pnpm --filter web exec wrangler secret put MODERATION_TOKEN --env production
```

Keep the value in the team's password manager. Without it the API answers 401; with no secret set (e.g. local dev without one in `.dev.vars`) the routes answer 404.

## Runbook

```sh
BASE=https://<environment domain>
AUTH="Authorization: Bearer $MODERATION_TOKEN"

# 1. Review the queue (newest first; ?status=open|actioned|dismissed, ?cursor=<nextCursor>)
curl -s -H "$AUTH" "$BASE/api/moderation/reports" | jq

# 2. Watch the video (/watch/<video.id>) and decide.

# 3a. Take it down (idempotent; if it fails, run it again)
curl -s -X POST -H "$AUTH" "$BASE/api/moderation/videos/<video id>/takedown"

# 3b. Or close the report without action
curl -s -X POST -H "$AUTH" "$BASE/api/moderation/reports/<report id>/dismiss"

# Undo a takedown
curl -s -X POST -H "$AUTH" "$BASE/api/moderation/videos/<video id>/restore"
```

Every takedown and restore is logged (`video.taken_down`, `video.restored`, with the video id) and shows up in Sentry logs; a wrong token logs `moderation.unauthorized`. Report details are free text written by viewers: they are only returned by this API, never logged.

## Not covered yet

- Copyright holders without an account can't report. Publish a contact address for takedown notices before the public launch, and handle those notices with the same API.
- There is no notice to the creator or the reporter; contact them by hand if needed.
