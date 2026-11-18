import { describe, expect, it } from 'vitest'

import { commentIdParam, createCommentInput } from './comment'
import { COMMENT_MAX } from './limits'

describe('createCommentInput', () => {
  it('trims the body', () => {
    expect(createCommentInput.parse({ body: '  Nice video \n', turnstileToken: 't' })).toEqual({
      body: 'Nice video',
      turnstileToken: 't',
    })
  })

  it.each([
    ['body', '   '],
    ['body', 'x'.repeat(COMMENT_MAX + 1)],
    ['turnstileToken', ''],
  ])('rejects a bad %s', (field, value) => {
    const result = createCommentInput.safeParse({ body: 'ok', turnstileToken: 't', [field]: value })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual([field])
  })

  it('accepts a body at the limit', () => {
    expect(
      createCommentInput.safeParse({ body: 'x'.repeat(COMMENT_MAX), turnstileToken: 't' }).success,
    ).toBe(true)
  })
})

describe('commentIdParam', () => {
  it('accepts UUIDs only', () => {
    expect(commentIdParam.safeParse({ id: '01a0fc85-75c0-7000-8000-000000000016' }).success).toBe(
      true,
    )
    expect(commentIdParam.safeParse({ id: '42' }).success).toBe(false)
  })
})
