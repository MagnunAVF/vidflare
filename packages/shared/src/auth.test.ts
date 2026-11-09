import { describe, expect, it } from 'vitest'

import { loginInput, signupInput } from './auth'

const valid = {
  email: 'alice@example.com',
  password: 'correct horse',
  handle: 'alice',
  name: 'Alice Codes',
  turnstileToken: 'token',
}

describe('signupInput', () => {
  it('normalizes email and handle', () => {
    const parsed = signupInput.parse({
      ...valid,
      email: '  Alice@Example.COM ',
      handle: ' Alice_1 ',
    })
    expect(parsed.email).toBe('alice@example.com')
    expect(parsed.handle).toBe('alice_1')
  })

  it.each([
    ['email', 'not-an-email'],
    ['password', 'short'],
    ['handle', 'ab'],
    ['handle', 'has space'],
    ['handle', 'dash-ed'],
    ['name', '   '],
    ['turnstileToken', ''],
  ])('rejects a bad %s (%j)', (field, value) => {
    const result = signupInput.safeParse({ ...valid, [field]: value })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual([field])
  })
})

describe('loginInput', () => {
  it('accepts any non-empty password and normalizes the email', () => {
    expect(loginInput.parse({ email: 'A@B.CO', password: 'x' })).toEqual({
      email: 'a@b.co',
      password: 'x',
    })
  })
})
