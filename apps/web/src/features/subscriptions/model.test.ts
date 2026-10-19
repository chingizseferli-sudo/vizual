import { describe, expect, it } from 'vitest'
import {
  buildPlanPayload,
  emptyPlanForm,
  formatPlanPrice,
  normalizePlanCode,
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
      historyDays: '90',
      displayOrder: '20',
      features: 'Telegram\nCSV ixrac\nTelegram',
    })

    expect(result.error).toBeUndefined()
    expect(result.data).toMatchObject({
      code: 'professional',
      price_amount: 79.9,
      max_watches: 100,
      minimum_interval_minutes: 5,
      history_days: 90,
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
