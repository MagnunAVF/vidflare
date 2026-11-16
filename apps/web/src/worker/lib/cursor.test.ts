import { describe, expect, it } from 'vitest'

import { decodeCursor, encodeCursor } from './cursor'
import { base64url } from './encoding'

const encode = (text: string) => base64url(new TextEncoder().encode(text))

describe('feed cursor', () => {
  it('round-trips and is opaque', () => {
    const position = { publishedAt: 1_800_000_000_000, id: '01a0f9e9-2000-7000-8000-000000000007' }
    const cursor = encodeCursor(position)
    expect(cursor).toMatch(/^[\w-]+$/)
    expect(decodeCursor(cursor)).toEqual(position)
  })

  it.each([
    ['not base64url', '!!!'],
    ['no separator', encode('1800000000000')],
    ['a bad id', encode('1.abc')],
    ['a negative time', encode('-1.01a0f9e9-2000-7000-8000-000000000007')],
    ['SQL in the id', encode("1.x' OR 1=1 --------------------------")],
  ])('rejects %s', (_, cursor) => {
    expect(decodeCursor(cursor)).toBeNull()
  })
})
