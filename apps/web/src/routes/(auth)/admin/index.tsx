import { useEffect, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { supabase } from '@/lib/supabase'
import { PortalLoading } from '@/components/layout/portal-state'

type SourceRow = {
  id: string
  name: string | null
  base_url: string | null
  status: string | null
  last_checked_at: string | null
  last_success_at: string | null
  last_article_found_at: string | null
  last_result: string | null
  last_error: string | null
  consecutive_fail_count: number | null
  monitor_method: string | null
  selector: string | null
  article_pattern: string | null
  rss_url: string | null
}

type DashboardStats = {
  activeSources: number
  checkedToday: number
  items24h: number
  itemsToday: number
  matches24h: number
  matchesToday: number
  alertsToday: number | null
  problemSources: number
  repairNeeded: number
  passive7d: number
}

type KpiCard = {
  title: string
  value: number | null
  description: string
  to?: '/admin/monitor/sources' | '/admin/users'
}

type TimedRow = {
  id: string
  created_at: string | null
  source_id?: string | null
}

type MatchRow = {
  id: string
  created_at: string | null
  item_id: string | null
}

type ChartPoint = {
  label: string
  value: number
}

type DashboardCharts = {
  itemsByHour: ChartPoint[]
  matchesByDay: ChartPoint[]
  sourcesByMethod: ChartPoint[]
}

type RankedSource = {
  sourceId: string
  sourceName: string
  value: number
}

type AttentionSource = {
  sourceId: string
  sourceName: string
  category: string
  severity: 'low' | 'medium' | 'high'
}

type RecentSource = {
  sourceId: string
  sourceName: string
  lastArticleTime: string
}

type DashboardOperations = {
  topSources: RankedSource[]
  topMatchingSources: RankedSource[]
  attentionSources: AttentionSource[]
  recentActiveSources: RecentSource[]
}

const SOURCE_FIELDS =
  'id,name,base_url,status,last_checked_at,last_success_at,last_article_found_at,last_result,last_error,consecutive_fail_count,monitor_method,selector,article_pattern,rss_url'

function startOfToday() {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  return date
}

function hoursAgo(hours: number) {
  return new Date(Date.now() - hours * 60 * 60 * 1000)
}

function daysAgo(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
}

function isAfter(value: string | null, threshold: Date) {
  if (!value) return false

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) return false

  return date >= threshold
}

function hasSelector(source: SourceRow) {
  return (
    Boolean((source.selector || '').trim()) ||
    Boolean((source.article_pattern || '').trim())
  )
}

function isProblemSource(source: SourceRow) {
  return (
    (source.consecutive_fail_count || 0) >= 5 ||
    source.last_result === 'site_error' ||
    ['failed', 'dead', 'blocked'].includes(source.monitor_method || '')
  )
}

function needsRepair(source: SourceRow) {
  const method = source.monitor_method || ''
  const lastError = (source.last_error || '').toLowerCase()

  return (
    isProblemSource(source) ||
    (['selector', 'xpath_pattern'].includes(method) && !hasSelector(source)) ||
    source.last_result === 'no_candidate' ||
    source.last_result === 'old_news' ||
    lastError.includes('403') ||
    lastError.includes('429') ||
    lastError.includes('timeout') ||
    (method === 'selector' && Boolean((source.rss_url || '').trim())) ||
    !source.last_checked_at
  )
}

function getSourceName(source: SourceRow) {
  return source.name || source.base_url || source.id
}

