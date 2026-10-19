import { z } from 'zod'
import type { ContentItem } from './model'

export const metricNames = [
  'views',
  'likes',
  'reactions',
  'comments',
  'shares',
  'reposts',
  'reach',
] as const
export type MetricName = (typeof metricNames)[number]
const count = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER)
  .nullable()
  .optional()
export const snapshotSchema = z.object({
  observed_at: z.iso.datetime({ offset: true }),
  provider: z.string().trim().min(1).max(200),
  method: z.string().trim().min(1).max(100),
  views: count,
  likes: count,
  reactions: count,
  comments: count,
  shares: count,
  reposts: count,
  reach: count,
})
export type MetricSnapshot = z.infer<typeof snapshotSchema>
export const defaultPopularityPolicy = {
  freshnessHours: 24,
  leastAgeHours: 48,
  minimumCohort: 3,
  weights: {
    views: 0.01,
    likes: 1,
    reactions: 1,
    comments: 2,
    shares: 3,
    reposts: 3,
    reach: 0,
  } as Record<MetricName, number>,
}
export function snapshots(item: ContentItem) {
  const parsed = z
    .array(snapshotSchema)
    .max(100)
    .safeParse(item.metadata?.metrics)
  return parsed.success
    ? parsed.data.sort(
        (a, b) => Date.parse(a.observed_at) - Date.parse(b.observed_at)
      )
    : []
}
export function metricState(item: ContentItem, now = new Date()) {
  const history = snapshots(item).filter(
    (s) => Date.parse(s.observed_at) <= now.getTime()
  )
  const last = history[history.length - 1]
  if (!last) return { snapshot: null, stale: false }
  return {
    snapshot: last,
    stale:
      now.getTime() - Date.parse(last.observed_at) >
      defaultPopularityPolicy.freshnessHours * 3600000,
  }
}
export type PopularityMode = 'most' | 'least' | 'growth'
export function popularityGroups(
  items: ContentItem[],
  mode: PopularityMode,
  now = new Date(),
  policy = defaultPopularityPolicy
) {
  if (
    !Number.isFinite(now.getTime()) ||
    !Number.isFinite(policy.freshnessHours) ||
    policy.freshnessHours <= 0 ||
    policy.leastAgeHours < 0 ||
    policy.minimumCohort < 2 ||
    Object.values(policy.weights).some((w) => !Number.isFinite(w) || w < 0)
  )
    throw new Error('Invalid popularity policy')
  const groups = new Map<
    string,
    {
      item: ContentItem
      score: number
      normalized: number | null
      observedAt: string
      provider: string
      method: string
    }[]
  >()
  for (const item of items) {
    const published = item.published_at ? Date.parse(item.published_at) : NaN
    const age = (now.getTime() - published) / 3600000
    if (
      !Number.isFinite(age) ||
      age < 0 ||
      (mode === 'least' && age < policy.leastAgeHours)
    )
      continue
    const history = snapshots(item).filter(
      (s) => Date.parse(s.observed_at) <= now.getTime()
    )
    const current = history[history.length - 1]
    if (
      !current ||
      now.getTime() - Date.parse(current.observed_at) >
        policy.freshnessHours * 3600000
    )
      continue
    if (Date.parse(current.observed_at) < published) continue
    const available = metricNames.filter(
      (metric) =>
        metric !== 'reach' &&
        current[metric] != null &&
        policy.weights[metric] > 0
    )
    if (!available.length) continue
    const ageBucket =
      age < 24
        ? '0–24 saat'
        : age < 48
          ? '24–48 saat'
          : age < 168
            ? '48–168 saat'
            : '168+ saat'
    const weighted = (snapshot: MetricSnapshot) =>
      available.reduce(
        (total, key) => total + (snapshot[key] ?? 0) * policy.weights[key],
        0
      )
    let score = weighted(current)
    if (mode === 'growth') {
      const previous = history
        .slice(0, -1)
        .reverse()
        .find(
          (s) =>
            s.provider === current.provider &&
            s.method === current.method &&
            Date.parse(s.observed_at) < Date.parse(current.observed_at) &&
            available.every((key) => s[key] != null) &&
            metricNames.every(
              (key) => (s[key] != null) === (current[key] != null)
            )
        )
      if (
        !previous ||
        available.some((key) => (current[key] ?? 0) < (previous[key] ?? 0))
      )
        continue
      score =
        (score - weighted(previous)) /
        ((Date.parse(current.observed_at) - Date.parse(previous.observed_at)) /
          3600000)
    }
    const key = `${item.platform} · ${String(item.metadata?.content_type || 'unknown')} · ${ageBucket} · ${available.join(',')} · ${current.provider}/${current.method}`
    const rows = groups.get(key) || []
    rows.push({
      item,
      score,
      normalized: null,
      observedAt: current.observed_at,
      provider: current.provider,
      method: current.method,
    })
    groups.set(key, rows)
  }
  return [...groups]
    .filter(
      ([, rows]) => mode !== 'least' || rows.length >= policy.minimumCohort
    )
    .map(([cohort, rows]) => {
      rows.sort(
        (a, b) =>
          (mode === 'least' ? a.score - b.score : b.score - a.score) ||
          a.item.id.localeCompare(b.item.id)
      )
      if (rows.length >= policy.minimumCohort)
        rows.forEach((row) => {
          row.normalized =
            (rows.filter((other) => other.score < row.score).length /
              (rows.length - 1)) *
            100
        })
      return { cohort, rows }
    })
    .sort((a, b) => a.cohort.localeCompare(b.cohort))
}
