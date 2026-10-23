import { describe, expect, it } from 'vitest'
import {
  buildPlanPayload,
  emptyPlanForm,
  formatPlanPrice,
  normalizePlanCode,
  planCompetitorLimit,
  planKeywordLimit,
  planReportFrequencies,
  planSocialKeywordLimit,
  planSocialPlatforms,
  planToFormValues,
  normalizePlanRow,
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

  it('stores the email reports a plan includes in a fixed order', () => {
    const plan = buildPlanPayload(
      {
        ...emptyPlanForm,
        name: 'Biznes',
        reportFrequencies: ['monthly', 'daily'],
      },
      { report_frequencies: ['weekly'], other: 1 }
    ).data!
    expect(plan.limits).toEqual({
      other: 1,
      report_frequencies: ['daily', 'monthly'],
    })
    expect(planReportFrequencies(plan)).toEqual(['daily', 'monthly'])

    const none = buildPlanPayload(
      { ...emptyPlanForm, name: 'Demo' },
      { report_frequencies: ['weekly'] }
    ).data!
    expect(none.limits).toEqual({})
    expect(planReportFrequencies({ limits: { report_frequencies: 'x' } })).toEqual([])

    const row = normalizePlanRow({
      id: 'p',
      code: 'pro',
      name: 'Pro',
      description: null,
      is_active: true,
      is_custom: false,
      is_public: true,
      price_amount: 119,
      currency: 'AZN',
      billing_interval: 'month',
      display_order: 1,
      max_watches: null,
      minimum_interval_minutes: null,
      history_days: 30,
      telegram_enabled: true,
      features: [],
      limits: { report_frequencies: ['weekly', 'daily', 'hourly'] },
    })
    expect(planToFormValues(row).reportFrequencies).toEqual(['daily', 'weekly'])
  })

  it('stores the competitor limit; no limit means no competitors', () => {
    const plan = buildPlanPayload(
      { ...emptyPlanForm, name: 'Pro', maxCompetitors: '3' },
      { max_competitors: 5, max_keywords: 20 }
    ).data!
    expect(plan.limits).toEqual({ max_competitors: 3 })
    expect(planCompetitorLimit(plan)).toBe(3)

    const cleared = buildPlanPayload(
      { ...emptyPlanForm, name: 'Pro' },
      { max_competitors: 5 }
    ).data!
    expect(cleared.limits).toEqual({})
    expect(planCompetitorLimit(cleared)).toBe(0)
    expect(
      buildPlanPayload({ ...emptyPlanForm, name: 'Pro', maxCompetitors: '-1' }).error
    ).toContain('Rəqib limiti')
  })

  it('stores the social keyword limit; 0 is kept, empty means unlimited', () => {
    const none = buildPlanPayload(
      { ...emptyPlanForm, name: 'Başlanğıc', maxSocialKeywords: '0' },
      { max_social_keywords: 10 }
    ).data!
    expect(none.limits).toEqual({ max_social_keywords: 0 })
    expect(planSocialKeywordLimit(none)).toBe(0)
    expect(planToFormValues(normalizePlanRow({ ...none, id: 'p', is_active: true })).maxSocialKeywords).toBe('0')

    const unlimited = buildPlanPayload(
      { ...emptyPlanForm, name: 'Korporativ' },
      { max_social_keywords: 10 }
    ).data!
    expect(unlimited.limits).toEqual({})
    expect(planSocialKeywordLimit(unlimited)).toBeNull()
    expect(
      buildPlanPayload({ ...emptyPlanForm, name: 'Pro', maxSocialKeywords: '2.5' }).error
    ).toContain('Sosial açar söz limiti')
  })

  it('stores the social platforms only when they differ from FB + IG', () => {
    const business = buildPlanPayload({
      ...emptyPlanForm,
      name: 'Biznes',
      socialPlatforms: ['youtube', 'facebook', 'instagram'],
    }).data!
    expect(business.limits).toEqual({
      social_platforms: ['facebook', 'instagram', 'youtube'],
    })
    expect(planSocialPlatforms(business)).toEqual(['facebook', 'instagram', 'youtube'])
    expect(
      planToFormValues(normalizePlanRow({ ...business, id: 'p', is_active: true }))
        .socialPlatforms
    ).toEqual(['facebook', 'instagram', 'youtube'])

    const standard = buildPlanPayload(
      { ...emptyPlanForm, name: 'Pro' },
      { social_platforms: ['facebook', 'instagram', 'youtube'] }
    ).data!
    expect(standard.limits).toEqual({})
    expect(planSocialPlatforms({ limits: {} })).toEqual(['facebook', 'instagram'])
    expect(planSocialPlatforms({ limits: { social_platforms: [] } })).toEqual([])
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
