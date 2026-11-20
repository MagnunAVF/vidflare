import { describe, expect, it } from 'vitest'

import { SEARCH_QUERY_MAX } from './limits'
import { searchQuery } from './search'

describe('searchQuery', () => {
  it('trims the text and keeps the cursor', () => {
    expect(searchQuery.parse({ q: '  cats  ', cursor: 'abc' })).toEqual({
      q: 'cats',
      cursor: 'abc',
    })
  })

  it('accepts any characters, FTS syntax included', () => {
    expect(searchQuery.parse({ q: '"a" OR b* NEAR(c)' }).q).toBe('"a" OR b* NEAR(c)')
  })

  it.each([
    ['missing', {}],
    ['empty', { q: '' }],
    ['blank', { q: '   ' }],
    ['too long', { q: 'x'.repeat(SEARCH_QUERY_MAX + 1) }],
  ])('rejects %s text', (_, input) => {
    expect(searchQuery.safeParse(input).success).toBe(false)
  })
})
