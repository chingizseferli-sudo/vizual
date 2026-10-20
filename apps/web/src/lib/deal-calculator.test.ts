import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ASSUMPTIONS,
  DEFAULT_INPUT,
  calculateDeal,
  closestPlan,
  roundNicePrice,
} from './deal-calculator'

const proLike = {
  ...DEFAULT_INPUT,
  socialKeywords: 10,
  intervalHours: 24,
  fbNewPostsPerKeywordPerDay: 15,
}

describe('calculateDeal', () => {
  it('matches the Excel Pro row for social costs', () => {
    const result = calculateDeal(proLike, DEFAULT_ASSUMPTIONS)
    expect(result.fbPostsPerMonth).toBe(4500)
    expect(result.facebookAzn).toBeCloseTo(18.36, 2)
    expect(result.igRequestsPerMonth).toBe(300)
    expect(result.instagramAzn).toBeCloseTo(0.82, 2)
  })

  it('caps Facebook posts by checks per day times posts per check', () => {
    const result = calculateDeal(
      { ...proLike, fbNewPostsPerKeywordPerDay: 50, socialKeywords: 1 },
      DEFAULT_ASSUMPTIONS
    )
    expect(result.fbPostsPerMonth).toBe(30 * 20)
  })

  it('drops platforms that are not selected', () => {
    const result = calculateDeal(
      { ...proLike, facebook: false, instagram: false },
      DEFAULT_ASSUMPTIONS
    )
    expect(result.facebookAzn).toBe(0)
    expect(result.instagramAzn).toBe(0)
  })

  it('suggested price gives the target margin on net revenue', () => {
    const result = calculateDeal(
      { ...proLike, targetMarginPercent: 50, discountPercent: 0 },
      DEFAULT_ASSUMPTIONS
    )
    const net = result.suggestedPriceAzn / 1.18
    const profit = net - result.suggestedPriceAzn * 0.025 - result.costAzn
    expect(profit / net).toBeCloseTo(0.5, 6)
    expect(result.roundedPriceAzn).toBeGreaterThanOrEqual(result.suggestedPriceAzn)
  })

  it('discount lowers the final price and profit', () => {
    const full = calculateDeal(proLike, DEFAULT_ASSUMPTIONS)
    const discounted = calculateDeal(
      { ...proLike, discountPercent: 20 },
      DEFAULT_ASSUMPTIONS
    )
    expect(discounted.finalPriceAzn).toBeCloseTo(full.roundedPriceAzn * 0.8, 6)
    expect(discounted.profitAzn).toBeLessThan(full.profitAzn)
    expect(discounted.contractProfitAzn).toBeCloseTo(discounted.profitAzn * 12, 6)
  })

  it('spreads fixed costs over paying customers', () => {
    const one = calculateDeal({ ...proLike, payingCustomers: 1 }, DEFAULT_ASSUMPTIONS)
    const many = calculateDeal({ ...proLike, payingCustomers: 10 }, DEFAULT_ASSUMPTIONS)
    expect(one.infraShareAzn).toBeCloseTo(many.infraShareAzn * 10, 6)
  })
})

describe('helpers', () => {
  it('rounds prices up to end in 9', () => {
    expect(roundNicePrice(113.2)).toBe(119)
    expect(roundNicePrice(119)).toBe(119)
    expect(roundNicePrice(119.5)).toBe(129)
    expect(roundNicePrice(0)).toBe(0)
  })

  it('finds the closest plan by price', () => {
    const plans = [
      { code: 'start', price_amount: 39 },
      { code: 'pro', price_amount: 119 },
      { code: 'custom', price_amount: null },
    ]
    expect(closestPlan(plans, 100)?.code).toBe('pro')
    expect(closestPlan(plans, 50)?.code).toBe('start')
  })
})
