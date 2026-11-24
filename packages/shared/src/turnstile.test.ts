import { describe, expect, it } from 'vitest'

import { TURNSTILE_TOKEN_MAX } from './limits'
import { turnstileToken } from './turnstile'

describe('turnstileToken', () => {
  it('accepts a token up to the documented maximum', () => {
    expect(turnstileToken.safeParse('t'.repeat(TURNSTILE_TOKEN_MAX)).success).toBe(true)
  })

  it.each([
    ['empty', ''],
    ['too long', 't'.repeat(TURNSTILE_TOKEN_MAX + 1)],
  ])('rejects an %s token', (_, token) => {
    expect(turnstileToken.safeParse(token).success).toBe(false)
  })
})