function getRepairInfo(source: SourceRow): {
  category: string
  severity: 'low' | 'medium' | 'high'
} {
  const failCount = source.consecutive_fail_count || 0
  const method = source.monitor_method || ''
  const lastError = (source.last_error || '').toLowerCase()

  if (failCount >= 5) {
    return { category: 'Tez-tez fail olur', severity: 'high' }
  }

  if (
    lastError.includes('403') ||
    lastError.includes('429') ||
    lastError.includes('timeout') ||
    ['failed', 'dead', 'blocked'].includes(method)
  ) {
    return { category: 'Blok/rate limit', severity: 'high' }
  }

  if (['selector', 'xpath_pattern'].includes(method) && !hasSelector(source)) {
    return { category: 'Selector problemi', severity: 'high' }
  }

  if (!source.last_checked_at) {
    return { category: 'İlk yoxlama lazımdır', severity: 'medium' }
  }

  if (source.last_result === 'no_candidate') {
    return { category: 'Namizəd tapılmır', severity: 'medium' }
  }

  if (method === 'selector' && Boolean((source.rss_url || '').trim())) {
    return { category: 'Daha stabil metod var', severity: 'medium' }
  }

  if (source.last_result === 'old_news') {
    return { category: 'Köhnə xəbər gəlir', severity: 'low' }
  }

  return { category: 'Müşahidə et', severity: 'low' }
}

function getBakuDateParts(value: Date | string | null) {
  if (!value) return null

  const date = typeof value === 'string' ? new Date(value) : value

  if (Number.isNaN(date.getTime())) return null

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Baku',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(date)

  const mapped = parts.reduce<Record<string, string>>((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = part.value
    return acc
  }, {})

  return {
    year: mapped.year,
    month: mapped.month,
    day: mapped.day,
    hour: mapped.hour === '24' ? '00' : mapped.hour,
  }
}

function getBakuHourKey(value: Date | string | null) {
  const parts = getBakuDateParts(value)
  if (!parts) return ''
  return `${parts.year}-${parts.month}-${parts.day}-${parts.hour}`
}

function getBakuDayKey(value: Date | string | null) {
  const parts = getBakuDateParts(value)
  if (!parts) return ''
  return `${parts.year}-${parts.month}-${parts.day}`
}

function getBakuHourLabel(value: Date | string | null) {
  const parts = getBakuDateParts(value)
  if (!parts) return '—'
  return `${parts.hour}:00`
}

function getBakuDayLabel(value: Date | string | null) {
  const parts = getBakuDateParts(value)
  if (!parts) return '—'
  return `${parts.day}.${parts.month}`
}

