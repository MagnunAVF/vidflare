interface ImportMetaEnv {
  // Public Turnstile site key, set at build time per environment (falls back to Cloudflare's
  // always-pass test key in dev).
  readonly VITE_TURNSTILE_SITE_KEY?: string
  // Sentry (public DSN; empty in local dev keeps the SDK off).
  readonly VITE_SENTRY_DSN?: string
  // 'local' | 'stage' | 'production', derived from CLOUDFLARE_ENV in vite.config.ts.
  readonly VITE_ENVIRONMENT: string
  // Git sha of the build (set by CI), shared with the Worker's release.
  readonly VITE_RELEASE?: string
}
