import { describe, it, expect } from 'vitest'
import { fuzzyMatch, highlightParts } from './fuzzy'

describe('fuzzyMatch', () => {
  it('matches a substring and returns contiguous indices', () => {
    const r = fuzzyMatch('hub', 'DragonHub')!
    expect(r).not.toBeNull()
    expect(r.indices).toEqual([6, 7, 8])
  })

  it('matches scattered subsequence', () => {
    const r = fuzzyMatch('dh', 'DragonHub')!
    expect(r).not.toBeNull()
    expect(r.indices).toEqual([0, 6]) // D ... h
  })

  it('rejects a non-match', () => {
    expect(fuzzyMatch('zzz', 'DragonHub')).toBeNull()
  })

  it('rejects widely-scattered noise for 3+ char queries', () => {
    expect(fuzzyMatch('xqz', 'DragonHub')).toBeNull()
  })

  it('is case + diacritic insensitive', () => {
    expect(fuzzyMatch('CAFE', 'Café')).not.toBeNull()
  })

  it('empty query matches everything with score 0', () => {
    const r = fuzzyMatch('   ', 'anything')!
    expect(r.score).toBe(0)
    expect(r.indices).toEqual([])
  })

  it('handles Arabic (tatweel/diacritics stripped)', () => {
    expect(fuzzyMatch('كتاب', 'كـتاب')).not.toBeNull()
  })
})

describe('highlightParts', () => {
  it('splits into hit/unhit runs', () => {
    const parts = highlightParts('abc', [0, 2])
    expect(parts).toEqual([{ s: 'a', hit: true }, { s: 'b', hit: false }, { s: 'c', hit: true }])
  })
  it('returns a single unhit part for empty indices', () => {
    expect(highlightParts('abc', [])).toEqual([{ s: 'abc', hit: false }])
  })
})
