interface ImportMetaEnv {
  // Public Turnstile site key, set at build time per environment (falls back to Cloudflare's
  // always-pass test key in dev).
  readonly VITE_TURNSTILE_SITE_KEY?: string
}
