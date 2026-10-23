import { describe, expect, it } from 'vitest'
import { estimateCheckCost, formatCostUsd, remainingBudget } from './check-cost'

describe('check cost estimate', () => {
  it('prices Facebook per post, Instagram per call and YouTube in quota units', () => {
    const cost = estimateCheckCost(
      { facebookKeywords: 20, instagramKeywords: 18, instagramPages: 2, youtubeKeywords: 3 },
      10
    )
    expect(cost.facebookUsd).toBeCloseTo(0.48)
    expect(cost.instagramUsd).toBeCloseTo((20 * 29) / 18000)
    expect(cost.totalUsd).toBeCloseTo(0.48 + (20 * 29) / 18000)
    expect(cost.youtubeUnits).toBe(300)
  })

  it('shows what is left of a budget, never below zero', () => {
    expect(remainingBudget(null, 5)).toBeNull()
    expect(remainingBudget(10, 4.5)).toBe(5.5)
    expect(remainingBudget(10, 12)).toBe(0)
    expect(formatCostUsd(0.0016)).toBe('<$0.01')
    expect(formatCostUsd(0)).toBe('$0.00')
    expect(formatCostUsd(1.234)).toBe('$1.23')
  })
})