function getBakuDateTimeLabel(value: Date | string | null) {
  if (!value) return '—'

  const date = typeof value === 'string' ? new Date(value) : value

  if (Number.isNaN(date.getTime())) return '—'

  return new Intl.DateTimeFormat('az-AZ', {
    timeZone: 'Asia/Baku',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function buildHourlyBuckets(rows: TimedRow[]) {
  const buckets = Array.from({ length: 24 }, (_, index) => {
    const bucketDate = hoursAgo(23 - index)
    return {
      key: getBakuHourKey(bucketDate),
      label: getBakuHourLabel(bucketDate),
      value: 0,
    }
  })
  const byKey = new Map(buckets.map((bucket) => [bucket.key, bucket]))

  rows.forEach((row) => {
    const bucket = byKey.get(getBakuHourKey(row.created_at))
    if (bucket) bucket.value += 1
  })

  return buckets.map(({ label, value }) => ({ label, value }))
}

function buildDailyBuckets(rows: TimedRow[]) {
  const buckets = Array.from({ length: 7 }, (_, index) => {
    const bucketDate = daysAgo(6 - index)
    return {
      key: getBakuDayKey(bucketDate),
      label: getBakuDayLabel(bucketDate),
      value: 0,
    }
  })
  const byKey = new Map(buckets.map((bucket) => [bucket.key, bucket]))

  rows.forEach((row) => {
    const bucket = byKey.get(getBakuDayKey(row.created_at))
    if (bucket) bucket.value += 1
  })

  return buckets.map(({ label, value }) => ({ label, value }))
}

function getMethodLabel(method: string | null) {
  const labels: Record<string, string> = {
    rss: 'RSS Feed',
    rss_discovered: 'RSS Feed',
    selector: 'CSS Selector',
    xpath_pattern: 'XPath',
    latest_page: 'Son xəbərlər',
    homepage: 'Ana səhifə',
    google_news_fallback: 'Google News',
    recoverable: 'Bərpa rejimi',
  }

  return labels[method || ''] || method || 'Naməlum'
}

function buildMethodBuckets(sources: SourceRow[]) {
  const counts = new Map<string, number>()

  sources.forEach((source) => {
    const label = getMethodLabel(source.monitor_method)
    counts.set(label, (counts.get(label) || 0) + 1)
  })

  return Array.from(counts.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8)
}

function buildTopSources(
  rows: TimedRow[],
  sourcesById: Map<string, SourceRow>
) {
  const counts = new Map<string, number>()

  rows.forEach((row) => {
    if (!row.source_id) return
    counts.set(row.source_id, (counts.get(row.source_id) || 0) + 1)
  })

  return Array.from(counts.entries())
    .map(([sourceId, value]) => ({
      sourceId,
      sourceName: getSourceName(
        sourcesById.get(sourceId) || {
          id: sourceId,
          name: null,
          base_url: null,
          status: null,
          last_checked_at: null,
          last_success_at: null,
          last_article_found_at: null,
          last_result: null,
          last_error: null,
          consecutive_fail_count: null,
          monitor_method: null,
          selector: null,
          article_pattern: null,
          rss_url: null,
        }
      ),
      value,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10)
}

function buildTopMatchingSources(
  matches: MatchRow[],
  itemSourceById: Map<string, string>,
  sourcesById: Map<string, SourceRow>
) {
  const counts = new Map<string, number>()

  matches.forEach((match) => {
    if (!match.item_id) return

    const sourceId = itemSourceById.get(match.item_id)
    if (!sourceId) return

    counts.set(sourceId, (counts.get(sourceId) || 0) + 1)
  })

  return Array.from(counts.entries())
    .map(([sourceId, value]) => ({
      sourceId,
      sourceName: getSourceName(
        sourcesById.get(sourceId) || {
          id: sourceId,
          name: null,
          base_url: null,
          status: null,
          last_checked_at: null,
          last_success_at: null,
          last_article_found_at: null,
          last_result: null,
          last_error: null,
          consecutive_fail_count: null,
          monitor_method: null,
          selector: null,
          article_pattern: null,
          rss_url: null,
        }
      ),
      value,
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 10)
}

function buildAttentionSources(sources: SourceRow[]) {
  const severityRank = { high: 3, medium: 2, low: 1 }

  return sources
    .filter((source) => needsRepair(source))
    .map((source) => {
      const repair = getRepairInfo(source)

      return {
        sourceId: source.id,
        sourceName: getSourceName(source),
        category: repair.category,
        severity: repair.severity,
      }
    })
    .sort((a, b) => severityRank[b.severity] - severityRank[a.severity])
    .slice(0, 10)
}

function buildRecentActiveSources(sources: SourceRow[]) {
  return sources
    .filter((source) => Boolean(source.last_article_found_at))
    .sort((a, b) => {
      const aTime = new Date(a.last_article_found_at || '').getTime()
      const bTime = new Date(b.last_article_found_at || '').getTime()
      return bTime - aTime
    })
    .slice(0, 10)
    .map((source) => ({
      sourceId: source.id,
      sourceName: getSourceName(source),
      lastArticleTime: getBakuDateTimeLabel(source.last_article_found_at),
    }))
}

function KpiCard({ title, value, description, to }: KpiCard) {
  const content = (
    <>
      <div className='text-xs font-medium text-muted-foreground'>{title}</div>
      <div className='mt-2 text-2xl font-semibold tabular-nums'>
        {value ?? '—'}
      </div>
      <p className='sr-only'>{description}</p>
    </>
  )

  const className = 'min-w-0 rounded-xl border bg-card p-4 text-card-foreground'

  if (to) {
    return (
      <Link
        to={to}
        title={description}
        className={`${className} transition-colors hover:border-ring focus-visible:outline-2 focus-visible:outline-ring`}
      >
        {content}
      </Link>
    )
  }

  return (
    <div className={className} title={description}>
      {content}
    </div>
  )
}

function VerticalChartCard({
  title,
  description,
  data,
}: {
  title: string
  description: string
  data: ChartPoint[]
}) {
  const max = Math.max(...data.map((point) => point.value), 0)
  const hasData = data.some((point) => point.value > 0)

  return (
    <section className='rounded-xl border bg-card p-4'>
      <div>
        <h2 className='font-semibold'>{title}</h2>
        <p className='mt-1 text-sm text-muted-foreground'>{description}</p>
      </div>

      <ul className='sr-only'>
        {data.map((point) => (
          <li key={point.label}>
            {point.label}: {point.value}
          </li>
        ))}
      </ul>
      {!hasData ? (
        <div className='mt-6 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground'>
          Məlumat yoxdur
        </div>
      ) : (
        <div
          role='img'
          aria-label={title}
          className='mt-6 flex h-44 items-end gap-1'
        >
          {data.map((point, index) => {
            const height = max ? Math.max(8, (point.value / max) * 100) : 0

            return (
              <div
                key={`${point.label}-${index}`}
                className='flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2'
                title={`${point.label}: ${point.value}`}
              >
                <div
                  className='w-full rounded-t-md bg-primary/70'
                  aria-hidden='true'
                  style={{ height: `${height * 1.4}px` }}
                />
                <span className='h-4 w-full truncate text-center text-[10px] text-muted-foreground'>
                  {index % 3 === 0 || index === data.length - 1
                    ? point.label
                    : ''}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

function HorizontalChartCard({
  title,
  description,
  data,
}: {
  title: string
  description: string
  data: ChartPoint[]
}) {
  const max = Math.max(...data.map((point) => point.value), 0)
  const hasData = data.some((point) => point.value > 0)

  return (
    <section className='rounded-xl border bg-card p-4'>
      <div>
        <h2 className='font-semibold'>{title}</h2>
        <p className='mt-1 text-sm text-muted-foreground'>{description}</p>
      </div>

      <ul className='sr-only'>
        {data.map((point) => (
          <li key={point.label}>
            {point.label}: {point.value}
          </li>
        ))}
      </ul>
      {!hasData ? (
        <div className='mt-6 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground'>
          Məlumat yoxdur
        </div>
      ) : (
        <div className='mt-6 grid gap-3'>
          {data.map((point) => {
            const width = max ? Math.max(4, (point.value / max) * 100) : 0

            return (
              <div key={point.label}>
                <div className='mb-1 flex items-center justify-between gap-3 text-sm'>
                  <span className='truncate font-medium'>{point.label}</span>
                  <span className='shrink-0 text-muted-foreground'>
                    {point.value}
                  </span>
                </div>
                <div className='h-2 overflow-hidden rounded-full bg-muted'>
                  <div
                    className='h-full rounded-full bg-primary/70'
                    style={{ width: `${width}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

function EmptyList() {
  return (
    <div className='rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground'>
      Məlumat yoxdur
    </div>
  )
}

function severityClass(severity: AttentionSource['severity']) {
  if (severity === 'high')
    return 'bg-destructive/10 text-destructive ring-destructive/25'
  if (severity === 'medium') {
    return 'bg-warning/10 text-warning ring-warning/25'
  }
  return 'bg-success/10 text-success ring-success/25'
}

function TopSourcesList({
  title,
  description,
  rows,
  valueLabel,
}: {
  title: string
  description: string
  rows: RankedSource[]
  valueLabel: string
}) {
  return (
    <section className='rounded-xl border bg-card p-4'>
      <div className='mb-4'>
        <h2 className='font-semibold'>{title}</h2>
        <p className='mt-1 text-sm text-muted-foreground'>{description}</p>
      </div>

      {rows.length === 0 ? (
        <EmptyList />
      ) : (
        <div className='max-h-80 overflow-y-auto pr-1'>
          {rows.map((row) => (
            <Link
              key={row.sourceId}
              to='/admin/monitor/sources'
              className='flex items-center justify-between gap-3 border-b py-3 text-sm last:border-b-0 hover:text-primary'
            >
              <span className='min-w-0 truncate font-medium'>
                {row.sourceName}
              </span>
              <span className='shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs font-semibold'>
                {row.value} {valueLabel}
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  )
}

function AttentionList({ rows }: { rows: AttentionSource[] }) {
  return (
    <section className='rounded-xl border bg-card p-4'>
      <div className='mb-4'>
        <h2 className='font-semibold'>Diqqət tələb edən mənbələr</h2>
        <p className='mt-1 text-sm text-muted-foreground'>
          Bərpa qaydalarına görə ilk 10 mənbə.
        </p>
      </div>

      {rows.length === 0 ? (
        <EmptyList />
      ) : (
        <div className='max-h-80 overflow-y-auto pr-1'>
          {rows.map((row) => (
            <Link
              key={row.sourceId}
              to='/admin/monitor/sources'
              className='grid grid-cols-[1fr_auto] gap-3 border-b py-3 text-sm last:border-b-0 hover:text-primary'
            >
              <div className='min-w-0'>
                <div className='truncate font-medium'>{row.sourceName}</div>
                <div className='mt-1 text-xs text-muted-foreground'>
                  {row.category}
                </div>
              </div>
              <span
                className={`self-start rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${severityClass(row.severity)}`}
              >
                {row.severity}
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  )
}

function RecentActiveList({ rows }: { rows: RecentSource[] }) {
  return (
    <section className='rounded-xl border bg-card p-4'>
      <div className='mb-4'>
        <h2 className='font-semibold'>Son aktiv mənbələr</h2>
        <p className='mt-1 text-sm text-muted-foreground'>
          Ən son xəbər tapılan mənbələr.
        </p>
      </div>

      {rows.length === 0 ? (
        <EmptyList />
      ) : (
        <div className='max-h-80 overflow-y-auto pr-1'>
          {rows.map((row) => (
            <Link
              key={row.sourceId}
              to='/admin/monitor/sources'
              className='flex items-center justify-between gap-3 border-b py-3 text-sm last:border-b-0 hover:text-primary'
            >
              <span className='min-w-0 truncate font-medium'>
                {row.sourceName}
              </span>
              <span className='shrink-0 text-xs text-muted-foreground'>
                {row.lastArticleTime}
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  )
}

function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats>({
    activeSources: 0,
    checkedToday: 0,
    items24h: 0,
    itemsToday: 0,
    matches24h: 0,
    matchesToday: 0,
    alertsToday: null,
    problemSources: 0,
    repairNeeded: 0,
    passive7d: 0,
  })
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [charts, setCharts] = useState<DashboardCharts>({
    itemsByHour: [],
    matchesByDay: [],
    sourcesByMethod: [],
  })
  const [operations, setOperations] = useState<DashboardOperations>({
    topSources: [],
    topMatchingSources: [],
    attentionSources: [],
    recentActiveSources: [],
  })

  async function countAlertsToday(todayIso: string) {
    const result = await supabase
      .from('monitor_alerts')
      .select('id', { count: 'exact', head: true })
      .gte('sent_at', todayIso)

    return {
      count: result.error ? null : result.count || 0,
      error: result.error?.message || null,
    }
  }

  async function loadDashboard() {
    setLoading(true)
    setMessage('')

    const today = startOfToday()
    const todayIso = today.toISOString()
    const last24Iso = hoursAgo(24).toISOString()
    const last7d = daysAgo(7)
    const last7dIso = last7d.toISOString()

    const [
      sourcesResult,
      items24hResult,
      itemsTodayResult,
      matches24hResult,
      matchesTodayResult,
      alertsTodayResult,
      itemsFlowResult,
      matches7dResult,
    ] = await Promise.all([
      supabase.from('sources').select(SOURCE_FIELDS),
      supabase
        .from('monitored_items')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', last24Iso),
      supabase
        .from('monitored_items')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', todayIso),
      supabase
        .from('monitor_matches')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', last24Iso),
      supabase
        .from('monitor_matches')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', todayIso),
      countAlertsToday(todayIso),
      supabase
        .from('monitored_items')
        .select('id,created_at,source_id')
        .gte('created_at', last7dIso)
        .limit(5000),
      supabase
        .from('monitor_matches')
        .select('id,created_at,item_id')
        .gte('created_at', last7dIso)
        .limit(5000),
    ])

    const errors = [
      sourcesResult.error?.message,
      items24hResult.error?.message,
      itemsTodayResult.error?.message,
      matches24hResult.error?.message,
      matchesTodayResult.error?.message,
      alertsTodayResult.error,
      itemsFlowResult.error?.message,
      matches7dResult.error?.message,
    ].filter(Boolean)

    if (errors.length > 0) {
      setMessage(errors.join(' | '))
    }

    const sources = (sourcesResult.data || []) as SourceRow[]
    const activeSources = sources.filter((source) => source.status === 'active')
    const itemFlowRows = (itemsFlowResult.data || []) as TimedRow[]
    const match7dRows = (matches7dResult.data || []) as MatchRow[]
    const sourcesById = new Map(sources.map((source) => [source.id, source]))
    const itemSourceById = new Map(
      itemFlowRows
        .filter((item) => item.source_id)
        .map((item) => [item.id, item.source_id || ''])
    )

    setStats({
      activeSources: activeSources.length,
      checkedToday: sources.filter((source) =>
        isAfter(source.last_checked_at, today)
      ).length,
      items24h: items24hResult.count || 0,
      itemsToday: itemsTodayResult.count || 0,
      matches24h: matches24hResult.count || 0,
      matchesToday: matchesTodayResult.count || 0,
      alertsToday: alertsTodayResult.count,
      problemSources: sources.filter((source) => isProblemSource(source))
        .length,
      repairNeeded: sources.filter((source) => needsRepair(source)).length,
      passive7d: activeSources.filter(
        (source) => !isAfter(source.last_article_found_at, last7d)
      ).length,
    })
    setCharts({
      itemsByHour: buildHourlyBuckets(itemFlowRows),
      matchesByDay: buildDailyBuckets(match7dRows),
      sourcesByMethod: buildMethodBuckets(sources),
    })
    setOperations({
      topSources: buildTopSources(itemFlowRows, sourcesById),
      topMatchingSources: buildTopMatchingSources(
        match7dRows,
        itemSourceById,
        sourcesById
      ),
      attentionSources: buildAttentionSources(sources),
      recentActiveSources: buildRecentActiveSources(sources),
    })
    setLoading(false)
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadDashboard()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [])

  if (loading) return <PortalLoading label='İdarə paneli yüklənir...' />

  const cards: KpiCard[] = [
    {
      title: 'Aktiv mənbələr',
      value: stats.activeSources,
      description: 'Hazırda bot tərəfindən izlənən aktiv media mənbələri.',
      to: '/admin/monitor/sources',
    },
    {
      title: 'Bu gün yoxlanıb',
      value: stats.checkedToday,
      description: 'Bu gün ən azı bir dəfə yoxlanmış mənbələr.',
      to: '/admin/monitor/sources',
    },
    {
      title: 'Son 24 saatda xəbərlər',
      value: stats.items24h,
      description: 'Son 24 saatda bazaya düşən monitorinq xəbərləri.',
    },
    {
      title: 'Bu gün xəbərlər',
      value: stats.itemsToday,
      description: 'Bu gün bazaya yazılan yeni monitorinq xəbərləri.',
    },
    {
      title: 'Son 24 saatda uyğunluqlar',
      value: stats.matches24h,
      description: 'Açar sözlərə uyğun son 24 saatlıq nəticələr.',
    },
    {
      title: 'Bu gün uyğunluqlar',
      value: stats.matchesToday,
      description: 'Bu gün istifadəçi monitorlarına düşən uyğunluqlar.',
    },
    {
      title: 'Bu gün alertlər',
      value: stats.alertsToday,
      description: 'Bu gün qeydə alınan monitor alertləri.',
    },
    {
      title: 'Problemli mənbələr',
      value: stats.problemSources,
      description: 'Fail, site_error və ya blocked/dead/failed mənbələr.',
      to: '/admin/monitor/sources',
    },
    {
      title: 'Bərpa tələb edir',
      value: stats.repairNeeded,
      description: 'Qayda əsaslı bərpa tövsiyəsi olan mənbələr.',
      to: '/admin/monitor/sources',
    },
    {
      title: '7 gün passiv mənbələr',
      value: stats.passive7d,
      description: 'Son 7 gündə xəbər tapılmayan aktiv mənbələr.',
      to: '/admin/monitor/sources',
    },
  ]

  return (
    <div className='portal-page grid gap-5'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div>
          <h1 className='text-xl font-semibold tracking-tight'>Ana panel</h1>
          <p className='mt-1 text-sm text-muted-foreground'>
            Visual Monitor media monitorinq göstəriciləri
          </p>
        </div>
        <Link
          to='/admin/monitor/sources'
          className='inline-flex h-9 items-center rounded-md border bg-background px-3 text-sm font-medium hover:bg-muted'
        >
          Mənbələrə bax
        </Link>
      </div>

      {message ? (
        <div className='rounded-xl border bg-card p-4 text-sm text-warning'>
          {message}
        </div>
      ) : null}

      <div className='grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-5'>
        {cards.map((card) => (
          <KpiCard key={card.title} {...card} />
        ))}
      </div>

      <div className='grid gap-4 xl:grid-cols-3'>
        <VerticalChartCard
          title='Son 24 saatda xəbər axını'
          description='Bazaya yazılan xəbərlərin saatlara görə bölgüsü.'
          data={charts.itemsByHour}
        />
        <VerticalChartCard
          title='Son 7 gündə uyğunluqlar'
          description='Açar söz uyğunluqlarının günlər üzrə dinamikası.'
          data={charts.matchesByDay}
        />
        <HorizontalChartCard
          title='Mənbələr metod üzrə'
          description='Mənbələrin aktiv monitorinq metodlarına görə bölgüsü.'
          data={charts.sourcesByMethod}
        />
      </div>

      <div className='grid gap-4 xl:grid-cols-2'>
        <TopSourcesList
          title='Top mənbələr'
          description='Son 7 gündə ən çox xəbər verən mənbələr.'
          rows={operations.topSources}
          valueLabel='xəbər'
        />
        <TopSourcesList
          title='Top uyğunluq mənbələri'
          description='Son 7 gündə ən çox açar söz uyğunluğu verən mənbələr.'
          rows={operations.topMatchingSources}
          valueLabel='uyğunluq'
        />
        <AttentionList rows={operations.attentionSources} />
        <RecentActiveList rows={operations.recentActiveSources} />
      </div>

      <nav
        aria-label='İdarəetmə keçidləri'
        className='flex flex-wrap items-center gap-2 border-t pt-4'
      >
        <Link
          to='/admin/monitor/sources'
          className='rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted'
        >
          Mənbələrə keç
        </Link>
        <Link
          to='/admin/monitor/sources'
          className='rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground'
        >
          Bərpa siyahısına bax
        </Link>
        <Link
          to='/admin/users'
          className='rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground'
        >
          İstifadəçilərə bax
        </Link>
      </nav>
    </div>
  )
}

export const Route = createFileRoute('/(auth)/admin/')({
  component: DashboardPage,
})
