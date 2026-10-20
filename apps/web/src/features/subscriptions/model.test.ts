import { describe, expect, it } from 'vitest'
import {
  buildPlanPayload,
  emptyPlanForm,
  formatPlanPrice,
  normalizePlanCode,
  planKeywordLimit,
} from './model'

describe('subscription plan model', () => {
  it('normalizes Azerbaijani names into stable plan codes', () => {
    expect(normalizePlanCode('Peşəkar İllik Plan')).toBe('pesekar_illik_plan')
  })

  it('builds a validated plan payload and removes duplicate features', () => {
    const result = buildPlanPayload({
      ...emptyPlanForm,
      name: 'Professional',
      priceAmount: '79.90',
      maxWatches: '100',
      minimumIntervalMinutes: '5',
      historyDays: '30',
      displayOrder: '20',
      features: 'Telegram\nCSV ixrac\nTelegram',
    })

    expect(result.error).toBeUndefined()
    expect(result.data).toMatchObject({
      code: 'professional',
      price_amount: 79.9,
      max_watches: 100,
      minimum_interval_minutes: 5,
      history_days: 30,
      features: ['Telegram', 'CSV ixrac'],
    })
  })

  it('rejects invalid numeric limits', () => {
    const result = buildPlanPayload({
      ...emptyPlanForm,
      name: 'Invalid',
      minimumIntervalMinutes: '0',
    })

    expect(result.error).toContain('Minimum interval')
  })

  it('keeps other limits and validates the social interval', () => {
    const base = { other: true, social_interval_minutes: 360 }
    const twoHours = buildPlanPayload(
      { ...emptyPlanForm, name: 'Pro', socialIntervalMinutes: '120' },
      base
    )
    expect(twoHours.data?.limits).toEqual({
      other: true,
      social_interval_minutes: 120,
    })

    const standard = buildPlanPayload({ ...emptyPlanForm, name: 'Pro' }, base)
    expect(standard.data?.limits).toEqual({ other: true })

    const invalid = buildPlanPayload({
      ...emptyPlanForm,
      name: 'Pro',
      socialIntervalMinutes: '45',
    })
    expect(invalid.error).toContain('Sosial yoxlama')
  })

  it('stores the keyword limit and falls back to 20 per web watch', () => {
    const plan = buildPlanPayload(
      { ...emptyPlanForm, name: 'Pro', maxKeywords: '50', maxWatches: '3' },
      { max_keywords: 10 }
    ).data!
    expect(plan.limits).toEqual({ max_keywords: 50 })
    expect(planKeywordLimit(plan)).toBe(50)

    const cleared = buildPlanPayload(
      { ...emptyPlanForm, name: 'Pro', maxWatches: '3' },
      { max_keywords: 10 }
    ).data!
    expect(cleared.limits).toEqual({})
    expect(planKeywordLimit(cleared)).toBe(60)
    expect(planKeywordLimit({ limits: {}, max_watches: null })).toBeNull()
  })

  it('formats recurring and custom prices', () => {
    expect(
      formatPlanPrice({
        price_amount: 29,
        currency: 'AZN',
        billing_interval: 'month',
      })
    ).toBe('29 AZN / ay')
    expect(
      formatPlanPrice({
        price_amount: null,
        currency: 'AZN',
        billing_interval: 'custom',
      })
    ).toBe('Fərdi qiymət')
  })
})
