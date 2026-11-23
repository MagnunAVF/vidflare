import { describe, expect, it } from 'vitest'

import { SEARCH_MAX_TERMS, toFtsQuery } from './search'

describe('toFtsQuery', () => {
  it('quotes every word and makes the last one a prefix', () => {
    expect(toFtsQuery('sourdough starter')).toBe('"sourdough" "starter"*')
    expect(toFtsQuery('cats')).toBe('"cats"*')
  })

  it('turns FTS5 syntax into plain words', () => {
    expect(toFtsQuery('"a" OR b* NEAR(c) -d title:e')).toBe(
      '"a" "OR" "b" "NEAR" "c" "d" "title" "e"*',
    )
  })

  it('keeps letters from any script, digits and accents', () => {
    expect(toFtsQuery('Crème brûlée 2024')).toBe('"Crème" "brûlée" "2024"*')
    expect(toFtsQuery('東京 café')).toBe('"東京" "café"*')
  })

  it(`uses at most ${SEARCH_MAX_TERMS} words`, () => {
    const words = Array.from({ length: SEARCH_MAX_TERMS + 3 }, (_, i) => `w${i}`)
    const query = toFtsQuery(words.join(' '))!
    expect(query.split(' ')).toHaveLength(SEARCH_MAX_TERMS)
    expect(query.endsWith(`"w${SEARCH_MAX_TERMS - 1}"*`)).toBe(true)
  })

  it.each(['', '   ', '!!! ---', '"*"'])('returns null for %j', (text) => {
    expect(toFtsQuery(text)).toBeNull()
  })
})
