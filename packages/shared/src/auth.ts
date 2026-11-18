import { z } from 'zod'

import {
  CHANNEL_NAME_MAX,
  EMAIL_MAX,
  HANDLE_MAX,
  HANDLE_MIN,
  HANDLE_PATTERN,
  PASSWORD_MAX,
  PASSWORD_MIN,
} from './limits'

// Normalized before validation so `Alice@Example.com ` and `alice@example.com` are one account.
const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Enter a valid email').max(EMAIL_MAX, 'Email is too long'))

// A channel handle: lowercase, as it appears in /c/$handle. Shared by sign-up and channel routes.
export const channelHandle = z
  .string()
  .trim()
  .toLowerCase()
  .min(HANDLE_MIN, `At least ${HANDLE_MIN} characters`)
  .max(HANDLE_MAX, `At most ${HANDLE_MAX} characters`)
  .regex(HANDLE_PATTERN, 'Use lowercase letters, numbers and underscores')

export const signupInput = z.object({
  email,
  password: z
    .string()
    .min(PASSWORD_MIN, `At least ${PASSWORD_MIN} characters`)
    .max(PASSWORD_MAX, `At most ${PASSWORD_MAX} characters`),
  handle: channelHandle,
  name: z
    .string()
    .trim()
    .min(1, 'Enter a channel name')
    .max(CHANNEL_NAME_MAX, `At most ${CHANNEL_NAME_MAX} characters`),
  turnstileToken: z.string().min(1, 'Complete the challenge'),
})
export type SignupInput = z.input<typeof signupInput>

// No minimum length on login: the check is against the stored hash, not the policy.
export const loginInput = z.object({
  email,
  password: z.string().min(1, 'Enter your password').max(PASSWORD_MAX),
})
export type LoginInput = z.input<typeof loginInput>

// What signup, login and GET /api/me return. Never the password hash or session id.
export const meResponse = z.object({
  user: z.object({ id: z.string(), email: z.string() }),
  channel: z.object({
    id: z.string(),
    handle: z.string(),
    name: z.string(),
    avatarKey: z.string().nullable(),
  }),
})
export type MeResponse = z.infer<typeof meResponse>
