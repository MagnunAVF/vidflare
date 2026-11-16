import { Turnstile, type TurnstileInstance } from '@marsidev/react-turnstile'
import type { RefObject } from 'react'

// Cloudflare's public always-pass test key, used in dev when no site key is configured.
const TURNSTILE_TEST_SITE_KEY = '1x00000000000000000000AA'
const turnstileSiteKey =
  import.meta.env.VITE_TURNSTILE_SITE_KEY ?? (import.meta.env.DEV ? TURNSTILE_TEST_SITE_KEY : '')

// The Turnstile widget for forms that the API checks (sign-up, upload, comment). It reports
// the token, or '' when it expires or fails. Tokens are single-use: call ref.current?.reset()
// after each submit attempt that used one.
// Props are destructured: the hooks lint treats every `props.x` as a ref read once props has a ref.
export function TurnstileField({
  ref,
  onToken,
  error,
}: {
  ref: RefObject<TurnstileInstance | undefined>
  onToken: (token: string) => void
  error?: string
}) {
  return (
    <div className="grid gap-2">
      <Turnstile
        ref={ref}
        siteKey={turnstileSiteKey}
        options={{ theme: 'auto', size: 'flexible' }}
        onSuccess={onToken}
        onExpire={() => onToken('')}
        onError={() => onToken('')}
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}
