import { describe, expect, it } from 'vitest'
import {
  competitorErrorMessage,
  parseCompetitorKeywords,
  toneShares,
} from './data'

describe('competitors data helpers', () => {
  it('splits keywords on commas and lines and drops repeats', () => {
    expect(parseCompetitorKeywords('Bakcell, bakcell\nBakcell LLC, ')).toEqual([
      'Bakcell',
      'Bakcell LLC',
    ])
    expect(parseCompetitorKeywords('  ')).toEqual([])
  })

  it('splits mentions into tone shares, the rest unlabelled', () => {
    expect(
      toneShares({ mentions: 10, positive: 5, neutral: 2, negative: 1 })
    ).toEqual({ positive: 50, neutral: 20, negative: 10, unlabelled: 20 })
    expect(
      toneShares({ mentions: 0, positive: 0, neutral: 0, negative: 0 })
    ).toBeNull()
  })

  it('explains database errors in plain words', () => {
    expect(
      competitorErrorMessage({ message: 'PLAN_COMPETITOR_LIMIT_REACHED' })
    ).toContain('rəqib limiti dolub')
    expect(competitorErrorMessage({ message: 'COMPETITOR_EXISTS' })).toContain(
      'artıq əlavə edilib'
    )
    expect(competitorErrorMessage({ message: 'boom' })).toBe('boom')
  })
})
