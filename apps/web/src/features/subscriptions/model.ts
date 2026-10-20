export const BILLING_INTERVALS = [
  'month',
  'year',
  'one_time',
  'custom',
] as const

type BillingInterval = (typeof BILLING_INTERVALS)[number]

export type SubscriptionPlan = {
  id: string
  code: string
  name: string
  description: string | null
  is_active: boolean
  is_custom: boolean
  is_public: boolean
  price_amount: number | null
  currency: string
  billing_interval: BillingInterval
  display_order: number
  max_watches: number | null
  minimum_interval_minutes: number | null
  history_days: number | null
  telegram_enabled: boolean
  features: string[]
  limits: Record<string, unknown>
  created_at?: string | null
  updated_at?: string | null
}

export type UserSubscription = {
  id: string
  user_id: string
  plan_id: string
  status: 'trialing' | 'active' | 'canceled' | 'expired'
  started_at: string
  current_period_end: string | null
  ended_at: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export type PlanFormValues = {
  code: string
  name: string
  description: string
  priceAmount: string
  currency: string
  billingInterval: BillingInterval
  displayOrder: string
  maxWatches: string
  minimumIntervalMinutes: string
  historyDays: string
  telegramEnabled: boolean
  isCustom: boolean
  isPublic: boolean
  features: string
  socialIntervalMinutes: string
}

export type PlanWritePayload = {
  code: string
  name: string
  description: string | null
  price_amount: number | null
  currency: string
  billing_interval: BillingInterval
  display_order: number
  max_watches: number | null
  minimum_interval_minutes: number | null
  history_days: number | null
  telegram_enabled: boolean
  is_custom: boolean
  is_public: boolean
  features: string[]
  limits: Record<string, unknown>
}

const intervalLabels: Record<BillingInterval, string> = {
  month: 'ay',
  year: 'il',
  one_time: 'birdəfəlik',
  custom: 'fərdi',
}

export const emptyPlanForm: PlanFormValues = {
  code: '',
  name: '',
  description: '',
  priceAmount: '',
  currency: 'AZN',
  billingInterval: 'month',
  displayOrder: '0',
  maxWatches: '',
  minimumIntervalMinutes: '',
  historyDays: '',
  telegramEnabled: true,
  isCustom: false,
  isPublic: true,
  features: '',
  socialIntervalMinutes: '',
}

const SOCIAL_INTERVAL_MINUTES = [60, 120, 180, 360, 720]

// The plan's Facebook/Instagram search interval, if it sets one.
export function planSocialIntervalMinutes(
  plan: Pick<SubscriptionPlan, 'limits'> | undefined
) {
  const value = Number(plan?.limits?.social_interval_minutes)
  return SOCIAL_INTERVAL_MINUTES.includes(value) ? value : null
}

export function normalizePlanCode(value: string) {
  return value
    .trim()
    .toLocaleLowerCase('az-AZ')
    .replace(/ə/g, 'e')
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ç/g, 'c')
    .replace(/ğ/g, 'g')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function parseOptionalNumber(
  value: string,
  label: string,
  options: { integer?: boolean; minimum?: number } = {}
) {
  const trimmed = value.trim()
  if (!trimmed) return { value: null as number | null }

  const number = Number(trimmed)
  const minimum = options.minimum ?? 0

  if (
    !Number.isFinite(number) ||
    (options.integer && !Number.isInteger(number)) ||
    number < minimum
  ) {
    return {
      value: null as number | null,
      error: `${label} ${minimum} və ya daha böyük ${options.integer ? 'tam ' : ''}ədəd olmalıdır.`,
    }
  }

  return { value: number }
}

// baseLimits: the plan's current limits, so keys this form does not edit
// (max_keywords, ...) are kept.
export function buildPlanPayload(
  values: PlanFormValues,
  baseLimits: Record<string, unknown> = {}
): { data: PlanWritePayload; error?: never } | { data?: never; error: string } {
  const name = values.name.trim()
  const code = normalizePlanCode(values.code || values.name)
  const currency = values.currency.trim().toUpperCase()

  if (!name) return { error: 'Plan adı tələb olunur.' }
  if (!code) return { error: 'Plan kodu tələb olunur.' }
  if (!/^[a-z0-9_]+$/.test(code)) {
    return {
      error:
        'Plan kodunda yalnız kiçik hərf, rəqəm və alt xətt istifadə edilə bilər.',
    }
  }
  if (!/^[A-Z]{3}$/.test(currency)) {
    return { error: 'Valyuta üç hərfli ISO kodu olmalıdır (məsələn, AZN).' }
  }

  const price = parseOptionalNumber(values.priceAmount, 'Qiymət')
  if (price.error) return { error: price.error }

  const displayOrder = parseOptionalNumber(values.displayOrder, 'Sıralama', {
    integer: true,
  })
  if (displayOrder.error) return { error: displayOrder.error }

  const maxWatches = parseOptionalNumber(values.maxWatches, 'Monitor limiti', {
    integer: true,
  })
  if (maxWatches.error) return { error: maxWatches.error }

  const minimumInterval = parseOptionalNumber(
    values.minimumIntervalMinutes,
    'Minimum interval',
    { integer: true, minimum: 1 }
  )
  if (minimumInterval.error) return { error: minimumInterval.error }

  const historyDays = parseOptionalNumber(values.historyDays, 'Tarixçə günü', {
    integer: true,
  })
  if (historyDays.error) return { error: historyDays.error }
  if (historyDays.value !== null && (historyDays.value < 1 || historyDays.value > 30)) {
    return { error: 'Tarixçə günü 1-30 arası olmalıdır: nəticələr 30 gün saxlanır.' }
  }

  const socialInterval = values.socialIntervalMinutes
    ? Number(values.socialIntervalMinutes)
    : null
  if (
    socialInterval !== null &&
    !SOCIAL_INTERVAL_MINUTES.includes(socialInterval)
  ) {
    return {
      error: 'Sosial yoxlama tezliyi 1, 2, 3, 6 və ya 12 saat olmalıdır.',
    }
  }
  const limits: Record<string, unknown> = { ...baseLimits }
  delete limits.social_interval_minutes
  if (socialInterval !== null) limits.social_interval_minutes = socialInterval

  const features = Array.from(
    new Set(
      values.features
        .split('\n')
        .map((feature) => feature.trim())
        .filter(Boolean)
    )
  )

  return {
    data: {
      code,
      name,
      description: values.description.trim() || null,
      price_amount: price.value,
      currency,
      billing_interval: values.billingInterval,
      display_order: displayOrder.value ?? 0,
      max_watches: maxWatches.value,
      minimum_interval_minutes: minimumInterval.value,
      history_days: historyDays.value,
      telegram_enabled: values.telegramEnabled,
      is_custom: values.isCustom,
      is_public: values.isPublic,
      features,
      limits,
    },
  }
}

export function planToFormValues(plan: SubscriptionPlan): PlanFormValues {
  return {
    code: plan.code,
    name: plan.name,
    description: plan.description || '',
    priceAmount: plan.price_amount?.toString() || '',
    currency: plan.currency,
    billingInterval: plan.billing_interval,
    displayOrder: plan.display_order.toString(),
    maxWatches: plan.max_watches?.toString() || '',
    minimumIntervalMinutes: plan.minimum_interval_minutes?.toString() || '',
    historyDays: plan.history_days?.toString() || '',
    telegramEnabled: plan.telegram_enabled,
    isCustom: plan.is_custom,
    isPublic: plan.is_public,
    features: plan.features.join('\n'),
    socialIntervalMinutes: String(planSocialIntervalMinutes(plan) ?? ''),
  }
}

export function formatPlanPrice(
  plan: Pick<SubscriptionPlan, 'price_amount' | 'currency' | 'billing_interval'>
) {
  if (plan.price_amount === null) return 'Fərdi qiymət'

  const amount = new Intl.NumberFormat('az-AZ', {
    maximumFractionDigits: 2,
  }).format(plan.price_amount)

  if (plan.billing_interval === 'one_time') {
    return `${amount} ${plan.currency} · birdəfəlik`
  }
  if (plan.billing_interval === 'custom') {
    return `${amount} ${plan.currency} · fərdi`
  }

  return `${amount} ${plan.currency} / ${intervalLabels[plan.billing_interval]}`
}

export function normalizePlanRow(
  row: Omit<SubscriptionPlan, 'features' | 'limits'> & {
    features?: unknown
    limits?: unknown
  }
): SubscriptionPlan {
  return {
    ...row,
    limits:
      row.limits && typeof row.limits === 'object' && !Array.isArray(row.limits)
        ? (row.limits as Record<string, unknown>)
        : {},
    features: Array.isArray(row.features)
      ? row.features.filter(
          (feature): feature is string => typeof feature === 'string'
        )
      : [],
  }
}
