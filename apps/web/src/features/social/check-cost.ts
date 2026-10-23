// Estimates for the admin "İndi yoxla" confirmation. They mirror the social
// collector's own estimates (apps/worker/social/collector.py).

// The Facebook actor bills per delivered post ($2.40 / 1000).
export const FACEBOOK_USD_PER_POST = 0.0024
// SocialFetch Starter: $29 for 18 000 credits; one search or page read ≈ 1 credit.
export const INSTAGRAM_USD_PER_CALL = 29 / 18000
// YouTube Data API search.list costs 100 quota units; the API itself is free.
export const YOUTUBE_UNITS_PER_SEARCH = 100

export type CheckScope = {
  facebookKeywords?: number
  instagramKeywords?: number
  instagramPages?: number
  youtubeKeywords?: number
}

export type CheckCost = {
  facebookUsd: number
  instagramUsd: number
  totalUsd: number
  youtubeUnits: number
}

export function estimateCheckCost(scope: CheckScope, fbMaxPostsPerQuery: number): CheckCost {
  const facebookUsd =
    (scope.facebookKeywords ?? 0) * Math.max(1, fbMaxPostsPerQuery) * FACEBOOK_USD_PER_POST
  const instagramUsd =
    ((scope.instagramKeywords ?? 0) + (scope.instagramPages ?? 0)) * INSTAGRAM_USD_PER_CALL
  return {
    facebookUsd,
    instagramUsd,
    totalUsd: facebookUsd + instagramUsd,
    youtubeUnits: (scope.youtubeKeywords ?? 0) * YOUTUBE_UNITS_PER_SEARCH,
  }
}

// What is left of a monthly budget; null when there is no limit.
export function remainingBudget(budget: number | null | undefined, spent: number | null | undefined) {
  if (budget == null) return null
  return Math.max(0, Number(budget) - Number(spent ?? 0))
}

export function formatCostUsd(value: number) {
  return value > 0 && value < 0.01 ? '<$0.01' : `$${value.toFixed(2)}`
}
