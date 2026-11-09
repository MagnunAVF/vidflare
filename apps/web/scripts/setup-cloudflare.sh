#!/usr/bin/env bash
# Creates the Cloudflare resources for one environment and fills their ids into wrangler.jsonc.
# Idempotent: anything that already exists is reused, never recreated or deleted.
#
# Usage: pnpm --filter web cf:setup <stage|production>
# Needs `wrangler login` (or CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID) for the target account.
set -euo pipefail

ENV_NAME="${1:-}"
case "$ENV_NAME" in
  stage | production) ;;
  *)
    echo "usage: $0 <stage|production>" >&2
    exit 2
    ;;
esac

cd "$(dirname "$0")/.."
CONFIG="wrangler.jsonc"
D1_NAME="vidflare-db-$ENV_NAME"
KV_NAME="CACHE-$ENV_NAME"
R2_NAME="vidflare-media-$ENV_NAME"
QUEUE_NAME="stream-events-$ENV_NAME"

wrangler() { pnpm exec wrangler "$@"; }

# Prints the value of `field` for the first JSON array item whose `key` equals `value` (stdin).
json_find() {
  node -e '
    let s = ""
    process.stdin.on("data", (d) => (s += d)).on("end", () => {
      const [key, value, field] = process.argv.slice(1)
      const hit = JSON.parse(s).find((x) => x[key] === value)
      if (hit) console.log(hit[field])
    })' "$@"
}

# Replaces the placeholder for `kind` (D1 or KV) in this env's block of wrangler.jsonc with `id`.
fill_id() {
  local kind="$1" id="$2"
  node -e '
    const fs = require("fs")
    const [file, env, kind, id] = process.argv.slice(1)
    const placeholder = `<${env} ${kind} id from scripts/setup-cloudflare.sh>`
    const text = fs.readFileSync(file, "utf8")
    if (text.includes(placeholder)) {
      fs.writeFileSync(file, text.replace(placeholder, id))
      console.log(`  wrote ${kind} id to ${file}`)
    } else if (text.includes(id)) {
      console.log(`  ${file} already has this ${kind} id`)
    } else {
      console.error(`  ${file} has a different ${kind} id for ${env}; check it by hand (found ${id})`)
      process.exitCode = 1
    }' "$CONFIG" "$ENV_NAME" "$kind" "$id"
}

if ! wrangler whoami >/dev/null 2>&1; then
  echo "Not logged in. Run 'pnpm --filter web exec wrangler login' or export CLOUDFLARE_API_TOKEN." >&2
  exit 1
fi
echo "Setting up '$ENV_NAME' in: $(wrangler whoami 2>/dev/null | grep -i -m1 'account' || echo 'current account')"

echo "D1 $D1_NAME"
d1_id="$(wrangler d1 list --json 2>/dev/null | json_find name "$D1_NAME" uuid)"
if [[ -z "$d1_id" ]]; then
  wrangler d1 create "$D1_NAME" >/dev/null
  d1_id="$(wrangler d1 list --json 2>/dev/null | json_find name "$D1_NAME" uuid)"
  echo "  created"
else
  echo "  exists"
fi
[[ -n "$d1_id" ]] || { echo "  could not read the D1 id" >&2; exit 1; }
fill_id D1 "$d1_id"

echo "KV $KV_NAME"
kv_id="$(wrangler kv namespace list 2>/dev/null | json_find title "$KV_NAME" id)"
if [[ -z "$kv_id" ]]; then
  wrangler kv namespace create "$KV_NAME" >/dev/null
  kv_id="$(wrangler kv namespace list 2>/dev/null | json_find title "$KV_NAME" id)"
  echo "  created"
else
  echo "  exists"
fi
[[ -n "$kv_id" ]] || { echo "  could not read the KV id" >&2; exit 1; }
fill_id KV "$kv_id"

echo "R2 $R2_NAME"
if wrangler r2 bucket info "$R2_NAME" >/dev/null 2>&1; then
  echo "  exists"
else
  wrangler r2 bucket create "$R2_NAME" >/dev/null
  echo "  created"
fi

echo "Queue $QUEUE_NAME"
if wrangler queues info "$QUEUE_NAME" >/dev/null 2>&1; then
  echo "  exists"
else
  wrangler queues create "$QUEUE_NAME" >/dev/null
  echo "  created"
fi

echo "Done. Next: pnpm --filter web exec wrangler types, then review and commit $CONFIG."
