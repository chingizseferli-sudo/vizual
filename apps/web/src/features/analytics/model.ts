import { z } from 'zod'

const nullableText = z.string().nullable()
const isoTimestamp = z.iso.datetime({ offset: true })
export const analyticsSchema = z
  .object({
    version: z.literal(1),
    owner_id: z.string().min(1),
    items: z
      .array(
        z.object({
          id: z.string(),
          title: z.string(),
          url: z.string(),
          source_id: nullableText,
          publisher: nullableText,
          platform: z.string(),
          published_at: isoTimestamp.nullable(),
          detected_at: isoTimestamp,
          metadata: z.record(z.string(), z.unknown()).nullable(),
          matches: z.array(
            z.object({
              monitor_id: z.string(),
              name: z.string(),
              keyword: nullableText,
            })
          ),
        })
      )
      .max(500),
    truncated: z.boolean(),
    limit: z.number().int().positive(),
    collected_at: isoTimestamp,
    start: isoTimestamp,
    end: isoTimestamp,
    retention_days: z.number(),
    monitors: z.array(z.object({ id: z.string(), name: z.string() })),
  })
  .refine(
    (data) =>
      Date.parse(data.start) < Date.parse(data.end) &&
      Date.parse(data.end) - Date.parse(data.start) <= 31 * 86400000,
    'Invalid analytics window'
  )
export type AnalyticsData = z.infer<typeof analyticsSchema>
export type ContentItem = AnalyticsData['items'][number]
export type AnalyticsFilters = {
  start: string
  end: string
  monitor: string
  source: string
}

export function analyticsKey(userId: string, filters: AnalyticsFilters) {
  return ['customer', 'analytics', userId, filters] as const
}
export function defaultFilters(now = new Date()): AnalyticsFilters {
  const start = now
  return {
    start: start.toISOString().slice(0, 10),
    end: now.toISOString().slice(0, 10),
    monitor: '',
    source: '',
  }
}
export function requestWindow(filters: AnalyticsFilters, now = new Date()) {
  const start = new Date(`${filters.start}T00:00:00Z`)
  const requestedEnd = new Date(`${filters.end}T00:00:00Z`)
  const end = new Date(
    Math.min(requestedEnd.getTime() + 86400000, now.getTime())
  )
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(filters.start) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(filters.end) ||
    !Number.isFinite(start.getTime()) ||
    !Number.isFinite(end.getTime()) ||
    start >= end ||
    requestedEnd.getTime() < start.getTime() ||
    end.getTime() - start.getTime() > 31 * 86400000 ||
    requestedEnd > now ||
    start.toISOString().slice(0, 10) !== filters.start ||
    requestedEnd.toISOString().slice(0, 10) !== filters.end
  ) {
    throw new Error(
      'Tarix aralığı düzgün deyil. Maksimum 31 gün və bu günədək tarix seçin.'
    )
  }
  return { start: start.toISOString(), end: end.toISOString() }
}
export function evidenceUrl(value: string) {
  try {
    const url = new URL(value)
    return ['https:', 'http:'].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null
  } catch {
    return null
  }
}
function headline(value: string) {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('az-AZ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
export function summarize(data: AnalyticsData) {
  const items = [
    ...new Map(data.items.map((item) => [item.id, item])).values(),
  ].sort(
    (a, b) =>
      b.detected_at.localeCompare(a.detected_at) || b.id.localeCompare(a.id)
  )
  const sourceMap = new Map<
    string,
    { id: string; name: string; count: number }
  >()
  const platformMap = new Map<string, number>()
  const days = new Map<string, number>()
  for (
    let d = new Date(data.start);
    d < new Date(data.end);
    d = new Date(d.getTime() + 86400000)
  )
    days.set(d.toISOString().slice(0, 10), 0)
  const topicMap = new Map<
    string,
    {
      id: string
      name: string
      items: Set<string>
      sources: Set<string>
      keywords: Set<string>
      current: number
      previous: number
    }
  >()
  const midpoint = (Date.parse(data.start) + Date.parse(data.end)) / 2
  const headlines = new Map<string, ContentItem[]>()
  items.forEach((item) => {
    if (item.source_id) {
      const source = sourceMap.get(item.source_id) || {
        id: item.source_id,
        name: item.publisher || item.source_id,
        count: 0,
      }
      source.count++
      sourceMap.set(item.source_id, source)
    }
    platformMap.set(item.platform, (platformMap.get(item.platform) || 0) + 1)
    const day = item.detected_at.slice(0, 10)
    days.set(day, (days.get(day) || 0) + 1)
    const seen = new Set<string>()
    item.matches.forEach((match) => {
      const topic = topicMap.get(match.monitor_id) || {
        id: match.monitor_id,
        name: match.name,
        items: new Set<string>(),
        sources: new Set<string>(),
        keywords: new Set<string>(),
        current: 0,
        previous: 0,
      }
      topic.items.add(item.id)
      if (item.source_id) topic.sources.add(item.source_id)
      if (match.keyword) topic.keywords.add(match.keyword)
      if (!seen.has(match.monitor_id)) {
        if (Date.parse(item.detected_at) >= midpoint) topic.current++
        else topic.previous++
        seen.add(match.monitor_id)
      }
      topicMap.set(match.monitor_id, topic)
    })
    const key = headline(item.title)
    if (key.length >= 25)
      headlines.set(key, [...(headlines.get(key) || []), item])
  })
  return {
    items,
    sources: [...sourceMap.values()].sort(
      (a, b) => b.count - a.count || a.name.localeCompare(b.name)
    ),
    platforms: [...platformMap].map(([name, count]) => ({ name, count })),
    days: [...days]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, count]) => ({ name, count })),
    topics: [...topicMap.values()].sort(
      (a, b) => b.items.size - a.items.size || a.name.localeCompare(b.name)
    ),
    related: [...headlines.values()]
      .filter((group) => group.length > 1)
      .slice(0, 20),
    midpoint: new Date(midpoint).toISOString(),
  }
}
