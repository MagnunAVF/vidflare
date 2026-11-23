import { z } from 'zod'

import { TURNSTILE_TOKEN_MAX } from './limits'

// The Turnstile widget's response token, sent with sign-up, comment and upload forms and checked
// by the API against Cloudflare's siteverify. Single-use; '' until the widget has solved.
export const turnstileToken = z
  .string()
  .min(1, 'Complete the challenge')
  .max(TURNSTILE_TOKEN_MAX, 'Complete the challenge again')
