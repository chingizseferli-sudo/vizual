// Deal pricing for the admin calculator. Same model as vizual-review/qiymet_hesab.py
// and vizual-xerc-modeli.xlsx: 30-day month, Facebook billed per new post
// (monitorMode), Instagram billed per request, prices include VAT.

export type CalculatorAssumptions = {
  usdToAzn: number
  apifyUsdPer1000Posts: number
  fbMaxPostsPerCheck: number
  socialFetchUsdPerRequest: number
  railwayUsd: number
  supabaseUsd: number
  vercelUsd: number
  domainUsd: number
  apifyPlanUsd: number
  socialFetchPlanUsd: number
  developerAzn: number
  otherVariableAzn: number
  vatRate: number
  paymentFeeRate: number
}

export type CalculatorInput = {
  facebook: boolean
  instagram: boolean
  newsKeywords: number
  monitors: number
  socialKeywords: number
  intervalHours: number
  fbNewPostsPerKeywordPerDay: number
  contractMonths: number
  payingCustomers: number
  targetMarginPercent: number
  discountPercent: number
}

export const DEFAULT_ASSUMPTIONS: CalculatorAssumptions = {
  usdToAzn: 1.7,
  apifyUsdPer1000Posts: 2.4,
  fbMaxPostsPerCheck: 20,
  // SocialFetch Starter: $29 for 18 000 requests.
  socialFetchUsdPerRequest: 29 / 18000,
  railwayUsd: 20,
  supabaseUsd: 25,
  vercelUsd: 20,
  domainUsd: 5,
  apifyPlanUsd: 19,
  socialFetchPlanUsd: 29,
  developerAzn: 0,
  otherVariableAzn: 1,
  vatRate: 0.18,
  paymentFeeRate: 0.025,
}

export const DEFAULT_INPUT: CalculatorInput = {
  facebook: true,
  instagram: true,
  newsKeywords: 20,
  monitors: 5,
  socialKeywords: 10,
  intervalHours: 6,
  fbNewPostsPerKeywordPerDay: 15,
  contractMonths: 12,
  payingCustomers: 25,
  targetMarginPercent: 60,
  discountPercent: 0,
}

export type CalculatorResult = {
  checksPerDay: number
  fbPostsPerMonth: number
  igRequestsPerMonth: number
  facebookAzn: number
  instagramAzn: number
  otherVariableAzn: number
  infraShareAzn: number
  developerShareAzn: number
  costAzn: number
  suggestedPriceAzn: number
  roundedPriceAzn: number
  finalPriceAzn: number
  vatAzn: number
  feeAzn: number
  profitAzn: number
  contractProfitAzn: number
  marginPercent: number
}

const DAYS = 30

function positive(value: number) {
  return Number.isFinite(value) && value > 0 ? value : 0
}

// 113.2 -> 119, 120 -> 129: prices that end in 9 like the current plans.
export function roundNicePrice(value: number) {
  if (!(value > 0)) return 0
  return Math.ceil((value + 1) / 10) * 10 - 1
}

export function calculateDeal(
  input: CalculatorInput,
  a: CalculatorAssumptions
): CalculatorResult {
  const interval = positive(input.intervalHours) || 24
  const checksPerDay = 24 / interval
  const socialKeywords = positive(input.socialKeywords)
  const customers = Math.max(1, positive(input.payingCustomers))

  // monitorMode pays only for new posts, at most maxPostsPerCheck per check.
  const fbPostsPerKeywordPerDay = Math.min(
    positive(input.fbNewPostsPerKeywordPerDay),
    checksPerDay * positive(a.fbMaxPostsPerCheck)
  )
  const fbPostsPerMonth = input.facebook
    ? DAYS * fbPostsPerKeywordPerDay * socialKeywords
    : 0
  const igRequestsPerMonth = input.instagram
    ? DAYS * checksPerDay * socialKeywords
    : 0

  const facebookAzn =
    (fbPostsPerMonth / 1000) * a.apifyUsdPer1000Posts * a.usdToAzn
  const instagramAzn =
    igRequestsPerMonth * a.socialFetchUsdPerRequest * a.usdToAzn
  const otherVariableAzn = positive(a.otherVariableAzn)

  // Fixed monthly costs, shared by every paying customer. Service plan minimums
  // are counted as fixed even though they include some usage: a safe overestimate.
  const infraUsd =
    a.railwayUsd +
    a.supabaseUsd +
    a.vercelUsd +
    a.domainUsd +
    a.apifyPlanUsd +
    a.socialFetchPlanUsd
  const infraShareAzn = (infraUsd * a.usdToAzn) / customers
  const developerShareAzn = positive(a.developerAzn) / customers

  const costAzn =
    facebookAzn +
    instagramAzn +
    otherVariableAzn +
    infraShareAzn +
    developerShareAzn

  // Gross price g (VAT included): net = g/(1+vat), fee = g*fee,
  // profit = net - fee - cost = margin * net  =>  g = cost / ((1-m)/(1+vat) - fee).
  const margin = Math.min(Math.max(input.targetMarginPercent, 0), 95) / 100
  const divisor = (1 - margin) / (1 + a.vatRate) - a.paymentFeeRate
  const suggestedPriceAzn = divisor > 0 ? costAzn / divisor : 0
  const roundedPriceAzn = roundNicePrice(suggestedPriceAzn)

  const discount = Math.min(Math.max(input.discountPercent, 0), 100) / 100
  const finalPriceAzn = roundedPriceAzn * (1 - discount)
  const netAzn = finalPriceAzn / (1 + a.vatRate)
  const vatAzn = finalPriceAzn - netAzn
  const feeAzn = finalPriceAzn * a.paymentFeeRate
  const profitAzn = netAzn - feeAzn - costAzn

  return {
    checksPerDay,
    fbPostsPerMonth,
    igRequestsPerMonth,
    facebookAzn,
    instagramAzn,
    otherVariableAzn,
    infraShareAzn,
    developerShareAzn,
    costAzn,
    suggestedPriceAzn,
    roundedPriceAzn,
    finalPriceAzn,
    vatAzn,
    feeAzn,
    profitAzn,
    contractProfitAzn: profitAzn * Math.max(1, positive(input.contractMonths)),
    marginPercent: netAzn > 0 ? (profitAzn / netAzn) * 100 : 0,
  }
}

export function closestPlan<T extends { price_amount: number | null }>(
  plans: T[],
  price: number
): T | null {
  let best: T | null = null
  for (const plan of plans) {
    if (plan.price_amount === null) continue
    if (
      !best ||
      Math.abs(plan.price_amount - price) <
        Math.abs((best.price_amount ?? 0) - price)
    ) {
      best = plan
    }
  }
  return best
}
