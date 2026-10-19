import { useEffect, useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { supabase } from '@/lib/supabase'
import { ResponsiveTable } from '@/components/ui/responsive-table'

type Source = {
  id: string
  name: string
  base_url: string
  latest_url: string | null
  rss_url: string | null
  source_type: string | null
  status: string | null
  trust_level: string | null
  monitor_method: string | null
  selector: string | null
  article_pattern: string | null
  discovery_status: string | null
  discovery_score: number | null
  last_checked_at: string | null
  last_success_at: string | null
  last_article_found_at: string | null
  last_error: string | null
  last_result: string | null
  consecutive_fail_count: number | null
  last_discovered_at: string | null
  notes: string | null
}

type SourceQualityMetrics = {
  items7d: number
  matches7d: number
  alerts7d: number
  sentNews7d: number
  lastUsefulItem: string | null
  loaded: boolean
}

type SourceDetailItem = {
  id: string
  title: string | null
  url: string | null
  published_at: string | null
  detected_at: string | null
  created_at: string | null
}

type SourceDetailMatch = {
  id: string
  item_id: string | null
  matched_keyword: string | null
  created_at: string | null
}

type RepairResponse = {
  ok: boolean
  method: string
  reason: string
  candidateCount: number
  finalUrl?: string
  sampleLinks: string[]
  update: Record<string, unknown>
  version?: string
}

type RepairRunItem = {
  sourceId: string
  sourceName: string
  ok: boolean
  method?: string
  reason: string
  candidateCount?: number
  version?: string
}

type RepairRunSummary = {
  attempted: number
  readable: number
  failed: number
  version?: string
  mode?: 'repair' | 'audit'
  methodCounts: Record<string, number>
  reasonCounts: Record<string, number>
  items: RepairRunItem[]
}

type AddSourceResult = {
  ok: boolean
  method: string
  reason: string
  candidateCount: number
  sampleLinks: string[]
  sourceName: string
}

type AddSourceOutcome = AddSourceResult & {
  inserted: boolean
  skipped?: boolean
}

function formatRepairReason(reason: string | null | undefined) {
  const text = String(reason || '').trim()
  if (!text) return 'Səbəb göstərilməyib.'

  const normalized = text.toLowerCase()
  if (normalized.includes('diagnostics=') || normalized.includes('attempts=')) {
    return text
  }

  if (
    normalized.includes('rss, sitemap and html') ||
    normalized.includes('did not return article links') ||
    normalized.includes('did not return enough verified readable article pages')
  ) {
    return 'RSS, sitemap və səhifə yoxlamasında oxuna bilən xəbər linki tapılmadı.'
  }

  if (
    normalized.includes('valid base_url') ||
    normalized.includes('latest_url not found')
  ) {
    return 'Mənbənin əsas URL-i düzgün deyil və ya tapılmadı.'
  }

  if (normalized.includes('source-repair')) {
    return 'Avtomatik bərpa xidməti cavab vermədi.'
  }

  if (normalized.includes('failed to fetch') || normalized.includes('fetch')) {
    return 'Sayta qoşulmaq mümkün olmadı. Domen, SSL və ya şəbəkə problemi ola bilər.'
  }

  return text
}

const MONITOR_METHODS = [
  'rss',
  'rss_discovered',
  'latest_page',
  'sitemap',
  'homepage',
  'selector',
  'xpath_pattern',
  'google_news_fallback',
  'recoverable',
]

const EDITABLE_MONITOR_METHODS = MONITOR_METHODS.filter(
  (method) => method !== 'rss_discovered'
)

const METHOD_FILTER_OPTIONS = [
  { value: 'rss', label: 'RSS' },
  { value: 'latest_page', label: 'Son xəbərlər səhifəsi' },
  { value: 'sitemap', label: 'Sitemap' },
  { value: 'homepage', label: 'Ana səhifə' },
  { value: 'selector', label: 'CSS Selector' },
  { value: 'xpath_pattern', label: 'XPath' },
  { value: 'google_news_fallback', label: 'Google News' },
]

const METHOD_FILTER_GROUPS: Record<string, string[]> = {
  rss: ['rss', 'rss_discovered'],
}

const SOURCE_QUALITY_LOOKBACK_DAYS = 30
const SOURCE_HEALTH_PROOF_HOURS = 36
const SOURCE_QUALITY_BATCH_SIZE = 1000

const PROTECTED_PARENT_DOMAINS = new Set([
  'az',
  'com.az',
  'edu.az',
  'gov.az',
  'net.az',
  'org.az',
  'info.az',
  'biz.az',
  'co.az',
  'ac.az',
])

const SELECTOR_TEMPLATES = [
  {
    name: 'Ümumi xəbər kartları',
    selector: 'article, .news-item, .post, .entry, .item',
    articlePattern:
      'article a[href], .news-item a[href], .post a[href], .entry a[href], .item a[href]',
    method: 'selector',
  },
  {
    name: 'Başlıq linkləri',
    selector: 'h1 a, h2 a, h3 a, .title a, .entry-title a',
    articlePattern:
      'h1 a[href], h2 a[href], h3 a[href], .title a[href], .entry-title a[href]',
    method: 'selector',
  },
  {
    name: 'Xəbər siyahısı',
    selector: '.news a, .news-list a, .latest-news a, .posts a',
    articlePattern:
      '.news a[href], .news-list a[href], .latest-news a[href], .posts a[href]',
    method: 'selector',
  },
  {
    name: 'WordPress',
    selector: 'article.post, .post, .entry',
    articlePattern:
      'article.post a[href], .post-title a[href], .entry-title a[href]',
    method: 'selector',
  },
  {
    name: 'XPath fallback',
    selector: '',
    articlePattern: '//article//a[@href] | //h2//a[@href] | //h3//a[@href]',
    method: 'xpath_pattern',
  },
]

function formatDate(value: string | null) {
  if (!value) return '—'

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) return '—'

  const formatter = new Intl.DateTimeFormat('az-AZ', {
    timeZone: 'Asia/Baku',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })

  return formatter.format(date).replace(',', '')
}

function emptyValue(value: string | null | undefined) {
  return value && value.trim() ? value : '—'
}

function mapValue(
  value: string | null | undefined,
  labels: Record<string, string>
) {
  if (!value) return '—'

  return labels[value] || value
}

function formatStatus(value: string | null) {
  return mapValue(value, {
    active: 'Aktiv',
    inactive: 'Passiv',
  })
}

function formatTrustLevel(value: string | null) {
  return mapValue(value, {
    high: 'Yüksək',
    medium: 'Orta',
    low: 'Aşağı',
  })
}

function formatSourceType(value: string | null) {
  return mapValue(value, {
    news_site: 'Xəbər saytı',
    education: 'Təhsil',
    government: 'Dövlət',
    university: 'Universitet',
    business: 'Biznes',
    unknown: 'Naməlum',
  })
}

function isEdgeBlockedRepair(
  item: Pick<RepairRunItem, 'ok' | 'method' | 'reason'>
) {
  if (item.ok) return false
  const reason = String(item.reason || '').toLowerCase()
  return (
    item.method === 'edge_blocked' ||
    reason.includes('edge environment was blocked') ||
    reason.includes('edge mühiti') ||
    (reason.includes('status=403') && reason.includes('html:'))
  )
}

function getRepairItemBadgeClass(item: RepairRunItem) {
  if (item.ok) return 'border-success/25 bg-success/10 text-success'
  if (isEdgeBlockedRepair(item))
    return 'border-warning/25 bg-warning/10 text-warning'
  return 'border-destructive/25 bg-destructive/10 text-destructive'
}

function getRepairItemLabel(item: RepairRunItem) {
  if (item.ok) return 'Oxuna bilir'
  if (isEdgeBlockedRepair(item)) return 'Edge bloklandı'
  return 'Oxunmadı'
}

function getRepairItemReason(item: RepairRunItem) {
  if (!isEdgeBlockedRepair(item)) return item.reason
  return `Edge mühiti bu sayt tərəfindən bloklandı. Mənbə ölü sayılmamalıdır; bot/Railway mühitində ayrıca yoxlama lazımdır.\n${item.reason}`
}
function formatMonitorMethod(value: string | null) {
  return mapValue(value, {
    rss: 'RSS',
    rss_discovered: 'RSS',
    selector: 'CSS Selector',
    xpath_pattern: 'XPath',
    latest_page: 'Son xəbərlər səhifəsi',
    homepage: 'Ana səhifə',
    google_news_fallback: 'Google News',
    recoverable: 'Bərpa rejimi',
    edge_blocked: 'Edge bloklandı',
    blocked: 'Bloklanıb',
    dead: 'İşləmir',
    failed: 'Xəta',
  })
}

function matchesMonitorMethodFilter(method: string | null, filter: string) {
  if (filter === 'all') return true
  const methods = METHOD_FILTER_GROUPS[filter] || [filter]
  return methods.includes(method || '')
}

function formatResult(value: string | null) {
  return mapValue(value, {
    no_candidate: 'Uyğun xəbər tapılmadı',
    old_news: 'Köhnə xəbər',
    sent: 'Göndərildi',
    duplicate: 'Təkrar xəbər',
    repair_readable: 'Oxuna bilir',
    source_open_no_article: 'Sayt açılır, xəbər linki tapılmadı',
    repair_failed: 'Bərpa alınmadı',
    site_error: 'Sayt oxunmadı',
    timeout: 'Vaxt limiti',
    parse_error: 'Parse xətası',
  })
}

function isRealErrorResult(value: string | null) {
  return [
    'site_error',
    'timeout',
    'parse_error',
    'blocked',
    'dead',
    'failed',
  ].includes(value || '')
}

function formatLastError(source: Source) {
  const nonErrorResults = ['no_candidate', 'old_news', 'sent', 'duplicate']

  if (nonErrorResults.includes(source.last_result || '')) return '—'

  if (isRealErrorResult(source.last_result) || source.last_error) {
    return emptyValue(source.last_error)
  }

  return '—'
}

function normalizeSourceUrl(value: string | null | undefined) {
  const raw = String(value || '').trim()
  if (!raw) return null

  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
    if (!['http:', 'https:'].includes(url.protocol)) return null
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

function getSelectorPickerUrl(sourceId: string) {
  return `/admin/monitor/picker?sourceId=${encodeURIComponent(sourceId)}`
}

function getHostname(url: string | null) {
  if (!url) return ''

  try {
    const normalized = url.startsWith('http') ? url : `https://${url}`
    return new URL(normalized).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return ''
  }
}

function isValidSourceHost(host: string) {
  const normalized = host
    .replace(/^www\./, '')
    .toLowerCase()
    .trim()
  const parts = normalized.split('.')

  if (parts.length < 2) return false
  if (PROTECTED_PARENT_DOMAINS.has(normalized)) return false
  if (parts.some((part) => !part || part.length > 63 || part.includes('_')))
    return false

  const tld = parts[parts.length - 1]
  if (!/^[a-z]{2,24}$/.test(tld)) return false

  return /^[a-z0-9.-]+$/.test(normalized)
}

function getSourceTitle(source: Source) {
  return (
    getHostname(source.base_url) ||
    getHostname(source.latest_url) ||
    source.name ||
    '-'
  )
}
function asSourceText(value: unknown) {
  if (value === null || value === undefined) return ''
  return String(value)
}

function asSourceNullableText(value: unknown) {
  const text = asSourceText(value).trim()
  return text || null
}

function asSourceNumber(value: unknown, fallback: number | null = null) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function sanitizeSourceRow(
  row: Partial<Source> | Record<string, unknown>,
  index: number
): Source {
  const value = row as Partial<Source> & Record<string, unknown>
  const baseUrl = asSourceText(value.base_url).trim()
  const latestUrl = asSourceNullableText(value.latest_url)
  const fallbackUrl = baseUrl || latestUrl || ''
  const host = getHostname(fallbackUrl)

  return {
    id: asSourceText(value.id).trim() || `missing-source-${index}`,
    name: asSourceText(value.name).trim() || host || `Mənbə ${index + 1}`,
    base_url: baseUrl || fallbackUrl,
    latest_url: latestUrl,
    rss_url: asSourceNullableText(value.rss_url),
    source_type: asSourceNullableText(value.source_type),
    status: asSourceNullableText(value.status) || 'inactive',
    trust_level: asSourceNullableText(value.trust_level),
    monitor_method: asSourceNullableText(value.monitor_method),
    selector: asSourceNullableText(value.selector),
    article_pattern: asSourceNullableText(value.article_pattern),
    discovery_status: asSourceNullableText(value.discovery_status),
    discovery_score: asSourceNumber(value.discovery_score),
    last_checked_at: asSourceNullableText(value.last_checked_at),
    last_success_at: asSourceNullableText(value.last_success_at),
    last_article_found_at: asSourceNullableText(value.last_article_found_at),
    last_error: asSourceNullableText(value.last_error),
    last_result: asSourceNullableText(value.last_result),
    consecutive_fail_count: asSourceNumber(value.consecutive_fail_count, 0),
    last_discovered_at: asSourceNullableText(value.last_discovered_at),
    notes: asSourceNullableText(value.notes),
  }
}

function findParentDomain(source: Source, sources: Source[]) {
  const host = getHostname(source.base_url)

  if (!host) return null

  const domains = new Set(
    sources.map((item) => getHostname(item.base_url)).filter(Boolean)
  )

  return (
    Array.from(domains)
      .filter((domain) => domain !== host)
      .filter((domain) => !PROTECTED_PARENT_DOMAINS.has(domain))
      .sort((a, b) => b.length - a.length)
      .find((domain) => host.endsWith(`.${domain}`)) || null
  )
}

function isSubdomain(source: Source, sources: Source[]) {
  return Boolean(findParentDomain(source, sources))
}

function isRssMethod(source: Source) {
  return ['rss', 'rss_discovered', 'google_news_fallback'].includes(
    source.monitor_method || ''
  )
}

function isSelectorMethod(source: Source) {
  return ['selector', 'xpath_pattern'].includes(source.monitor_method || '')
}

function isStale(source: Source) {
  if (!source.last_checked_at) return source.status === 'active'

  const checkedAt = new Date(source.last_checked_at).getTime()

  if (!Number.isFinite(checkedAt)) return true

  return Date.now() - checkedAt > 24 * 60 * 60 * 1000
}

function hasNonNewsSignal(source: Source) {
  const value = `${source.notes || ''} ${source.last_result || ''} ${
    source.last_error || ''
  }`.toLowerCase()

  return (
    value.includes('commercial_site_not_news') ||
    value.includes('insufficient_news_activity') ||
    value.includes('rejected_commercial') ||
    value.includes('rejected_inactive_news') ||
    value.includes('activity too low') ||
    value.includes('commercial site signals')
  )
}

function getSourceIssues(source: Source, sources: Source[]) {
  const issues: string[] = []

  if (
    source.status === 'active' &&
    source.discovery_status !== 'accepted' &&
    isSubdomain(source, sources)
  ) {
    issues.push('subdomain')
  }

  if (isRssMethod(source) && !(source.rss_url || '').trim()) {
    issues.push('rss yoxdur')
  }

  if (
    isSelectorMethod(source) &&
    !(source.selector || '').trim() &&
    !(source.article_pattern || '').trim()
  ) {
    issues.push('selector yoxdur')
  }

  if (hasStaleReadMethod(source)) {
    issues.push(source.monitor_method || 'problem')
  }

  if ((source.consecutive_fail_count || 0) >= 5) {
    issues.push(`fail ${source.consecutive_fail_count}`)
  }

  if (source.last_result === 'site_error') {
    issues.push('site_error')
  }

  if (hasNonNewsSignal(source)) {
    issues.push('xəbər saytı deyil')
  }

  if (source.last_result !== 'pending_check' && isStale(source)) {
    issues.push('24 saat+ yoxlanmayıb')
  }

  return issues
}

function getSimpleProblemReasons(source: Source, sources: Source[]) {
  const reasons = new Set<string>()
  const issues = getSourceIssues(source, sources)
  const lastResult = source.last_result || ''
  const lastError = (source.last_error || '').toLowerCase()

  if (lastResult === 'no_candidate') {
    reasons.add('Xəbər linki tapılmadı')
  }

  if (lastResult === 'fetch_failed' || lastResult === 'site_error') {
    reasons.add('Sayt oxunmadı')
  }

  if (lastResult === 'selector_failed') {
    reasons.add('Selector işləmədi')
  }

  if (lastError.includes('fetch_failed') || lastError.includes('site_error')) {
    reasons.add('Sayt oxunmadı')
  }

  if (lastError.includes('selector_failed')) {
    reasons.add('Selector işləmədi')
  }

  for (const issue of issues) {
    if (issue === 'rss yoxdur') {
      reasons.add('RSS tapılmadı')
    } else if (issue === 'site_error') {
      reasons.add('Sayt oxunmadı')
    } else if (issue === '24 saat+ yoxlanmayıb') {
      reasons.add('Uzun müddət yoxlanmayıb')
    } else {
      reasons.add(issue)
    }
  }

  return Array.from(reasons)
}

function getSourceHealth(source: Source, sources: Source[]) {
  const issues = getSourceIssues(source, sources)
  const failCount = source.consecutive_fail_count || 0
  const method = source.monitor_method || ''

  if (
    source.status === 'inactive' ||
    failCount >= 5 ||
    source.last_result === 'site_error' ||
    ['blocked', 'dead', 'failed'].includes(method) ||
    hasNonNewsSignal(source)
  ) {
    return 'error'
  }

  if (
    failCount > 0 ||
    source.last_result === 'no_candidate' ||
    source.discovery_status === 'needs_manual_selector' ||
    source.discovery_status === 'manual_needed' ||
    issues.length > 0
  ) {
    return 'warning'
  }

  return 'ok'
}

function getSourceHealthLabel(source: Source, sources: Source[]) {
  const health = getSourceHealth(source, sources)

  if (health === 'ok') return 'İzlənir'
  if (health === 'warning') return 'Bərpa oluna bilər'

  return 'İşləmir'
}

function sourceLookupKeys(source: Source) {
  const keys = new Set<string>()
  const name = String(source.name || '')
    .trim()
    .toLowerCase()
  if (name) keys.add(`name:${name}`)

  for (const value of [source.base_url, source.latest_url, source.rss_url]) {
    const host = getHostname(value || '')
    if (host) keys.add(`host:${host}`)
  }

  return Array.from(keys)
}

function matchItemToSourceId(
  row: { source_id?: string | null; url?: string | null },
  sourceKeyIndex: Map<string, string>,
  knownSourceIds: Set<string>
) {
  const sourceId = String(row.source_id || '')
  if (sourceId && knownSourceIds.has(sourceId)) return sourceId

  const linkHost = getHostname(String(row.url || ''))
  if (linkHost) {
    const exact = sourceKeyIndex.get(`host:${linkHost}`)
    if (exact) return exact

    const parent = Array.from(sourceKeyIndex.entries()).find(([key]) => {
      if (!key.startsWith('host:')) return false
      const host = key.slice(5)
      return linkHost === host || linkHost.endsWith(`.${host}`)
    })
    if (parent) return parent[1]
  }

  return null
}

function findSourceIdByHost(host: string, sourceKeyIndex: Map<string, string>) {
  const normalizedHost = host.replace(/^www\./, '').toLowerCase()
  const exact = sourceKeyIndex.get(`host:${normalizedHost}`)
  if (exact) return exact

  const parent = Array.from(sourceKeyIndex.entries()).find(([key]) => {
    if (!key.startsWith('host:')) return false
    const sourceHost = key.slice(5)
    return (
      normalizedHost === sourceHost ||
      normalizedHost.endsWith(`.${sourceHost}`) ||
      sourceHost.endsWith(`.${normalizedHost}`)
    )
  })
  return parent?.[1] || null
}

function possibleSourceHosts(value: string | null | undefined) {
  const text = String(value || '').toLowerCase()
  const hosts = new Set<string>()
  const directHost = getHostname(text)
  if (directHost) hosts.add(directHost)

  for (const match of text.matchAll(
    /(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)/g
  )) {
    if (match[1]) hosts.add(match[1].replace(/^www\./, ''))
  }

  return Array.from(hosts)
}

function matchSentNewsToSourceId(
  row: {
    source_id?: string | null
    link?: string | null
    source?: string | null
    title?: string | null
    created_at?: string | null
  },
  sourceKeyIndex: Map<string, string>,
  knownSourceIds: Set<string>
) {
  const directSourceId = String(row.source_id || '')
  if (directSourceId && knownSourceIds.has(directSourceId))
    return directSourceId

  for (const host of possibleSourceHosts(row.link)) {
    const sourceId = findSourceIdByHost(host, sourceKeyIndex)
    if (sourceId) return sourceId
  }

  const sourceName = String(row.source || '')
    .trim()
    .toLowerCase()
  if (sourceName) {
    const byName = sourceKeyIndex.get(`name:${sourceName}`)
    if (byName) return byName

    for (const host of possibleSourceHosts(sourceName)) {
      const sourceId = findSourceIdByHost(host, sourceKeyIndex)
      if (sourceId) return sourceId
    }
  }

  for (const host of possibleSourceHosts(row.title)) {
    const sourceId = findSourceIdByHost(host, sourceKeyIndex)
    if (sourceId) return sourceId
  }

  return null
}

function isMissingSentNewsSourceIdError(message: string) {
  const normalized = message.toLowerCase()
  return (
    normalized.includes('source_id') &&
    (normalized.includes('schema cache') ||
      normalized.includes('column') ||
      normalized.includes('could not find'))
  )
}

function emptyQualityMetrics(): SourceQualityMetrics {
  return {
    items7d: 0,
    matches7d: 0,
    alerts7d: 0,
    sentNews7d: 0,
    lastUsefulItem: null,
    loaded: false,
  }
}

type SourceHealthState = 'healthy' | 'checking' | 'problem'

type SourceView =
  | 'all'
  | 'candidate'
  | 'healthy'
  | 'problem'
  | 'checking'
  | 'failed'

type SourceProblemFilter =
  | 'all'
  | 'blocked'
  | 'not_found'
  | 'js_shell'
  | 'article_links'
  | 'timeout'
  | 'other'

type SourceCheckingFilter =
  | 'all'
  | 'readable_pending'
  | 'candidate_found'
  | 'old_news'
  | 'no_match'
  | 'old_or_no_match'
  | 'date_issue'
  | 'bot_pending'

const SOURCE_PROBLEM_FILTERS: Array<{
  key: SourceProblemFilter
  label: string
}> = [
  { key: 'all', label: 'Hamısı' },
  { key: 'blocked', label: 'Blok/403' },
  { key: 'not_found', label: '404/URL' },
  { key: 'js_shell', label: 'JS/manual' },
  { key: 'article_links', label: 'Link tapılmadı' },
  { key: 'timeout', label: 'Timeout' },
  { key: 'other', label: 'Digər' },
]

const SOURCE_CHECKING_FILTERS: Array<{
  key: SourceCheckingFilter
  label: string
}> = [
  { key: 'all', label: 'Hamısı' },
  { key: 'readable_pending', label: 'Metod tapılıb' },
  { key: 'candidate_found', label: 'Namizəd tapıb' },
  { key: 'date_issue', label: 'Tarix yoxdur' },
  { key: 'no_match', label: 'Açar söz yoxdur' },
  { key: 'old_news', label: 'Köhnə/təkrar' },
  { key: 'bot_pending', label: 'Bot sübutu gözləyir' },
]

function getTimestampMs(value: string | null | undefined) {
  if (!value) return 0
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : 0
}

function isWithinHours(value: string | null | undefined, hours: number) {
  const timestamp = getTimestampMs(value)
  if (!timestamp) return false
  return Date.now() - timestamp <= hours * 60 * 60 * 1000
}

function hasRecentTelegramActivity(metrics: SourceQualityMetrics | undefined) {
  return Boolean(
    metrics?.loaded &&
    isWithinHours(metrics.lastUsefulItem, SOURCE_HEALTH_PROOF_HOURS) &&
    (metrics.sentNews7d > 0 || metrics.alerts7d > 0)
  )
}

const BOT_READABLE_OK_RESULTS = new Set([
  'sent',
  'old_news',
  'no_date',
  'date_parse_failed',
  'future_date',
  'no_monitor_match',
  'no_keyword_match',
  'duplicate',
  'duplicate_url',
  'no_telegram_recipient',
  'telegram_disabled',
])

function hasRecentBotReadProof(source: Source) {
  if (!BOT_READABLE_OK_RESULTS.has(source.last_result || '')) return false

  if (hasBotCandidateProof(source)) {
    return (
      isWithinHours(source.last_article_found_at, SOURCE_HEALTH_PROOF_HOURS) ||
      isWithinHours(source.last_success_at, SOURCE_HEALTH_PROOF_HOURS) ||
      isWithinHours(source.last_checked_at, SOURCE_HEALTH_PROOF_HOURS)
    )
  }

  return (
    isWithinHours(source.last_article_found_at, SOURCE_HEALTH_PROOF_HOURS) ||
    isWithinHours(source.last_success_at, SOURCE_HEALTH_PROOF_HOURS)
  )
}

function getSourceDiagnosticText(source: Source) {
  return `${source.notes || ''} ${source.last_result || ''} ${
    source.last_error || ''
  }`.toLowerCase()
}

function hasTelegramSuccessNote(source: Source) {
  const notes = (source.notes || '').toLowerCase()
  return (
    notes.includes('[telegram_success]') || notes.includes('[sent_news_sync]')
  )
}

function getBotDiagnosticNumber(
  source: Source,
  key: 'bot_candidates' | 'bot_sent'
) {
  const notes = source.notes || ''
  const match = notes.match(new RegExp(`${key}=([0-9]+)`, 'i'))
  if (!match) return 0
  const value = Number(match[1])
  return Number.isFinite(value) ? value : 0
}

function hasBotSentProof(source: Source) {
  return (
    source.last_result === 'sent' ||
    getBotDiagnosticNumber(source, 'bot_sent') > 0 ||
    hasTelegramSuccessNote(source)
  )
}

function hasBotCandidateProof(source: Source) {
  return getBotDiagnosticNumber(source, 'bot_candidates') > 0
}

function hasCurrentReadableProof(source: Source) {
  return Boolean(
    source.status === 'active' &&
    !hasStaleReadMethod(source) &&
    !hasCurrentReadFailure(source) &&
    !HARD_SOURCE_RESULTS.has(source.last_error || '') &&
    (hasBotCandidateProof(source) || hasRecentBotReadProof(source))
  )
}

function hasDeliveryProof(
  source: Source,
  metrics: SourceQualityMetrics | undefined
) {
  return Boolean(hasRecentTelegramActivity(metrics) || hasBotSentProof(source))
}

function hasReadableRepairSignal(source: Source) {
  const value = getSourceDiagnosticText(source)

  return (
    source.last_result === 'repair_readable' ||
    value.includes('auto repair readable') ||
    value.includes('source repair readable') ||
    ((value.includes('rss verified:') ||
      value.includes('sitemap verified:') ||
      value.includes('html verified:')) &&
      value.includes('readable article pages')) ||
    value.includes('local bot read test verified')
  )
}

function isBotProofPendingSource(source: Source) {
  return Boolean(
    source.status === 'active' &&
    !hasStaleReadMethod(source) &&
    !HARD_SOURCE_RESULTS.has(source.last_result || '') &&
    !HARD_SOURCE_RESULTS.has(source.last_error || '') &&
    (source.last_result === 'source_added' || hasReadableRepairSignal(source))
  )
}

function hasSentNews(source: Source) {
  return Boolean(
    source.status === 'active' &&
    hasBotSentProof(source) &&
    hasCurrentReadableProof(source)
  )
}

function isHealthySource(
  source: Source,
  metrics: SourceQualityMetrics | undefined
) {
  return Boolean(
    source.status === 'active' &&
    !hasStaleReadMethod(source) &&
    hasCurrentReadableProof(source) &&
    (hasDeliveryProof(source, metrics) || hasSentNews(source))
  )
}

function isDiscoveryCandidateSource(source: Source) {
  const discoveryStatus = source.discovery_status || ''
  return Boolean(
    source.status === 'inactive' &&
    !hasNonNewsSignal(source) &&
    ['accepted', 'manual_needed', 'needs_review', 'pending'].includes(
      discoveryStatus
    ) &&
    !source.last_checked_at &&
    !source.last_result
  )
}

const REPAIRABLE_SOURCE_RESULTS = new Set([
  'fallback_empty',
  'rss_empty',
  'invalid_xml',
  'selector_empty',
  'xpath_empty',
  'sitemap_empty',
  'homepage_empty',
  'latest_page_empty',
  'no_candidate',
  'no_article',
  'repair_failed',
  'fetch_failed',
  'source_review_required',
])

const HARD_SOURCE_RESULTS = new Set([
  'http_403',
  'http_404',
  'http_429',
  'timeout',
  'dns_failure',
  'ssl_failure',
  'unsafe_url',
  'site_error',
])

const CURRENT_READ_FAILURE_RESULTS = new Set([
  ...HARD_SOURCE_RESULTS,
  ...REPAIRABLE_SOURCE_RESULTS,
])

function hasCurrentReadFailure(source: Source) {
  return CURRENT_READ_FAILURE_RESULTS.has(source.last_result || '')
}

function formatShortSourceProblem(source: Source) {
  const value = getSourceDiagnosticText(source)
  const raw = source.last_error || source.last_result || ''

  if (
    value.includes('edge environment was blocked') ||
    value.includes('edge_blocked')
  ) {
    return 'Edge/production oxuması bloklanıb'
  }

  if (
    value.includes('source_open_no_article') ||
    value.includes('source opens, but verified article links were not found')
  ) {
    return 'Sayt açılır, manual selector lazımdır'
  }

  if (value.includes('js/empty html shell'))
    return 'JS/boş HTML - selector/manual yoxlama'
  if (value.includes('canonical url/latest url review'))
    return 'Canonical URL yoxlanmalıdır'
  if (value.includes('cloudflare/ssl error')) return 'Cloudflare/SSL problemi'
  if (value.includes('links found but not enough verified'))
    return 'Article pattern/selector yoxlanmalıdır'
  if (value.includes('did not return readable article links'))
    return 'Oxuna bilən xəbər linki tapılmadı'

  if (value.includes('status=403') || value.includes('http_403'))
    return 'HTTP 403'
  if (value.includes('status=404') || value.includes('http_404'))
    return 'HTTP 404'
  if (value.includes('dns_failure')) return 'DNS problemi'
  if (value.includes('ssl_failure')) return 'SSL problemi'
  if (value.includes('timeout')) return 'Timeout'
  if (
    value.includes('did not return enough verified') ||
    value.includes('oxuna bilən xəbər linki tapılmadı')
  ) {
    return 'Oxuna bilən xəbər linki tapılmadı'
  }
  if (value.includes('rss_empty')) return 'RSS boşdur'
  if (value.includes('sitemap_empty')) return 'Sitemap boşdur'
  if (value.includes('selector_empty')) return 'Selector boşdur'
  if (value.includes('source_review_required')) return 'Manual yoxlama lazımdır'

  return raw.length > 80 ? `${raw.slice(0, 80)}...` : raw || '-'
}

function getSourceProblemFilter(source: Source): SourceProblemFilter {
  const value = getSourceDiagnosticText(source)

  if (
    value.includes('edge environment was blocked') ||
    value.includes('edge_blocked') ||
    value.includes('status=403') ||
    value.includes('http_403') ||
    value.includes('http_429')
  ) {
    return 'blocked'
  }

  if (
    value.includes('status=404') ||
    value.includes('http_404') ||
    value.includes('canonical url/latest url review')
  ) {
    return 'not_found'
  }

  if (value.includes('js/empty html shell')) {
    return 'js_shell'
  }

  if (value.includes('timeout')) return 'timeout'

  if (
    value.includes('links found but not enough verified') ||
    value.includes('did not return readable article links') ||
    value.includes('did not return enough verified') ||
    value.includes('no_article') ||
    value.includes('fallback_empty') ||
    value.includes('rss_empty') ||
    value.includes('sitemap_empty') ||
    value.includes('selector_empty')
  ) {
    return 'article_links'
  }

  return 'other'
}

function getSourceCheckingFilter(source: Source): SourceCheckingFilter {
  const value = getSourceDiagnosticText(source)
  const lastResult = source.last_result || ''
  const hasCandidateProof = hasBotCandidateProof(source)

  if (
    lastResult === 'no_date' ||
    lastResult === 'date_parse_failed' ||
    lastResult === 'future_date' ||
    value.includes('no_date') ||
    value.includes('date_parse_failed') ||
    value.includes('future_date')
  ) {
    return 'date_issue'
  }

  if (lastResult === 'no_monitor_match' || lastResult === 'no_keyword_match') {
    return 'no_match'
  }

  if (
    lastResult === 'old_news' ||
    lastResult === 'duplicate' ||
    lastResult === 'duplicate_url'
  ) {
    return 'old_news'
  }

  if (hasCandidateProof && BOT_READABLE_OK_RESULTS.has(lastResult)) {
    return 'candidate_found'
  }

  if (
    lastResult === 'repair_readable' ||
    lastResult === 'source_open_no_article' ||
    lastResult === 'source_added' ||
    hasReadableRepairSignal(source)
  ) {
    return 'readable_pending'
  }

  return 'bot_pending'
}

const READABLE_NON_PROBLEM_RESULTS = new Set([
  'old_news',
  'no_date',
  'date_parse_failed',
  'future_date',
  'no_monitor_match',
  'no_keyword_match',
  'duplicate',
  'duplicate_url',
  'sent',
  'source_open_no_article',
])

function isReadableNonProblemSource(source: Source) {
  return Boolean(
    source.status === 'active' &&
    READABLE_NON_PROBLEM_RESULTS.has(source.last_result || '') &&
    !HARD_SOURCE_RESULTS.has(source.last_error || '')
  )
}

function getSourceHealthState(
  source: Source,
  metrics?: SourceQualityMetrics
): SourceHealthState {
  const method = source.monitor_method || ''
  const failCount = source.consecutive_fail_count || 0
  const hasDeliveryHistory = hasDeliveryProof(source, metrics)

  if (isHealthySource(source, metrics)) return 'healthy'

  if (isDiscoveryCandidateSource(source)) return 'checking'

  if (
    source.status !== 'active' ||
    hasNonNewsSignal(source) ||
    HARD_SOURCE_RESULTS.has(source.last_result || '') ||
    HARD_SOURCE_RESULTS.has(source.last_error || '') ||
    ['blocked', 'dead', 'failed'].includes(method)
  ) {
    if (hasDeliveryHistory && failCount < 3 && !hasNonNewsSignal(source)) {
      return 'checking'
    }

    return 'problem'
  }

  if (isReadableNonProblemSource(source) || hasBotCandidateProof(source)) {
    return 'checking'
  }

  if (isBotProofPendingSource(source)) {
    return 'checking'
  }

  if (hasCurrentReadFailure(source) || source.last_error) {
    if (hasDeliveryHistory && failCount < 3) {
      return 'checking'
    }

    return 'problem'
  }

  if (failCount >= 5 || failCount > 0) {
    return 'problem'
  }

  return 'checking'
}

function hasStaleReadMethod(source: Source) {
  return ['blocked', 'dead', 'failed'].includes(source.monitor_method || '')
}

function isRepairTargetSource(source: Source, metrics?: SourceQualityMetrics) {
  const state = getSourceHealthState(source, metrics)
  if (state === 'healthy' && !hasStaleReadMethod(source)) return false

  return (
    state === 'problem' ||
    state === 'checking' ||
    (state === 'healthy' && hasStaleReadMethod(source))
  )
}

function getSourceQualityLabel(
  source: Source,
  metrics: SourceQualityMetrics | undefined,
  _health: ReturnType<typeof getSourceHealth>
) {
  const failCount = source.consecutive_fail_count || 0
  const data = metrics || emptyQualityMetrics()

  if (!data.loaded) {
    return {
      label: 'Yoxlan\u0131r',
      tone: 'slate',
      reason:
        'M\u0259nb\u0259 \u00fczr\u0259 real n\u0259tic\u0259 m\u0259lumat\u0131 y\u00fckl\u0259nir.',
    }
  }

  const state = getSourceHealthState(source, data)

  if (state === 'healthy') {
    const deliveredCount = Math.max(data.alerts7d, data.sentNews7d)
    return {
      label: 'Sa\u011flam m\u0259nb\u0259',
      tone: 'emerald',
      reason:
        deliveredCount > 0
          ? `${deliveredCount} bildiri\u015f - ${data.matches7d} uy\u011fun n\u0259tic\u0259`
          : `${data.matches7d} uy\u011fun n\u0259tic\u0259 tap\u0131l\u0131b`,
    }
  }

  if (state === 'checking') {
    const hasCurrentFailure =
      hasCurrentReadFailure(source) || Boolean(source.last_error)
    const checkingReason = getSourceCheckingFilter(source)

    return {
      label: 'Yoxlan\u0131r',
      tone: 'slate',
      reason:
        hasDeliveryProof(source, data) && hasCurrentFailure
          ? '\u018fvv\u0259l bildiri\u015f verib, cari oxuma yenid\u0259n t\u0259sdiq g\u00f6zl\u0259yir.'
          : checkingReason === 'date_issue'
            ? 'M\u0259nb\u0259d\u0259 namiz\u0259d link tap\u0131l\u0131r, amma x\u0259b\u0259r tarixi t\u0259sdiql\u0259nmir.'
            : checkingReason === 'no_match'
              ? 'M\u0259nb\u0259 oxunur, amma cari yoxlamada a\u00e7ar s\u00f6zl\u0259r\u0259 uy\u011fun n\u0259tic\u0259 tap\u0131lmay\u0131b.'
              : checkingReason === 'old_news'
                ? 'M\u0259nb\u0259 oxunur, amma tap\u0131lan material k\u00f6hn\u0259 v\u0259 ya t\u0259krar kimi qiym\u0259tl\u0259ndirilib.'
                : hasReadableRepairSignal(source) ||
                    source.last_result === 'source_added'
                  ? 'Oxuma metodu tap\u0131l\u0131b. Sa\u011flam status bot real n\u0259tic\u0259 ver\u0259nd\u0259 t\u0259sdiql\u0259n\u0259c\u0259k.'
                  : 'M\u0259nb\u0259 texniki oxunur, amma h\u0259l\u0259 real uy\u011fun n\u0259tic\u0259 t\u0259sdiql\u0259nm\u0259yib.',
    }
  }

  return {
    label: '\u0130\u015fl\u0259mir',
    tone: 'red',
    reason: formatShortSourceProblem(source) || `fail ${failCount}`,
  }
}
function getQualityToneClass(tone: string) {
  if (tone === 'emerald') {
    return 'border-success/25 bg-success/10 text-success'
  }
  if (tone === 'green') {
    return 'border-success/25 bg-success/10 text-success'
  }
  if (tone === 'red') {
    return 'border-destructive/25 bg-destructive/10 text-destructive'
  }
  if (tone === 'amber') {
    return 'border-warning/25 bg-warning/10 text-warning'
  }
  if (tone === 'orange') {
    return 'border-warning/25 bg-warning/10 text-warning'
  }
  return 'border-border bg-muted text-foreground'
}

function getBotConfirmationLabel(
  source: Source,
  metrics: SourceQualityMetrics | undefined
) {
  const data = metrics || emptyQualityMetrics()
  const failCount = source.consecutive_fail_count || 0

  if (data.loaded && data.sentNews7d > 0) {
    return { label: `${data.sentNews7d} bildiriş`, tone: 'success' }
  }

  if (data.loaded && data.alerts7d > 0) {
    return { label: `${data.alerts7d} bildiriş`, tone: 'success' }
  }

  if (data.loaded && data.matches7d > 0) {
    return { label: `${data.matches7d} uyğun nəticə`, tone: 'success' }
  }

  if (source.last_result === 'source_open_no_article') {
    return { label: 'Manual selector lazımdır', tone: 'warning' }
  }

  if (
    source.last_result === 'source_added' ||
    isBotProofPendingSource(source)
  ) {
    return { label: 'Bot yoxlaması gözlənilir', tone: 'neutral' }
  }

  if (isReadableNonProblemSource(source)) {
    return { label: 'Bot oxudu', tone: 'success' }
  }

  if (
    ['repair_failed', 'site_error', 'fetch_failed'].includes(
      source.last_result || ''
    ) ||
    failCount > 0
  ) {
    return { label: 'Problem var', tone: 'danger' }
  }

  return { label: 'Nəticə yoxdur', tone: 'neutral' }
}

function getBotConfirmationToneClass(tone: string) {
  if (tone === 'success') {
    return 'border-success/25 bg-success/10 text-success'
  }

  if (tone === 'warning') {
    return 'border-warning/25 bg-warning/10 text-warning'
  }

  if (tone === 'danger') {
    return 'border-destructive/25 bg-destructive/10 text-destructive'
  }

  return 'border-border bg-muted text-foreground'
}

function getRepairSuggestion(source: Source, metrics: SourceQualityMetrics) {
  const failCount = source.consecutive_fail_count || 0

  if (failCount >= 5) {
    return 'Fail sayı yüksəkdir. Bərpa/test tövsiyə olunur.'
  }

  if (
    source.last_success_at &&
    metrics.loaded &&
    metrics.items7d === 0 &&
    metrics.matches7d === 0
  ) {
    return 'Son 7 gündə nəticə yoxdur. RSS və ya selector yoxlanmalıdır.'
  }

  if (source.monitor_method === 'selector' && (source.rss_url || '').trim()) {
    return 'Bu mənbədə RSS görünür. RSS metodu daha stabil ola bilər.'
  }

  if (source.last_result === 'no_candidate') {
    return 'Bot uyğun xəbər tapmayıb. Oxuma metodu yenidən yoxlanmalıdır.'
  }

  return 'Ciddi problem görünmür.'
}

function SourcesPage() {
  const [sources, setSources] = useState<Source[]>([])
  const [sourceQuality, setSourceQuality] = useState<
    Record<string, SourceQualityMetrics>
  >({})
  const [, setQualityLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [methodFilter, setMethodFilter] = useState('all')
  const [sourceView, setSourceView] = useState<SourceView>('all')
  const [problemFilter, setProblemFilter] = useState<SourceProblemFilter>('all')
  const [checkingFilter, setCheckingFilter] =
    useState<SourceCheckingFilter>('all')
  const [bulkMethod, setBulkMethod] = useState('google_news_fallback')
  const [editing, setEditing] = useState<Source | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [message, setMessage] = useState('')
  const [bulkAddMode, setBulkAddMode] = useState(false)
  const [newSourceInput, setNewSourceInput] = useState('')
  const [bulkSourceInput, setBulkSourceInput] = useState('')
  const [addingSource, setAddingSource] = useState(false)
  const [addSourceResult, setAddSourceResult] =
    useState<AddSourceResult | null>(null)
  const [recovering, setRecovering] = useState(false)
  const [repairRun, setRepairRun] = useState<RepairRunSummary | null>(null)
  const [openActionId, setOpenActionId] = useState<string | null>(null)
  const [detailSource, setDetailSource] = useState<Source | null>(null)
  const [detailItems, setDetailItems] = useState<SourceDetailItem[]>([])
  const [detailMatches, setDetailMatches] = useState<SourceDetailMatch[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = 25

  async function loadSourceQuality(nextSources: Source[]) {
    const sourceIds = nextSources.map((source) => source.id).filter(Boolean)
    const knownSourceIds = new Set(sourceIds)
    const initialQuality = new Map<string, SourceQualityMetrics>()

    for (const sourceId of sourceIds) {
      initialQuality.set(sourceId, { ...emptyQualityMetrics(), loaded: true })
    }

    if (sourceIds.length === 0) {
      setSourceQuality({})
      return
    }

    setQualityLoading(true)

    const since = new Date(
      Date.now() - SOURCE_QUALITY_LOOKBACK_DAYS * 24 * 60 * 60 * 1000
    ).toISOString()
    const sourceKeyIndex = new Map<string, string>()
    for (const source of nextSources) {
      for (const key of sourceLookupKeys(source)) {
        if (!sourceKeyIndex.has(key)) sourceKeyIndex.set(key, source.id)
      }
    }

    const { data: items, error: itemsError } = await supabase
      .from('monitored_items')
      .select('id,source_id,url,created_at')
      .gte('created_at', since)
      .limit(10000)

    if (itemsError) {
      console.warn('Source quality items query failed:', itemsError.message)
      setSourceQuality(Object.fromEntries(initialQuality))
      setQualityLoading(false)
      return
    }

    const itemToSource = new Map<string, string>()
    const matchToSource = new Map<string, string>()

    for (const item of items || []) {
      const sourceId = matchItemToSourceId(item, sourceKeyIndex, knownSourceIds)
      const itemId = String(item.id || '')

      if (!sourceId || !initialQuality.has(sourceId)) continue

      const metrics = initialQuality.get(sourceId) || {
        ...emptyQualityMetrics(),
        loaded: true,
      }
      metrics.items7d += 1

      const createdAt = item.created_at ? String(item.created_at) : null
      if (
        createdAt &&
        (!metrics.lastUsefulItem ||
          new Date(createdAt).getTime() >
            new Date(metrics.lastUsefulItem).getTime())
      ) {
        metrics.lastUsefulItem = createdAt
      }

      initialQuality.set(sourceId, metrics)

      if (itemId) {
        itemToSource.set(itemId, sourceId)
      }
    }

    let sentOffset = 0
    let includeSentNewsSourceId = true
    while (true) {
      const sentNewsSelect: string = includeSentNewsSourceId
        ? 'source_id,link,title,source,created_at'
        : 'link,title,source,created_at'
      const { data: sentNews, error: sentNewsError } = await supabase
        .from('sent_news')
        .select(sentNewsSelect)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .range(sentOffset, sentOffset + SOURCE_QUALITY_BATCH_SIZE - 1)

      if (sentNewsError) {
        if (
          includeSentNewsSourceId &&
          isMissingSentNewsSourceIdError(sentNewsError.message)
        ) {
          includeSentNewsSourceId = false
          sentOffset = 0
          continue
        }

        console.warn(
          'Source quality sent_news query failed:',
          sentNewsError.message
        )
        break
      }

      const batch = (sentNews || []) as unknown as Array<{
        source_id?: string | null
        link?: string | null
        source?: string | null
        title?: string | null
        created_at?: string | null
      }>
      for (const row of batch) {
        const sourceId = matchSentNewsToSourceId(
          row,
          sourceKeyIndex,
          knownSourceIds
        )
        if (!sourceId) continue

        const metrics = initialQuality.get(sourceId) || {
          ...emptyQualityMetrics(),
          loaded: true,
        }
        metrics.sentNews7d += 1
        metrics.items7d = Math.max(metrics.items7d, metrics.sentNews7d)
        metrics.matches7d = Math.max(metrics.matches7d, metrics.sentNews7d)
        metrics.alerts7d = Math.max(metrics.alerts7d, metrics.sentNews7d)

        const createdAt = row.created_at ? String(row.created_at) : null
        if (
          createdAt &&
          (!metrics.lastUsefulItem ||
            new Date(createdAt).getTime() >
              new Date(metrics.lastUsefulItem).getTime())
        ) {
          metrics.lastUsefulItem = createdAt
        }

        initialQuality.set(sourceId, metrics)
      }

      if (batch.length < SOURCE_QUALITY_BATCH_SIZE) break
      sentOffset += SOURCE_QUALITY_BATCH_SIZE
    }

    const { data: resultMatches, error: resultMatchesError } = await supabase
      .from('monitor_matches')
      .select('id,item_id,created_at,monitored_items(source_id,url)')
      .gte('created_at', since)
      .limit(10000)

    if (resultMatchesError) {
      console.warn(
        'Source quality result matches query failed:',
        resultMatchesError.message
      )
    } else {
      for (const match of resultMatches || []) {
        const item = Array.isArray(match.monitored_items)
          ? match.monitored_items[0]
          : match.monitored_items
        const sourceId =
          matchItemToSourceId(item || {}, sourceKeyIndex, knownSourceIds) ||
          itemToSource.get(String(match.item_id || ''))
        const matchId = String(match.id || '')
        if (!sourceId) continue

        const metrics = initialQuality.get(sourceId) || {
          ...emptyQualityMetrics(),
          loaded: true,
        }
        metrics.items7d = Math.max(metrics.items7d, 1)
        metrics.matches7d += 1

        const createdAt = match.created_at ? String(match.created_at) : null
        if (
          createdAt &&
          (!metrics.lastUsefulItem ||
            new Date(createdAt).getTime() >
              new Date(metrics.lastUsefulItem).getTime())
        ) {
          metrics.lastUsefulItem = createdAt
        }

        initialQuality.set(sourceId, metrics)
        if (matchId) matchToSource.set(matchId, sourceId)
      }
    }

    if (matchToSource.size > 0) {
      const { data: alerts, error: alertsError } = await supabase
        .from('monitor_alerts')
        .select('match_id,sent_at')
        .gte('sent_at', since)
        .limit(10000)

      if (alertsError) {
        console.warn('Source quality alerts query failed:', alertsError.message)
      } else {
        for (const alert of alerts || []) {
          const sourceId = matchToSource.get(String(alert.match_id || ''))
          if (!sourceId) continue

          const metrics = initialQuality.get(sourceId) || {
            ...emptyQualityMetrics(),
            loaded: true,
          }
          metrics.alerts7d += 1
          initialQuality.set(sourceId, metrics)
        }
      }
    }

    setSourceQuality(Object.fromEntries(initialQuality))
    setQualityLoading(false)
  }

  async function loadSourceDetails(source: Source) {
    setDetailSource(source)
    setDetailItems([])
    setDetailMatches([])
    setDetailError('')
    setDetailLoading(true)

    const { data: items, error: itemsError } = await supabase
      .from('monitored_items')
      .select('id,title,url,published_at,detected_at,created_at')
      .eq('source_id', source.id)
      .order('created_at', { ascending: false })
      .limit(10)

    if (itemsError) {
      setDetailError(`Son xəbərlər oxunmadı: ${itemsError.message}`)
      setDetailLoading(false)
      return
    }

    const nextItems = (items || []) as SourceDetailItem[]
    setDetailItems(nextItems)

    const itemIds = nextItems.map((item) => item.id).filter(Boolean)

    if (itemIds.length === 0) {
      setDetailMatches([])
      setDetailLoading(false)
      return
    }

    const { data: matches, error: matchesError } = await supabase
      .from('monitor_matches')
      .select('id,item_id,matched_keyword,created_at')
      .in('item_id', itemIds)
      .order('created_at', { ascending: false })
      .limit(10)

    if (matchesError) {
      setDetailError(`Uyğunluqlar oxunmadı: ${matchesError.message}`)
      setDetailMatches([])
    } else {
      setDetailMatches((matches || []) as SourceDetailMatch[])
    }

    setDetailLoading(false)
  }

  async function loadSources() {
    setLoading(true)
    setMessage('')

    const { data, error } = await supabase
      .from('sources')
      .select(
        'id,name,base_url,latest_url,rss_url,source_type,status,trust_level,monitor_method,selector,article_pattern,discovery_status,discovery_score,last_checked_at,last_success_at,last_article_found_at,last_error,last_result,consecutive_fail_count,last_discovered_at,notes'
      )
      .order('last_discovered_at', {
        ascending: false,
        nullsFirst: false,
      })

    if (error) {
      setMessage(`Mənbələr oxunmadı: ${error.message}`)
      setSources([])
      setSourceQuality({})
      setLoading(false)
      return
    }

    const nextSources = (data || []).map((row, index) =>
      sanitizeSourceRow(row, index)
    )
    setSources(nextSources)
    setLoading(false)

    window.setTimeout(() => {
      void loadSourceQuality(nextSources)
    }, 0)
  }

  function getExistingSourceHosts() {
    return new Set(
      sources
        .map(
          (source) =>
            getHostname(source.base_url) || getHostname(source.latest_url)
        )
        .filter(Boolean)
    )
  }

  function parseBulkSourceLines(value: string) {
    const seen = new Set<string>()
    const parsed: Array<{
      input: string
      normalizedUrl: string
      host: string
    }> = []
    let invalid = 0

    for (const raw of value.split(/[\n,;]+/)) {
      const input = raw.trim()
      if (!input) continue

      const normalizedUrl = normalizeSourceUrl(input)
      const host = getHostname(normalizedUrl)
      if (!normalizedUrl || !host || !isValidSourceHost(host)) {
        invalid += 1
        continue
      }
      if (seen.has(host)) continue

      seen.add(host)
      parsed.push({ input, normalizedUrl, host })
    }

    return { parsed, invalid }
  }

  async function addOneSource(
    normalizedUrl: string,
    host: string,
    existingHosts: Set<string>
  ): Promise<AddSourceOutcome> {
    if (existingHosts.has(host)) {
      return {
        inserted: false,
        skipped: true,
        ok: false,
        method: 'duplicate',
        reason: 'Mənbə artıq siyahıdadır.',
        candidateCount: 0,
        sampleLinks: [],
        sourceName: host,
      }
    }

    const sourceDraft: Source = {
      id: `new-${Date.now()}-${host}`,
      name: host,
      base_url: normalizedUrl,
      latest_url: normalizedUrl,
      rss_url: null,
      source_type: 'news_site',
      status: 'active',
      trust_level: 'medium',
      monitor_method: 'latest_page',
      selector: null,
      article_pattern: null,
      discovery_status: 'pending',
      discovery_score: 0,
      last_checked_at: null,
      last_success_at: null,
      last_article_found_at: null,
      last_error: null,
      last_result: null,
      consecutive_fail_count: 0,
      last_discovered_at: new Date().toISOString(),
      notes: null,
    }

    let repair: RepairResponse | null = null
    let repairErrorMessage: string

    try {
      const response = await supabase.functions.invoke<RepairResponse>(
        'source-repair',
        {
          body: { source: sourceDraft },
        }
      )
      repair = response.data ?? null
      repairErrorMessage = response.error?.message || ''
    } catch (error) {
      repairErrorMessage =
        error instanceof Error ? error.message : 'source-repair xətası'
    }

    if (repairErrorMessage || !repair) {
      return {
        inserted: false,
        ok: false,
        method: 'analysis_failed',
        reason: repairErrorMessage || 'source-repair cavab vermədi',
        candidateCount: 0,
        sampleLinks: [],
        sourceName: host,
      }
    }

    const now = new Date().toISOString()
    const update = repair.update || {}
    const insertPayload = {
      name: host,
      base_url: normalizedUrl,
      latest_url: String(repair.finalUrl || normalizedUrl),
      rss_url: typeof update.rss_url === 'string' ? update.rss_url : null,
      source_type: 'news_site',
      status: repair.ok ? 'active' : 'inactive',
      trust_level: 'medium',
      monitor_method: repair.ok ? repair.method : 'failed',
      selector: typeof update.selector === 'string' ? update.selector : null,
      article_pattern:
        typeof update.article_pattern === 'string'
          ? update.article_pattern
          : null,
      discovery_status: repair.ok ? 'accepted' : 'needs_review',
      discovery_score: repair.ok
        ? Math.min(100, 60 + repair.candidateCount * 4)
        : 0,
      last_checked_at: now,
      last_success_at: null,
      last_article_found_at: null,
      last_error: repair.ok ? null : repair.reason,
      last_result: repair.ok ? 'source_added' : 'source_review_required',
      consecutive_fail_count: repair.ok ? 0 : 1,
      last_discovered_at: now,
      notes: repair.ok
        ? `[manual_add] ${repair.method} metodu seçildi. ${repair.candidateCount} link tapıldı.`
        : `[manual_add] Avtomatik izləmə metodu tapılmadı: ${formatRepairReason(repair.reason)}`,
    }

    const { error: insertError } = await supabase
      .from('sources')
      .insert(insertPayload)

    if (insertError) {
      return {
        inserted: false,
        ok: false,
        method: repair.method,
        reason: insertError.message,
        candidateCount: repair.candidateCount,
        sampleLinks: repair.sampleLinks || [],
        sourceName: host,
      }
    }

    existingHosts.add(host)

    return {
      inserted: true,
      ok: repair.ok,
      method: repair.method,
      reason: formatRepairReason(repair.reason),
      candidateCount: repair.candidateCount,
      sampleLinks: repair.sampleLinks || [],
      sourceName: host,
    }
  }

  async function addSourceByDomain() {
    const normalizedUrl = normalizeSourceUrl(newSourceInput)
    const host = getHostname(normalizedUrl)

    if (!normalizedUrl || !host || !isValidSourceHost(host)) {
      setMessage('Düzgün domen və ya URL daxil edin. Məsələn: example.az')
      return
    }

    setAddingSource(true)
    setAddSourceResult(null)
    setMessage(
      `${host} yoxlanılır. Sistem RSS, sitemap və səhifə linklərini analiz edir...`
    )

    try {
      const result = await addOneSource(
        normalizedUrl,
        host,
        getExistingSourceHosts()
      )

      if (result.skipped) {
        setMessage(`${host} artıq mənbələr siyahısında var.`)
        setSearch(host)
        return
      }

      if (!result.inserted) {
        setMessage(
          `${host} əlavə olunmadı: ${formatRepairReason(result.reason)}`
        )
        return
      }

      setNewSourceInput('')
      setAddSourceResult(result)
      setMessage(
        result.ok
          ? `${host} əlavə olundu və ${result.method} metodu ilə yoxlanılır.`
          : `${host} əlavə olundu, amma avtomatik izləmə metodu tapılmadı. Mənbə yoxlama tələb edir.`
      )
      await loadSources()
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'naməlum xəta'
      setMessage(`${host} əlavə olunmadı: ${reason}`)
    } finally {
      setAddingSource(false)
    }
  }
  async function addBulkSources() {
    const { parsed, invalid } = parseBulkSourceLines(bulkSourceInput)

    if (parsed.length === 0) {
      setMessage(
        'Toplu əlavə üçün ən azı bir düzgün domen və ya URL daxil edin.'
      )
      return
    }

    setAddingSource(true)
    setAddSourceResult(null)
    setMessage(
      `${parsed.length} mənbə yoxlanılır. Bu proses bir qədər vaxt ala bilər...`
    )

    try {
      const existingHosts = getExistingSourceHosts()
      const results: AddSourceOutcome[] = []

      for (const item of parsed) {
        const result = await addOneSource(
          item.normalizedUrl,
          item.host,
          existingHosts
        )
        results.push(result)
      }

      const inserted = results.filter((item) => item.inserted).length
      const readable = results.filter((item) => item.inserted && item.ok).length
      const review = results.filter((item) => item.inserted && !item.ok).length
      const skipped = results.filter((item) => item.skipped).length
      const failed = results.filter(
        (item) => !item.inserted && !item.skipped
      ).length
      const lastInserted = [...results].reverse().find((item) => item.inserted)

      if (lastInserted) setAddSourceResult(lastInserted)

      setBulkSourceInput('')
      setMessage(
        `Toplu əlavə tamamlandı: ${inserted} əlavə olundu, ${readable} oxuna bilir, ${review} yoxlama tələb edir, ${skipped} təkrar atlandı, ${failed} əlavə olunmadı${
          invalid ? `, ${invalid} yanlış sətir atlandı` : ''
        }.`
      )
      await loadSources()
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'naməlum xəta'
      setMessage(`Toplu əlavə tamamlanmadı: ${reason}`)
    } finally {
      setAddingSource(false)
    }
  }
  async function deleteSource(source: Source) {
    const ok = window.confirm(
      `"${getSourceTitle(source)}" mənbəsini silmək istəyirsən? Bu əməliyyat geri qaytarılmır.`
    )

    if (!ok) return

    const { error } = await supabase
      .from('sources')
      .delete()
      .eq('id', source.id)

    if (error) {
      alert('Silinmədi: ' + error.message)
      return
    }

    setSelectedIds((current) => current.filter((id) => id !== source.id))
    await loadSources()
  }

  async function deleteSelectedSources() {
    if (selectedIds.length === 0) {
      alert('Silinəcək mənbə seçilməyib.')
      return
    }

    const ok = window.confirm(
      `${selectedIds.length} mənbəni silmək istəyirsən? Bu əməliyyat geri qaytarılmır.`
    )

    if (!ok) return

    const { error } = await supabase
      .from('sources')
      .delete()
      .in('id', selectedIds)

    if (error) {
      alert('Seçilən mənbələr silinmədi: ' + error.message)
      return
    }

    setSelectedIds([])
    await loadSources()
  }

  async function activateSelectedSourcesWithRepair() {
    if (selectedIds.length === 0) {
      alert('Mənbə seçilməyib.')
      return
    }

    const selectedSourceSet = new Set(selectedIds)
    const selectedSources = sources.filter((source) =>
      selectedSourceSet.has(source.id)
    )
    const sourcesToActivate = selectedSources.filter(
      (source) => source.status !== 'active'
    )

    if (selectedSources.length === 0) {
      alert(
        'Seçilmiş mənbə siyahıda tapılmadı. Səhifəni yeniləyib yenidən seçin.'
      )
      return
    }

    if (sourcesToActivate.length === 0) {
      alert('Seçilmiş mənbələr artıq aktivdir.')
      return
    }

    const skippedCount = selectedSources.length - sourcesToActivate.length
    const ok = window.confirm(
      `${sourcesToActivate.length} passiv/yeni mənbə real oxuma testi ilə aktivləşdiriləcək${
        skippedCount > 0
          ? `; ${skippedCount} artıq aktiv olduğu üçün ötürüləcək`
          : ''
      }. Davam edək?`
    )

    if (!ok) return

    setRecovering(true)
    setMessage(
      `${sourcesToActivate.length} mənbə aktivləşdirmədən əvvəl real oxuma testi ilə yoxlanır...`
    )
    setRepairRun(null)

    let readable = 0
    let failed = 0
    const methodCounts: Record<string, number> = {}
    const reasonCounts: Record<string, number> = {}
    const items: RepairRunItem[] = []

    let repairVersion = ''
    for (const source of sourcesToActivate) {
      const result = await runAutoRepair(source)
      if (result.ok) readable += 1
      else failed += 1
      if (result.version && !repairVersion) repairVersion = result.version

      const method = result.method || 'unknown'
      const reason = formatRepairReason(
        result.reason || result.message || 'Naməlum səbəb'
      )

      if (result.ok) {
        methodCounts[method] = (methodCounts[method] || 0) + 1
      } else {
        reasonCounts[reason] = (reasonCounts[reason] || 0) + 1
      }

      items.push({
        sourceId: result.sourceId,
        sourceName: result.sourceName,
        ok: result.ok,
        method: result.method,
        reason,
        candidateCount: result.candidateCount,
        version: result.version,
      })
    }

    setRecovering(false)
    setSelectedIds([])
    await loadSources()
    setRepairRun({
      attempted: sourcesToActivate.length,
      readable,
      failed,
      version: repairVersion || undefined,
      methodCounts,
      reasonCounts,
      items,
    })
    setMessage(
      `Aktivləşdirmə testi bitdi: ${readable} mənbə oxuna bilir və yoxlanılan mənbələrə keçdi, ${failed} mənbə aktiv edilmədi. Sağlam statusu bot real nəticə/Telegram sübutu verdikdən sonra təsdiqlənəcək.`
    )
  }

  async function bulkSetStatus(status: 'active' | 'inactive') {
    if (selectedIds.length === 0) {
      alert('Mənbə seçilməyib.')
      return
    }

    if (status === 'active') {
      await activateSelectedSourcesWithRepair()
      return
    }

    const { error } = await supabase
      .from('sources')
      .update({ status })
      .in('id', selectedIds)

    if (error) {
      alert('Status dəyişmədi: ' + error.message)
      return
    }

    setSelectedIds([])
    await loadSources()
  }

  async function bulkSetMethod() {
    if (selectedIds.length === 0) {
      alert('Metodu dəyişmək üçün mənbə seçilməyib.')
      return
    }

    const ok = window.confirm(
      `${selectedIds.length} mənbənin monitor metodu "${bulkMethod}" olacaq. Davam edəkNo`
    )

    if (!ok) return

    const { error } = await supabase
      .from('sources')
      .update({
        monitor_method: bulkMethod,
        status: 'active',
        notes: `Admin paneldən toplu metod dəyişildi: ${bulkMethod}`,
      })
      .in('id', selectedIds)

    if (error) {
      alert('Metod dəyişmədi: ' + error.message)
      return
    }

    setSelectedIds([])
    await loadSources()
  }

  async function deactivateSubdomains() {
    const subdomainIds = sources
      .filter((source) => source.status === 'active')
      .filter((source) => isSubdomain(source, sources))
      .map((source) => source.id)

    if (subdomainIds.length === 0) {
      alert('Aktiv subdomain tapılmadı.')
      return
    }

    const ok = window.confirm(
      `${subdomainIds.length} aktiv subdomain passiv ediləcək. Davam edəkNo`
    )

    if (!ok) return

    const { error } = await supabase
      .from('sources')
      .update({
        status: 'inactive',
        notes: 'Subdomain olduğu üçün admin paneldən passiv edildi',
      })
      .in('id', subdomainIds)

    if (error) {
      alert('Subdomainlər passiv edilmədi: ' + error.message)
      return
    }

    setSelectedIds([])
    await loadSources()
  }

  async function deactivateFailingSources() {
    const failingIds = sources
      .filter((source) => source.status === 'active')
      .filter((source) => (source.consecutive_fail_count || 0) >= 5)
      .map((source) => source.id)

    if (failingIds.length === 0) {
      alert('Fail limitini keçən aktiv mənbə tapılmadı.')
      return
    }

    const ok = window.confirm(
      `${failingIds.length} fail-limit mənbə passiv ediləcək. Davam edəkNo`
    )

    if (!ok) return

    const { error } = await supabase
      .from('sources')
      .update({
        status: 'inactive',
        notes: 'Fail limiti keçdiyi üçün admin paneldən passiv edildi',
      })
      .in('id', failingIds)

    if (error) {
      alert('Fail-limit mənbələr passiv edilmədi: ' + error.message)
      return
    }

    setSelectedIds([])
    await loadSources()
  }

  async function deactivateNonNewsSources() {
    const nonNewsIds = sources
      .filter((source) => source.status === 'active')
      .filter((source) => hasNonNewsSignal(source))
      .map((source) => source.id)

    if (nonNewsIds.length === 0) {
      alert('Qeyri-xəbər siqnalı olan aktiv mənbə tapılmadı.')
      return
    }

    const ok = window.confirm(
      `${nonNewsIds.length} qeyri-xəbər/inaktiv mənbə passiv ediləcək. Davam edəkNo`
    )

    if (!ok) return

    const { error } = await supabase
      .from('sources')
      .update({
        status: 'inactive',
        discovery_status: 'rejected',
        notes:
          'Qeyri-xəbər və ya yetərsiz aktivlik səbəbi ilə admin paneldən passiv edildi',
      })
      .in('id', nonNewsIds)

    if (error) {
      alert('Qeyri-xəbər mənbələr passiv edilmədi: ' + error.message)
      return
    }

    setSelectedIds([])
    await loadSources()
  }

  async function runAutoRepair(source: Source) {
    const sourceName = getSourceTitle(source)
    const { data: repair, error: repairError } =
      await supabase.functions.invoke<RepairResponse>('source-repair', {
        body: { source },
      })

    if (repairError || !repair) {
      return {
        sourceId: source.id,
        sourceName,
        ok: false,
        message: formatRepairReason(
          repairError?.message || 'source-repair cavab vermədi'
        ),
        reason: formatRepairReason(
          repairError?.message || 'source-repair cavab vermədi'
        ),
      }
    }

    if (!repair.ok && isHealthySource(source, sourceQuality[source.id])) {
      return {
        sourceId: source.id,
        sourceName,
        ok: false,
        method: repair.method,
        reason: formatRepairReason(repair.reason),
        candidateCount: repair.candidateCount,
        version: repair.version,
        message: `${getSourceTitle(source)} real bildiri\u015f tarix\u00e7\u0259sin\u0259 g\u00f6r\u0259 sa\u011flam saxlan\u0131ld\u0131. U\u011fursuz manual b\u0259rpa testi m\u0259nb\u0259nin statusunu d\u0259yi\u015fm\u0259di.`,
      }
    }

    const repairUpdate = repair.ok
      ? {
          ...repair.update,
          last_checked_at: null,
          last_result: 'repair_readable',
          last_error: null,
          consecutive_fail_count: 0,
        }
      : repair.update

    const { data: updated, error: updateError } = await supabase
      .from('sources')
      .update(repairUpdate)
      .eq('id', source.id)
      .select('id')

    if (updateError || !updated || updated.length === 0) {
      return {
        sourceId: source.id,
        sourceName,
        ok: false,
        message: formatRepairReason(
          updateError?.message || 'Supabase mənbəni yeniləmədi'
        ),
        method: repair.method,
        reason: formatRepairReason(
          updateError?.message || 'Supabase mənbəni yeniləmədi'
        ),
        candidateCount: repair.candidateCount,
        version: repair.version,
      }
    }

    return {
      sourceId: source.id,
      sourceName,
      ok: repair.ok,
      method: repair.method,
      reason: formatRepairReason(repair.reason),
      candidateCount: repair.candidateCount,
      version: repair.version,
      message: repair.ok
        ? `${getSourceTitle(source)} oxuna bilir: ${repair.method}, ${repair.candidateCount} link tapıldı. Bot təsdiqi gözlənilir.`
        : `${getSourceTitle(source)} bərpa olunmadı: ${formatRepairReason(repair.reason)}`,
    }
  }

  async function runReadOnlySourceCheck(
    source: Source
  ): Promise<RepairRunItem> {
    const sourceName = getSourceTitle(source)
    const { data: repair, error: repairError } =
      await supabase.functions.invoke<RepairResponse>('source-repair', {
        body: { source },
      })

    if (repairError || !repair) {
      return {
        sourceId: source.id,
        sourceName,
        ok: false,
        reason: formatRepairReason(
          repairError?.message || 'source-repair cavab vermədi'
        ),
      }
    }

    return {
      sourceId: source.id,
      sourceName,
      ok: repair.ok,
      method: repair.method,
      reason: repair.ok
        ? `Canlı yoxlama oxuya bildi: ${formatMonitorMethod(repair.method)}, ${repair.candidateCount} link tapıldı. DB statusu dəyişdirilmədi.`
        : formatRepairReason(repair.reason),
      candidateCount: repair.candidateCount,
      version: repair.version,
    }
  }

  async function auditSelectedHealthySources() {
    if (selectedIds.length === 0) {
      alert('Canlı yoxlama üçün sağlam mənbə seçin.')
      return
    }

    const selectedSourceSet = new Set(selectedIds)
    const selectedSources = sources.filter((source) =>
      selectedSourceSet.has(source.id)
    )
    const sourcesToAudit = selectedSources.filter((source) =>
      isHealthySource(source, sourceQuality[source.id])
    )

    if (selectedSources.length === 0) {
      alert(
        'Seçilmiş mənbə siyahıda tapılmadı. Səhifəni yeniləyib yenidən seçin.'
      )
      return
    }

    if (sourcesToAudit.length === 0) {
      alert('Seçilmiş mənbələr arasında sağlam mənbə tapılmadı.')
      return
    }

    const skippedCount = selectedSources.length - sourcesToAudit.length
    const ok = window.confirm(
      `${sourcesToAudit.length} sağlam mənbə canlı oxuma testi ilə yoxlanacaq${
        skippedCount > 0
          ? `; ${skippedCount} sağlam olmadığı üçün ötürüləcək`
          : ''
      }. Bu yoxlama DB statusunu dəyişməyəcək. Davam edək?`
    )

    if (!ok) return

    setRecovering(true)
    setMessage(
      `${sourcesToAudit.length} sağlam mənbə canlı oxuma testi ilə yoxlanır...`
    )
    setRepairRun(null)

    let readable = 0
    let failed = 0
    const methodCounts: Record<string, number> = {}
    const reasonCounts: Record<string, number> = {}
    const items: RepairRunItem[] = []
    let repairVersion = ''

    for (const source of sourcesToAudit) {
      const result = await runReadOnlySourceCheck(source)
      if (result.ok) readable += 1
      else failed += 1
      if (result.version && !repairVersion) repairVersion = result.version

      const method = result.method || 'unknown'
      const reason = formatRepairReason(result.reason || 'Naməlum səbəb')

      if (result.ok) {
        methodCounts[method] = (methodCounts[method] || 0) + 1
      } else {
        reasonCounts[reason] = (reasonCounts[reason] || 0) + 1
      }

      items.push({
        sourceId: result.sourceId,
        sourceName: result.sourceName,
        ok: result.ok,
        method: result.method,
        reason,
        candidateCount: result.candidateCount,
        version: result.version,
      })
    }

    setRecovering(false)
    setSelectedIds([])
    setRepairRun({
      attempted: sourcesToAudit.length,
      readable,
      failed,
      version: repairVersion || undefined,
      mode: 'audit',
      methodCounts,
      reasonCounts,
      items,
    })
    setMessage(
      `Sağlam mənbələrin canlı yoxlaması bitdi: ${readable} hazırda oxunur, ${failed} hazırda oxunmadı. DB statusu dəyişdirilmədi.`
    )
  }

  async function autoRecoverProblemSources() {
    if (selectedIds.length === 0) {
      alert('Bərpa ediləcək mənbələri seçin.')
      return
    }

    const selectedSourceSet = new Set(selectedIds)
    const selectedSources = sources.filter((source) =>
      selectedSourceSet.has(source.id)
    )
    const sourcesToRepair = selectedSources.filter((source) =>
      isRepairTargetSource(source, sourceQuality[source.id])
    )

    if (selectedSources.length === 0) {
      alert(
        'Seçilmiş mənbə siyahıda tapılmadı. Səhifəni yeniləyib yenidən seçin.'
      )
      return
    }

    if (sourcesToRepair.length === 0) {
      alert('Seçilmiş mənbələr arasında bərpa testinə uyğun mənbə tapılmadı.')
      return
    }

    const skippedCount = selectedSources.length - sourcesToRepair.length
    const ok = window.confirm(
      `${sourcesToRepair.length} seçilmiş mənbə real oxuma testi ilə yenidən yoxlanacaq${
        skippedCount > 0
          ? `; ${skippedCount} artıq sağlam göründüyü üçün ötürüləcək`
          : ''
      }. Davam edək?`
    )

    if (!ok) return

    setRecovering(true)
    setMessage(
      `${sourcesToRepair.length} seçilmiş mənbə üçün oxuma üsulu yenidən yoxlanır...`
    )
    setRepairRun(null)

    let readable = 0
    let failed = 0
    const methodCounts: Record<string, number> = {}
    const reasonCounts: Record<string, number> = {}
    const items: RepairRunItem[] = []

    let repairVersion = ''
    for (const source of sourcesToRepair) {
      const result = await runAutoRepair(source)
      if (result.ok) readable += 1
      else failed += 1
      if (result.version && !repairVersion) repairVersion = result.version

      const method = result.method || 'unknown'
      const reason = formatRepairReason(
        result.reason || result.message || 'Naməlum səbəb'
      )

      if (result.ok) {
        methodCounts[method] = (methodCounts[method] || 0) + 1
      } else {
        reasonCounts[reason] = (reasonCounts[reason] || 0) + 1
      }

      items.push({
        sourceId: result.sourceId,
        sourceName: result.sourceName,
        ok: result.ok,
        method: result.method,
        reason,
        candidateCount: result.candidateCount,
        version: result.version,
      })
    }

    setRecovering(false)
    setSelectedIds([])
    await loadSources()
    setRepairRun({
      attempted: sourcesToRepair.length,
      readable,
      failed,
      version: repairVersion || undefined,
      methodCounts,
      reasonCounts,
      items,
    })
    setMessage(
      `Seçilmiş mənbələrin bərpa yoxlaması bitdi: ${readable} mənbə oxuna bilir, ${failed} mənbə hələ oxunmadı. Sağlam statusu bot real nəticə verdikdən sonra təsdiqlənəcək.`
    )
  }

  async function toggleStatus(source: Source) {
    if (source.status !== 'active') {
      const ok = window.confirm(
        `${getSourceTitle(source)} aktivləşdirilməzdən əvvəl real oxuma testi ilə yoxlanacaq. Davam edək?`
      )

      if (!ok) return

      setRecovering(true)
      setMessage(`${getSourceTitle(source)} real oxuma testi ilə yoxlanır...`)
      setRepairRun(null)

      const result = await runAutoRepair(source)
      setRecovering(false)
      await loadSources()

      setRepairRun({
        attempted: 1,
        readable: result.ok ? 1 : 0,
        failed: result.ok ? 0 : 1,
        methodCounts: result.ok && result.method ? { [result.method]: 1 } : {},
        reasonCounts: result.ok
          ? {}
          : {
              [formatRepairReason(
                result.reason || result.message || 'Naməlum səbəb'
              )]: 1,
            },
        items: [
          {
            sourceId: result.sourceId,
            sourceName: result.sourceName,
            ok: result.ok,
            method: result.method,
            reason: formatRepairReason(
              result.reason || result.message || 'Naməlum səbəb'
            ),
            candidateCount: result.candidateCount,
          },
        ],
      })
      setMessage(
        result.ok
          ? `${getSourceTitle(source)} oxuna bilir və yoxlanılan mənbələrə keçdi. Sağlam statusu bot real nəticə/Telegram sübutu verdikdən sonra təsdiqlənəcək.`
          : `${getSourceTitle(source)} aktiv edilmədi: ${formatRepairReason(result.reason || result.message || 'Naməlum səbəb')}`
      )
      return
    }

    const { error } = await supabase
      .from('sources')
      .update({ status: 'inactive' })
      .eq('id', source.id)

    if (error) {
      alert('Status dəyişmədi: ' + error.message)
      return
    }

    await loadSources()
  }

  async function saveEdit() {
    if (!editing) return

    const { error } = await supabase
      .from('sources')
      .update({
        name: editing.name?.trim() || getSourceTitle(editing),
        base_url: editing.base_url,
        latest_url: editing.latest_url || null,
        rss_url: editing.rss_url || null,
        monitor_method: editing.monitor_method || 'latest_page',
        selector: editing.selector || null,
        article_pattern: editing.article_pattern || null,
      })
      .eq('id', editing.id)

    if (error) {
      alert('Yadda saxlanmadı: ' + error.message)
      return
    }

    setEditing(null)
    await loadSources()
  }

  function toggleSelect(id: string) {
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id]
    )
  }

  function applySelectorTemplate(
    template: (typeof SELECTOR_TEMPLATES)[number]
  ) {
    if (!editing) return

    setEditing({
      ...editing,
      monitor_method: template.method,
      selector: template.selector || editing.selector,
      article_pattern: template.articlePattern,
      discovery_status: 'needs_review',
    })
  }

  const filteredSources = useMemo(() => {
    const q = search.toLowerCase().trim()

    return sources.filter((source) => {
      const matchesSearch =
        !q ||
        (source.name || '').toLowerCase().includes(q) ||
        (source.base_url || '').toLowerCase().includes(q) ||
        (source.latest_url || '').toLowerCase().includes(q) ||
        (source.rss_url || '').toLowerCase().includes(q) ||
        (source.selector || '').toLowerCase().includes(q) ||
        (source.article_pattern || '').toLowerCase().includes(q) ||
        (source.status || '').toLowerCase().includes(q) ||
        (source.monitor_method || '').toLowerCase().includes(q) ||
        (source.discovery_status || '').toLowerCase().includes(q) ||
        (source.notes || '').toLowerCase().includes(q)

      const matchesMethod = matchesMonitorMethodFilter(
        source.monitor_method,
        methodFilter
      )

      const qualityMetrics = sourceQuality[source.id]
      const matchesSourceView =
        sourceView === 'all' ||
        (sourceView === 'candidate' && isDiscoveryCandidateSource(source)) ||
        (sourceView === 'healthy' && isHealthySource(source, qualityMetrics)) ||
        (sourceView === 'problem' &&
          getSourceHealthState(source, qualityMetrics) === 'problem') ||
        (sourceView === 'checking' &&
          getSourceHealthState(source, qualityMetrics) === 'checking')
      const matchesProblemFilter =
        sourceView !== 'problem' ||
        problemFilter === 'all' ||
        getSourceProblemFilter(source) === problemFilter
      const matchesCheckingFilter =
        sourceView !== 'checking' ||
        checkingFilter === 'all' ||
        getSourceCheckingFilter(source) === checkingFilter

      return (
        matchesSourceView &&
        matchesProblemFilter &&
        matchesCheckingFilter &&
        matchesSearch &&
        matchesMethod
      )
    })
  }, [
    sources,
    sourceQuality,
    search,
    methodFilter,
    sourceView,
    problemFilter,
    checkingFilter,
  ])

  const totalPages = Math.max(1, Math.ceil(filteredSources.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const paginatedSources = filteredSources.slice(
    (safePage - 1) * pageSize,
    safePage * pageSize
  )

  function resetFilteredView() {
    setSelectedIds([])
    setPage(1)
  }

  function toggleSelectAll() {
    const filteredIds = filteredSources.map((item) => item.id)
    const allSelected =
      filteredIds.length > 0 &&
      filteredIds.every((id) => selectedIds.includes(id))

    if (allSelected) {
      setSelectedIds((current) =>
        current.filter((id) => !filteredIds.includes(id))
      )
    } else {
      setSelectedIds(filteredIds)
    }
  }

  const stats = useMemo(() => {
    let candidates = 0
    let healthy = 0
    let checking = 0
    let failed = 0
    const problemCounts: Record<SourceProblemFilter, number> = {
      all: 0,
      blocked: 0,
      not_found: 0,
      js_shell: 0,
      article_links: 0,
      timeout: 0,
      other: 0,
    }
    const checkingCounts: Record<SourceCheckingFilter, number> = {
      all: 0,
      readable_pending: 0,
      candidate_found: 0,
      old_news: 0,
      no_match: 0,
      old_or_no_match: 0,
      date_issue: 0,
      bot_pending: 0,
    }

    for (const source of sources) {
      const metrics = sourceQuality[source.id]
      const state = getSourceHealthState(source, metrics)

      if (isDiscoveryCandidateSource(source)) candidates += 1
      else if (state === 'healthy') healthy += 1
      else if (state === 'checking') {
        checking += 1
        checkingCounts.all += 1
        checkingCounts[getSourceCheckingFilter(source)] += 1
      } else {
        failed += 1
        problemCounts.all += 1
        problemCounts[getSourceProblemFilter(source)] += 1
      }
    }

    return {
      total: sources.length,
      active: sources.filter((item) => item.status === 'active').length,
      candidates,
      healthy,
      checking,
      failed,
      problems: failed,
      problemCounts,
      checkingCounts,
    }
  }, [sources, sourceQuality])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadSources()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [])

  if (loading) {
    return (
      <div className='flex min-h-[320px] items-center justify-center p-6 text-sm text-muted-foreground'>
        Mənbələr yüklənir...
      </div>
    )
  }

  const detailHealth = detailSource
    ? getSourceHealth(detailSource, sources)
    : null
  const detailQuality =
    detailSource && detailHealth
      ? getSourceQualityLabel(
          detailSource,
          sourceQuality[detailSource.id],
          detailHealth
        )
      : null
  const detailQualityMetrics = detailSource
    ? sourceQuality[detailSource.id] || emptyQualityMetrics()
    : emptyQualityMetrics()
  const detailBotConfirmation = detailSource
    ? getBotConfirmationLabel(detailSource, detailQualityMetrics)
    : null
  const detailItemById = new Map(detailItems.map((item) => [item.id, item]))

  function applySourcePreset({
    view = 'all',
    method = 'all',
  }: {
    view?: SourceView
    method?: string
  }) {
    setSourceView(view)
    setMethodFilter(method)
    if (view !== 'problem') setProblemFilter('all')
    if (view !== 'checking') setCheckingFilter('all')
    setSearch('')
    resetFilteredView()
  }

  const sourceViewTabs = [
    { key: 'all', label: 'Bütün mənbələr', count: stats.total },
    { key: 'candidate', label: 'Yeni mənbələr', count: stats.candidates },
    { key: 'healthy', label: 'Sağlam mənbələr', count: stats.healthy },
    { key: 'checking', label: 'Yoxlanılır', count: stats.checking },
    { key: 'problem', label: 'İşləməyən mənbələr', count: stats.problems },
  ] as const

  return (
    <div className='grid max-w-full min-w-0 gap-4 p-4 md:p-6'>
      <div>
        <h1 className='text-xl font-semibold tracking-tight'>Mənbələr</h1>
        <p className='text-muted-foreground'>
          Aşkarlama botunun tapdığı və monitor tərəfindən izlənən saytlar
        </p>
      </div>

      {message ? (
        <div className='rounded-lg border bg-card p-4 text-sm text-warning'>
          {message}
        </div>
      ) : null}

      <section className='grid gap-3 rounded-lg border bg-card p-4'>
        <div className='flex flex-wrap items-start justify-between gap-3'>
          <div>
            <h2 className='text-base font-semibold'>Yeni mənbə əlavə et</h2>
            <p className='text-sm text-muted-foreground'>
              Domen və ya URL daxil edin. Sistem RSS, sitemap və səhifə
              linklərini yoxlayıb ən uyğun izləmə metodunu seçəcək.
            </p>
          </div>
          <div className='flex flex-wrap gap-2'>
            <button
              type='button'
              onClick={() => setBulkAddMode(false)}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${
                !bulkAddMode
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'bg-background text-muted-foreground'
              }`}
            >
              Tək əlavə
            </button>
            <button
              type='button'
              onClick={() => setBulkAddMode(true)}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${
                bulkAddMode
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'bg-background text-muted-foreground'
              }`}
            >
              Toplu əlavə
            </button>
            <span className='rounded-full border border-success/25 bg-success/10 px-2 py-1 text-xs text-success'>
              Avtomatik analiz
            </span>
          </div>
        </div>

        {bulkAddMode ? (
          <div className='grid gap-2'>
            <textarea
              value={bulkSourceInput}
              onChange={(event) => setBulkSourceInput(event.target.value)}
              placeholder={
                'Hər sətirdə bir mənbə:\napa.az\nreport.az\nhttps://azertag.az'
              }
              rows={5}
              className='min-h-28 w-full resize-y rounded-lg border bg-background px-3 py-2 text-sm'
            />
            <div className='flex flex-wrap items-center justify-between gap-2'>
              <p className='text-xs text-muted-foreground'>
                Təkrar domenlər atlanır. Hər mənbə eyni avtomatik analizdən
                keçir.
              </p>
              <button
                type='button'
                onClick={() => void addBulkSources()}
                disabled={addingSource}
                className='rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60'
              >
                {addingSource ? 'Yoxlanılır...' : 'Toplu yoxla və əlavə et'}
              </button>
            </div>
          </div>
        ) : (
          <div className='grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto]'>
            <input
              aria-label='Məsələn: apa.az və ya https://apa.az'
              value={newSourceInput}
              onChange={(event) => setNewSourceInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !addingSource) {
                  event.preventDefault()
                  void addSourceByDomain()
                }
              }}
              placeholder='Məsələn: apa.az və ya https://apa.az'
              className='min-w-0 rounded-lg border bg-background px-3 py-2'
            />
            <button
              type='button'
              onClick={() => void addSourceByDomain()}
              disabled={addingSource}
              className='rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60'
            >
              {addingSource ? 'Yoxlanılır...' : 'Mənbəni yoxla və əlavə et'}
            </button>
          </div>
        )}
        {addSourceResult ? (
          <div
            className={`rounded-lg border p-3 text-sm ${
              addSourceResult.ok
                ? 'border-success/25 bg-success/10 text-success'
                : 'border-warning/25 bg-warning/10 text-warning'
            }`}
          >
            <div className='font-medium'>
              {addSourceResult.sourceName} ·{' '}
              {addSourceResult.ok ? 'Yoxlanılır' : 'Yoxlama tələb edir'}
            </div>
            <div className='mt-1'>
              Metod: {addSourceResult.method} · Link sayı:{' '}
              {addSourceResult.candidateCount}
            </div>
            {addSourceResult.sampleLinks.length > 0 ? (
              <div className='mt-2 grid gap-1 text-xs'>
                {addSourceResult.sampleLinks.slice(0, 3).map((link) => (
                  <a
                    key={link}
                    href={link}
                    target='_blank'
                    rel='noreferrer'
                    className='line-clamp-1 underline'
                  >
                    {link}
                  </a>
                ))}
              </div>
            ) : (
              <div className='mt-1 text-xs'>{addSourceResult.reason}</div>
            )}
          </div>
        ) : null}
      </section>

      <div className='flex flex-wrap gap-2 rounded-lg border bg-card p-3'>
        {sourceViewTabs.map((tab) => (
          <button
            key={tab.key}
            type='button'
            onClick={() => {
              applySourcePreset({ view: tab.key })
            }}
            className={`rounded-lg border px-4 py-2 text-sm font-medium transition ${
              sourceView === tab.key && methodFilter === 'all'
                ? tab.key === 'healthy'
                  ? 'border-success/25 bg-success/10 text-success'
                  : tab.key === 'candidate'
                    ? 'border-border bg-muted text-foreground'
                    : tab.key === 'problem'
                      ? 'border-destructive/25 bg-destructive/10 text-destructive'
                      : tab.key === 'checking'
                        ? 'border-border bg-muted text-foreground'
                        : 'border-border bg-muted text-foreground'
                : 'bg-background hover:bg-muted'
            }`}
          >
            {tab.label} <span className='ml-2 font-bold'>{tab.count}</span>
          </button>
        ))}

        {sourceView === 'problem' ? (
          <div className='flex w-full flex-wrap items-center gap-2 border-t pt-3'>
            <span className='text-xs text-muted-foreground'>
              Problem səbəbi:
            </span>
            {SOURCE_PROBLEM_FILTERS.map((filter) => (
              <button
                key={filter.key}
                type='button'
                onClick={() => {
                  setProblemFilter(filter.key)
                  resetFilteredView()
                }}
                className={
                  problemFilter === filter.key
                    ? 'rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive'
                    : 'rounded-lg border bg-background px-3 py-2 text-xs font-medium hover:bg-muted'
                }
              >
                {filter.label}{' '}
                <span className='ml-1 font-bold'>
                  {stats.problemCounts[filter.key]}
                </span>
              </button>
            ))}
          </div>
        ) : null}

        {sourceView === 'checking' ? (
          <div className='flex w-full flex-wrap items-center gap-2 border-t pt-3'>
            <span className='text-xs text-muted-foreground'>
              Yoxlanılır səbəbi:
            </span>
            {SOURCE_CHECKING_FILTERS.map((filter) => (
              <button
                key={filter.key}
                type='button'
                onClick={() => {
                  setCheckingFilter(filter.key)
                  resetFilteredView()
                }}
                className={
                  checkingFilter === filter.key
                    ? 'rounded-lg border border-border bg-muted px-3 py-2 text-xs font-medium text-foreground'
                    : 'rounded-lg border bg-background px-3 py-2 text-xs font-medium hover:bg-muted'
                }
              >
                {filter.label}{' '}
                <span className='ml-1 font-bold'>
                  {stats.checkingCounts[filter.key]}
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className='grid gap-3 rounded-lg border bg-card p-4 xl:grid-cols-[minmax(0,1fr)_240px]'>
        <input
          aria-label='Mənbə adı, domen və ya metod üzrə axtar...'
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            resetFilteredView()
          }}
          placeholder='Mənbə adı, domen və ya metod üzrə axtar...'
          className='min-w-0 rounded-lg border bg-background px-3 py-2'
        />

        <select
          aria-label='Monitorinq metodu'
          value={methodFilter}
          onChange={(e) => {
            setMethodFilter(e.target.value)
            resetFilteredView()
          }}
          className='min-w-0 rounded-lg border bg-background px-3 py-2'
        >
          <option value='all'>Bütün metodlar</option>
          {METHOD_FILTER_OPTIONS.map((method) => (
            <option key={method.value} value={method.value}>
              {method.label}
            </option>
          ))}
        </select>
      </div>

      <div className='grid gap-3 rounded-lg border bg-card p-4 xl:grid-cols-[auto_1fr] xl:items-start'>
        <div className='text-sm text-muted-foreground'>
          Ümumi: <b>{sources.length}</b> | Göstərilən:{' '}
          <b>{filteredSources.length}</b> | Seçilən: <b>{selectedIds.length}</b>
        </div>

        <div className='flex min-w-0 flex-wrap gap-2 xl:justify-end'>
          <button
            onClick={() => bulkSetStatus('active')}
            disabled={selectedIds.length === 0}
            className='rounded-md border px-3 py-2 text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50'
          >
            Seçilənləri aktiv et
          </button>

          <button
            onClick={() => bulkSetStatus('inactive')}
            disabled={selectedIds.length === 0}
            className='rounded-md border px-3 py-2 text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50'
          >
            Seçilənləri passiv et
          </button>

          <div className='flex flex-col gap-1'>
            <button
              onClick={autoRecoverProblemSources}
              disabled={recovering || selectedIds.length === 0}
              className='rounded-md border border-success/25 bg-success/10 px-3 py-2 text-sm text-success hover:bg-success/10 disabled:cursor-not-allowed disabled:opacity-50'
            >
              Seçilmişləri bərpa et
            </button>
            <span className='max-w-md text-xs text-muted-foreground'>
              Real problemli və yoxlanılır mənbələr bərpa testinə gedir. Oxuna
              bilən mənbə “Yoxlanılır” qalır; “Sağlam” statusu bot real
              nəticə/bildiriş verdikdən sonra təsdiqlənir.
            </span>
          </div>

          {sourceView === 'healthy' ? (
            <div className='flex flex-col gap-1'>
              <button
                onClick={auditSelectedHealthySources}
                disabled={recovering || selectedIds.length === 0}
                className='rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50'
              >
                Seçilmiş sağlamları canlı yoxla
              </button>
              <span className='max-w-md text-xs text-muted-foreground'>
                Bu audit yalnız hazırda oxunub-oxunmadığını yoxlayır. DB statusu
                dəyişmir və Telegram göndərilmir.
              </span>
            </div>
          ) : null}

          <details className='relative'>
            <summary className='cursor-pointer list-none rounded-md border px-3 py-2 text-sm hover:bg-muted'>
              Toplu əməliyyatlar
            </summary>

            <div className='absolute right-0 z-30 mt-2 grid w-72 gap-2 rounded-lg border bg-background p-3 shadow-lg'>
              <select
                aria-label='Toplu monitorinq üsulu'
                value={bulkMethod}
                onChange={(e) => setBulkMethod(e.target.value)}
                className='min-w-0 rounded-md border bg-background px-3 py-2 text-sm'
              >
                {EDITABLE_MONITOR_METHODS.map((method) => (
                  <option key={method} value={method}>
                    {formatMonitorMethod(method)}
                  </option>
                ))}
              </select>

              <button
                onClick={bulkSetMethod}
                disabled={selectedIds.length === 0}
                className='rounded-md border px-3 py-2 text-left text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50'
              >
                Metodu tətbiq et
              </button>

              <button
                onClick={deactivateSubdomains}
                className='rounded-md border px-3 py-2 text-left text-sm text-warning hover:bg-warning/10'
              >
                Subdomainləri passiv et
              </button>

              <button
                onClick={deactivateFailingSources}
                className='rounded-md border px-3 py-2 text-left text-sm text-destructive hover:bg-destructive/10'
              >
                Fail limitini passiv et
              </button>

              <button
                onClick={deactivateNonNewsSources}
                className='rounded-md border px-3 py-2 text-left text-sm text-warning hover:bg-warning/10'
              >
                Qeyri-xəbərləri passiv et
              </button>

              <button
                onClick={deleteSelectedSources}
                disabled={selectedIds.length === 0}
                className='rounded-md border px-3 py-2 text-left text-sm text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50'
              >
                Seçilənləri sil
              </button>
            </div>
          </details>
        </div>
      </div>

      {repairRun ? (
        <div className='grid gap-4 rounded-lg border border-success/25 bg-success/15 p-4'>
          <div className='flex flex-wrap items-start justify-between gap-3'>
            <div>
              <h2 className='text-base font-semibold'>Son bərpa yoxlaması</h2>
              <p className='text-sm text-muted-foreground'>
                Bu nəticə mənbənin oxuna bilib-bilmədiyini göstərir. Sağlam
                statusu bot real nəticə verdikdən sonra təsdiqlənir.
              </p>
            </div>
            <button
              type='button'
              onClick={() => setRepairRun(null)}
              className='rounded-md border bg-background px-3 py-2 text-xs hover:bg-muted'
            >
              Bağla
            </button>
          </div>

          <div className='grid gap-3 sm:grid-cols-3'>
            <div className='rounded-lg border bg-background p-3'>
              <div className='text-xs text-muted-foreground'>Yoxlandı</div>
              <div className='text-2xl font-bold'>{repairRun.attempted}</div>
            </div>
            <div className='rounded-lg border border-success/25 bg-success/10 p-3'>
              <div className='text-xs text-success'>Oxuna bilir</div>
              <div className='text-2xl font-bold text-success'>
                {repairRun.readable}
              </div>
            </div>
            <div className='rounded-lg border border-warning/25 bg-warning/10 p-3'>
              <div className='text-xs text-warning'>
                Bot yoxlaması lazımdır / oxunmadı
              </div>
              <div className='text-2xl font-bold text-warning'>
                {repairRun.failed}
              </div>
            </div>
          </div>

          <div className='grid gap-3 lg:grid-cols-2'>
            <div className='rounded-lg border bg-background p-3'>
              <div className='mb-2 text-sm font-medium'>
                Oxuna bilən metodlar
              </div>
              {Object.entries(repairRun.methodCounts).length > 0 ? (
                <div className='flex flex-wrap gap-2'>
                  {Object.entries(repairRun.methodCounts).map(
                    ([method, count]) => (
                      <span
                        key={formatMonitorMethod(method)}
                        className='rounded-full border border-success/25 bg-success/10 px-2 py-1 text-xs text-success'
                      >
                        {formatMonitorMethod(method)}: {count}
                      </span>
                    )
                  )}
                </div>
              ) : (
                <div className='text-sm text-muted-foreground'>
                  Oxuna bilən metod tapılmadı.
                </div>
              )}
            </div>

            <div className='rounded-lg border bg-background p-3'>
              <div className='mb-2 text-sm font-medium'>Əsas səbəblər</div>
              {Object.entries(repairRun.reasonCounts).length > 0 ? (
                <div className='grid gap-1'>
                  {Object.entries(repairRun.reasonCounts)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 5)
                    .map(([reason, count]) => (
                      <div
                        key={reason}
                        className='flex gap-2 text-xs text-muted-foreground'
                      >
                        <span className='font-medium text-foreground'>
                          {count}
                        </span>
                        <span className='line-clamp-1'>{reason}</span>
                      </div>
                    ))}
                </div>
              ) : (
                <div className='text-sm text-muted-foreground'>
                  Uğursuz səbəb yoxdur.
                </div>
              )}
            </div>
          </div>
          <div className='rounded-lg border bg-background p-3 text-xs text-muted-foreground'>
            Bərpa mühərriki:{' '}
            <span className='font-medium text-foreground'>
              {repairRun.version ||
                repairRun.items.find((item) => item.version)?.version ||
                'versiya gəlmədi - Edge Function cavabı köhnə ola bilər'}
            </span>
          </div>

          <details className='rounded-lg border bg-background p-3'>
            <summary className='cursor-pointer text-sm font-medium'>
              Mənbələr üzrə nəticələr
            </summary>
            <div className='mt-3 grid max-h-80 gap-2 overflow-auto pr-1'>
              {repairRun.items.map((item) => (
                <div
                  key={item.sourceId}
                  className='grid gap-2 rounded-lg border p-3 text-sm md:grid-cols-[minmax(180px,1fr)_auto_minmax(220px,1.2fr)] md:items-center'
                >
                  <div className='min-w-0'>
                    <div className='line-clamp-1 font-medium'>
                      {item.sourceName}
                    </div>
                    <div className='text-xs text-muted-foreground'>
                      {item.candidateCount ?? 0} link
                    </div>
                  </div>
                  <span
                    className={`w-fit rounded-full border px-2 py-1 text-xs ${getRepairItemBadgeClass(item)}`}
                  >
                    {getRepairItemLabel(item)}
                    {item.ok && item.method ? ` · ${item.method}` : ''}
                  </span>
                  <div className='rounded-md bg-muted/50 p-2 font-mono text-[11px] leading-relaxed break-words whitespace-pre-wrap text-muted-foreground'>
                    {getRepairItemReason(item)}
                  </div>
                </div>
              ))}
            </div>
          </details>
        </div>
      ) : null}

      <ResponsiveTable label='Monitorinq məlumatları'>
        <table className='w-full min-w-[1100px] table-fixed text-sm'>
          <thead className='bg-muted/50'>
            <tr>
              <th className='w-10 p-3 text-left'>
                <input
                  type='checkbox'
                  checked={
                    filteredSources.length > 0 &&
                    filteredSources.every((source) =>
                      selectedIds.includes(source.id)
                    )
                  }
                  onChange={toggleSelectAll}
                />
              </th>
              <th className='w-12 p-3 text-left'>No</th>
              <th className='w-[34%] p-3 text-left'>Mənbə</th>
              <th className='w-[30%] p-3 text-left'>Vəziyyət</th>
              <th className='w-36 p-3 text-left'>Metod</th>
              <th className='w-32 p-3 text-left'>Son yoxlama</th>
              <th className='w-28 p-3 text-right'>İş</th>
            </tr>
          </thead>

          <tbody>
            {paginatedSources.map((source, index) => {
              const rawIssues = getSimpleProblemReasons(source, sources)
              const isFailing = (source.consecutive_fail_count || 0) >= 5
              const isNonNews = hasNonNewsSignal(source)
              const qualityMetrics =
                sourceQuality[source.id] || emptyQualityMetrics()
              const healthState = getSourceHealthState(source, qualityMetrics)
              const health =
                healthState === 'healthy'
                  ? 'ok'
                  : healthState === 'checking'
                    ? 'warning'
                    : 'error'
              const quality = getSourceQualityLabel(
                source,
                qualityMetrics,
                health
              )
              const botConfirmation = getBotConfirmationLabel(
                source,
                qualityMetrics
              )
              const isHealthConfirmed = healthState === 'healthy'
              const displayMethod =
                isHealthConfirmed && hasStaleReadMethod(source)
                  ? 'Metod yenilənməlidir'
                  : formatMonitorMethod(source.monitor_method || 'auto')
              const displayBotResult = isHealthConfirmed
                ? botConfirmation.label
                : formatResult(source.last_result)
              const displayBotResultClass = isHealthConfirmed
                ? 'border-success/25 bg-success/10 text-success'
                : source.last_result === 'site_error'
                  ? 'border-destructive/25 text-destructive'
                  : source.last_result === 'sent'
                    ? 'border-success/25 text-success'
                    : 'text-muted-foreground'
              const issues = isHealthConfirmed ? [] : rawIssues
              const displayFailCount = isHealthConfirmed
                ? 0
                : source.consecutive_fail_count || 0
              const primaryProblem =
                !isHealthConfirmed && source.last_error
                  ? formatShortSourceProblem(source)
                  : ''
              const visibleIssues = issues.filter(
                (issue) =>
                  issue !== primaryProblem &&
                  issue !== displayBotResult &&
                  issue !== botConfirmation.label &&
                  issue !== quality.label &&
                  issue !== source.last_result
              )
              const showBotResult =
                displayBotResult &&
                displayBotResult !== botConfirmation.label &&
                displayBotResult !== quality.label

              return (
                <tr
                  key={source.id}
                  className={`border-t hover:bg-muted/30 ${
                    health === 'ok'
                      ? 'bg-success/15'
                      : health === 'warning'
                        ? 'bg-warning/15'
                        : isFailing
                          ? 'bg-destructive/15'
                          : isNonNews
                            ? 'bg-destructive/15'
                            : 'bg-destructive/15'
                  }`}
                >
                  <td className='p-3'>
                    <input
                      type='checkbox'
                      checked={selectedIds.includes(source.id)}
                      onChange={() => toggleSelect(source.id)}
                    />
                  </td>

                  <td className='p-3 text-muted-foreground'>
                    {(safePage - 1) * pageSize + index + 1}
                  </td>

                  <td className='p-3 align-top'>
                    <div className='line-clamp-1 font-medium'>
                      {getSourceTitle(source)}
                    </div>
                    <div className='line-clamp-1 text-xs text-muted-foreground'>
                      {source.base_url || source.latest_url || '-'}
                    </div>
                    {qualityMetrics.lastUsefulItem ? (
                      <div className='truncate text-[11px] text-muted-foreground'>
                        son: {formatDate(qualityMetrics.lastUsefulItem)}
                      </div>
                    ) : null}
                    {isSubdomain(source, sources) ? (
                      <div className='mt-1 text-xs text-warning'>
                        subdomain: {findParentDomain(source, sources)}
                      </div>
                    ) : null}
                  </td>

                  <td className='p-3 align-top'>
                    <div className='grid gap-2'>
                      <div className='flex min-w-0 flex-wrap items-center gap-1 text-[11px]'>
                        <span
                          className={`inline-flex rounded-full border px-1.5 py-0.5 font-medium ${getQualityToneClass(
                            quality.tone
                          )}`}
                        >
                          {quality.label}
                        </span>
                        <span
                          className={`inline-flex rounded-full border px-1.5 py-0.5 font-medium ${getBotConfirmationToneClass(
                            botConfirmation.tone
                          )}`}
                        >
                          {botConfirmation.label}
                        </span>
                        {displayFailCount > 0 ? (
                          <span className='inline-flex rounded-full border border-destructive/25 px-1.5 py-0.5 text-destructive'>
                            fail: {displayFailCount}
                          </span>
                        ) : null}
                      </div>

                      <div className='flex min-w-0 flex-wrap items-center gap-1'>
                        {showBotResult ? (
                          <span
                            className={`w-fit rounded-full border px-2 py-1 text-xs ${displayBotResultClass}`}
                          >
                            {displayBotResult}
                          </span>
                        ) : null}
                        {visibleIssues.map((issue) => (
                          <span
                            key={issue}
                            className='rounded-full border border-warning/25 px-1.5 py-0.5 text-[11px] text-warning'
                          >
                            {issue}
                          </span>
                        ))}
                      </div>

                      {primaryProblem &&
                      primaryProblem !== displayBotResult &&
                      primaryProblem !== botConfirmation.label ? (
                        <span className='line-clamp-2 text-xs text-destructive'>
                          {primaryProblem}
                        </span>
                      ) : null}
                    </div>
                  </td>

                  <td className='p-3 align-top'>
                    <span className='rounded-full border px-2 py-1 text-xs'>
                      {displayMethod}
                    </span>
                  </td>

                  <td className='p-3 align-top'>
                    {formatDate(source.last_checked_at)}
                  </td>

                  <td className='p-3 text-right'>
                    <div className='relative inline-block text-left'>
                      <button
                        type='button'
                        onClick={() =>
                          setOpenActionId((current) =>
                            current === source.id ? null : source.id
                          )
                        }
                        className='rounded-md border px-3 py-1 text-xs hover:bg-muted'
                      >
                        Əməliyyat
                      </button>

                      {openActionId === source.id ? (
                        <div className='absolute right-0 z-20 mt-2 grid min-w-40 gap-1 rounded-lg border bg-background p-2 text-left shadow-lg'>
                          <button
                            type='button'
                            onClick={() => {
                              setOpenActionId(null)
                              void loadSourceDetails(source)
                            }}
                            className='rounded-md px-3 py-2 text-left text-xs hover:bg-muted'
                          >
                            Detallar
                          </button>

                          <a
                            href={source.latest_url || source.base_url || '#'}
                            target='_blank'
                            rel='noreferrer'
                            onClick={() => setOpenActionId(null)}
                            className='rounded-md px-3 py-2 text-xs hover:bg-muted'
                          >
                            Aç
                          </a>

                          <button
                            type='button'
                            onClick={() => {
                              setEditing(source)
                              setOpenActionId(null)
                            }}
                            className='rounded-md px-3 py-2 text-left text-xs hover:bg-muted'
                          >
                            Redaktə et
                          </button>

                          <a
                            href={getSelectorPickerUrl(source.id)}
                            onClick={() => setOpenActionId(null)}
                            className='rounded-md px-3 py-2 text-xs hover:bg-muted'
                          >
                            Selector seç
                          </a>

                          <button
                            type='button'
                            onClick={() => {
                              setOpenActionId(null)
                              void toggleStatus(source)
                            }}
                            className={`rounded-md px-3 py-2 text-left text-xs ${
                              source.status === 'active'
                                ? 'text-destructive hover:bg-destructive/10'
                                : 'text-success hover:bg-success/10'
                            }`}
                          >
                            {source.status === 'active'
                              ? 'Passiv et'
                              : 'Aktiv et'}
                          </button>

                          <button
                            type='button'
                            onClick={() => {
                              setOpenActionId(null)
                              void deleteSource(source)
                            }}
                            className='rounded-md px-3 py-2 text-left text-xs text-destructive hover:bg-destructive/10'
                          >
                            Sil
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </td>
                </tr>
              )
            })}

            {filteredSources.length === 0 && (
              <tr>
                <td
                  colSpan={14}
                  className='p-10 text-center text-muted-foreground'
                >
                  Mənbə tapılmadı.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </ResponsiveTable>

      <div className='flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4'>
        <div className='text-sm text-muted-foreground'>
          Səhifə <b>{safePage}</b> / <b>{totalPages}</b> · Hər səhifədə{' '}
          <b>{pageSize}</b> mənbə
        </div>

        <div className='flex gap-2'>
          <button
            type='button'
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={safePage <= 1}
            className='rounded-md border px-4 py-2 text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50'
          >
            Əvvəlki
          </button>
          <button
            type='button'
            onClick={() =>
              setPage((current) => Math.min(totalPages, current + 1))
            }
            disabled={safePage >= totalPages}
            className='rounded-md border px-4 py-2 text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50'
          >
            Növbəti
          </button>
        </div>
      </div>

      {detailSource && detailQuality && detailHealth ? (
        <div className='fixed inset-0 z-50 flex justify-end bg-black/40'>
          <button
            type='button'
            aria-label='Detalları bağla'
            className='absolute inset-0 cursor-default'
            onClick={() => setDetailSource(null)}
          />

          <aside className='relative z-10 h-full w-full max-w-3xl overflow-y-auto border-l bg-background shadow-xl'>
            <div className='sticky top-0 z-10 flex items-start justify-between gap-4 border-b bg-background/95 p-4 backdrop-blur'>
              <div className='min-w-0'>
                <h2 className='line-clamp-1 text-2xl font-bold'>
                  {getSourceTitle(detailSource)}
                </h2>
                <a
                  href={detailSource.base_url}
                  target='_blank'
                  rel='noreferrer'
                  className='block truncate text-sm text-muted-foreground hover:text-primary'
                >
                  {detailSource.base_url}
                </a>
              </div>

              <button
                type='button'
                onClick={() => setDetailSource(null)}
                className='rounded-md border px-3 py-2 text-sm hover:bg-muted'
              >
                Bağla
              </button>
            </div>

            <div className='grid gap-4 p-4'>
              {detailError ? (
                <div className='rounded-lg border border-warning/25 bg-warning/10 p-3 text-sm text-warning'>
                  {detailError}
                </div>
              ) : null}

              <section className='rounded-lg border bg-card p-4'>
                <h3 className='font-semibold'>Əsas məlumatlar</h3>
                <div className='mt-3 grid gap-3 text-sm md:grid-cols-2'>
                  <div>
                    <div className='text-xs text-muted-foreground'>Ad</div>
                    <div className='truncate font-medium'>
                      {emptyValue(detailSource.name)}
                    </div>
                  </div>
                  <div>
                    <div className='text-xs text-muted-foreground'>Status</div>
                    <div className='font-medium'>
                      {formatStatus(detailSource.status)}
                    </div>
                  </div>
                  <div>
                    <div className='text-xs text-muted-foreground'>
                      Latest URL
                    </div>
                    <div className='truncate font-medium'>
                      {emptyValue(detailSource.latest_url)}
                    </div>
                  </div>
                  <div>
                    <div className='text-xs text-muted-foreground'>Metod</div>
                    <div className='font-medium'>
                      {formatMonitorMethod(detailSource.monitor_method)}
                    </div>
                  </div>
                  <div>
                    <div className='text-xs text-muted-foreground'>
                      Mənbə tipi
                    </div>
                    <div className='font-medium'>
                      {formatSourceType(detailSource.source_type)}
                    </div>
                  </div>
                  <div>
                    <div className='text-xs text-muted-foreground'>
                      Etibar səviyyəsi
                    </div>
                    <div className='font-medium'>
                      {formatTrustLevel(detailSource.trust_level)}
                    </div>
                  </div>
                </div>
              </section>

              <section className='rounded-lg border bg-card p-4'>
                <h3 className='font-semibold'>Sağlamlıq</h3>
                <div className='mt-3 grid gap-3 text-sm md:grid-cols-3'>
                  <div>
                    <div className='text-xs text-muted-foreground'>
                      Son yoxlama
                    </div>
                    <div className='font-medium'>
                      {formatDate(detailSource.last_checked_at)}
                    </div>
                  </div>
                  <div>
                    <div className='text-xs text-muted-foreground'>
                      Son uğur
                    </div>
                    <div className='font-medium'>
                      {formatDate(detailSource.last_success_at)}
                    </div>
                  </div>
                  <div>
                    <div className='text-xs text-muted-foreground'>
                      Son xəbər
                    </div>
                    <div className='font-medium'>
                      {formatDate(detailSource.last_article_found_at)}
                    </div>
                  </div>
                  <div>
                    <div className='text-xs text-muted-foreground'>
                      Son vəziyyət
                    </div>
                    <div className='font-medium'>
                      {formatResult(detailSource.last_result)}
                    </div>
                  </div>
                  <div>
                    <div className='text-xs text-muted-foreground'>
                      Fail sayı
                    </div>
                    <div className='font-medium'>
                      {detailSource.consecutive_fail_count || 0}
                    </div>
                  </div>
                  <div>
                    <div className='text-xs text-muted-foreground'>
                      Sağlamlıq
                    </div>
                    <div className='font-medium'>
                      {getSourceHealthLabel(detailSource, sources)}
                    </div>
                  </div>
                  <div>
                    <div className='text-xs text-muted-foreground'>
                      Bot təsdiqi
                    </div>
                    <div>
                      {detailBotConfirmation ? (
                        <span
                          className={`inline-flex rounded-full border px-2 py-1 text-xs font-medium ${getBotConfirmationToneClass(
                            detailBotConfirmation.tone
                          )}`}
                        >
                          {detailBotConfirmation.label}
                        </span>
                      ) : (
                        <span className='font-medium'>—</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className='mt-3 text-sm'>
                  <div className='text-xs text-muted-foreground'>Son xəta</div>
                  <div className='line-clamp-3 font-medium'>
                    {formatLastError(detailSource)}
                  </div>
                </div>
              </section>

              <section className='rounded-lg border bg-card p-4'>
                <h3 className='font-semibold'>Keyfiyyət</h3>
                <div className='mt-3 flex flex-wrap items-center gap-2 text-sm'>
                  <span
                    className={`rounded-full border px-2 py-1 text-xs font-medium ${getQualityToneClass(
                      detailQuality.tone
                    )}`}
                  >
                    {detailQuality.label}
                  </span>
                  <span className='text-muted-foreground'>
                    {detailQuality.reason}
                  </span>
                </div>
                <div className='mt-3 grid gap-3 text-sm md:grid-cols-3'>
                  <div>
                    <div className='text-xs text-muted-foreground'>
                      Son 7 gündə xəbərlər
                    </div>
                    <div className='font-medium'>
                      {detailQualityMetrics.items7d}
                    </div>
                  </div>
                  <div>
                    <div className='text-xs text-muted-foreground'>
                      Son 7 gündə uyğunluqlar
                    </div>
                    <div className='font-medium'>
                      {detailQualityMetrics.matches7d}
                    </div>
                  </div>
                  <div>
                    <div className='text-xs text-muted-foreground'>
                      Son faydalı xəbər
                    </div>
                    <div className='font-medium'>
                      {formatDate(detailQualityMetrics.lastUsefulItem)}
                    </div>
                  </div>
                </div>
              </section>

              <section className='rounded-lg border bg-card p-4'>
                <h3 className='font-semibold'>Son xəbərlər</h3>
                <div className='mt-3 grid gap-2'>
                  {detailLoading ? (
                    <div className='text-sm text-muted-foreground'>
                      Məlumat yüklənir...
                    </div>
                  ) : detailItems.length === 0 ? (
                    <div className='text-sm text-muted-foreground'>
                      Son xəbər yoxdur.
                    </div>
                  ) : (
                    detailItems.map((item) => (
                      <a
                        key={item.id}
                        href={item.url || '#'}
                        target='_blank'
                        rel='noreferrer'
                        className='rounded-lg border p-3 text-sm hover:bg-muted'
                      >
                        <div className='line-clamp-2 font-medium'>
                          {item.title || 'Başlıq yoxdur'}
                        </div>
                        <div className='mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground'>
                          <span>
                            {formatDate(
                              item.published_at ||
                                item.detected_at ||
                                item.created_at
                            )}
                          </span>
                          <span className='max-w-full truncate'>
                            {emptyValue(item.url)}
                          </span>
                        </div>
                      </a>
                    ))
                  )}
                </div>
              </section>

              <section className='rounded-lg border bg-card p-4'>
                <h3 className='font-semibold'>Son uyğunluqlar</h3>
                <div className='mt-3 grid gap-2'>
                  {detailLoading ? (
                    <div className='text-sm text-muted-foreground'>
                      Məlumat yüklənir...
                    </div>
                  ) : detailMatches.length === 0 ? (
                    <div className='text-sm text-muted-foreground'>
                      Son uyğunluq yoxdur.
                    </div>
                  ) : (
                    detailMatches.map((match) => {
                      const matchItem = match.item_id
                        ? detailItemById.get(match.item_id)
                        : null

                      return (
                        <div
                          key={match.id}
                          className='rounded-lg border p-3 text-sm'
                        >
                          <div className='font-medium'>
                            {match.matched_keyword || 'Açar söz yoxdur'}
                          </div>
                          <div className='mt-1 line-clamp-1 text-xs text-muted-foreground'>
                            {matchItem?.title || 'Xəbər başlığı yoxdur'}
                          </div>
                          <div className='mt-1 text-xs text-muted-foreground'>
                            {formatDate(match.created_at)}
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              </section>

              <section className='rounded-lg border border-success/25 bg-success/10 p-4'>
                <h3 className='font-semibold text-success'>Tövsiyə</h3>
                <p className='mt-2 text-sm text-success'>
                  {getRepairSuggestion(detailSource, detailQualityMetrics)}
                </p>
              </section>
            </div>
          </aside>
        </div>
      ) : null}

      {editing ? (
        <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4'>
          <div className='max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border bg-background p-6 shadow-lg'>
            <div className='mb-5'>
              <h2 className='text-2xl font-bold'>Mənbəni redaktə et</h2>
              <p className='text-sm text-muted-foreground'>
                Yalnız mənbənin oxunması üçün vacib sahələri dəyiş.
              </p>
            </div>

            <div className='space-y-4'>
              <section className='rounded-lg border p-4'>
                <div className='mb-3'>
                  <h3 className='font-semibold'>Əsas məlumat</h3>
                  <p className='text-xs text-muted-foreground'>
                    Domen, son xəbərlər səhifəsi və RSS linki.
                  </p>
                </div>

                <div className='grid gap-3 md:grid-cols-2'>
                  <label className='grid gap-2'>
                    <span className='text-sm font-medium'>Mənbə adı</span>
                    <input
                      value={editing.name}
                      onChange={(e) =>
                        setEditing({ ...editing, name: e.target.value })
                      }
                      className='rounded-lg border bg-background px-3 py-2'
                    />
                  </label>

                  <label className='grid gap-2'>
                    <span className='text-sm font-medium'>Əsas URL</span>
                    <input
                      value={editing.base_url}
                      onChange={(e) =>
                        setEditing({ ...editing, base_url: e.target.value })
                      }
                      className='rounded-lg border bg-background px-3 py-2'
                    />
                  </label>

                  <label className='grid gap-2'>
                    <span className='text-sm font-medium'>
                      Son xəbərlər səhifəsi
                    </span>
                    <input
                      value={editing.latest_url || ''}
                      onChange={(e) =>
                        setEditing({ ...editing, latest_url: e.target.value })
                      }
                      className='rounded-lg border bg-background px-3 py-2'
                    />
                  </label>

                  <label className='grid gap-2'>
                    <span className='text-sm font-medium'>RSS URL</span>
                    <input
                      value={editing.rss_url || ''}
                      onChange={(e) =>
                        setEditing({ ...editing, rss_url: e.target.value })
                      }
                      className='rounded-lg border bg-background px-3 py-2'
                    />
                  </label>
                </div>
              </section>

              <section className='rounded-lg border p-4'>
                <div className='mb-3 flex flex-wrap items-start justify-between gap-3'>
                  <div>
                    <h3 className='font-semibold'>Oxuma üsulu</h3>
                    <p className='text-xs text-muted-foreground'>
                      Mənbənin hansı yolla oxunacağını seç.
                    </p>
                  </div>

                  <div className='flex flex-wrap gap-2'>
                    <a
                      href={editing.latest_url || editing.base_url}
                      target='_blank'
                      rel='noreferrer'
                      className='rounded-md border bg-background px-3 py-2 text-xs hover:bg-muted'
                    >
                      Saytı aç
                    </a>

                    <a
                      href={getSelectorPickerUrl(editing.id)}
                      target='_blank'
                      rel='noreferrer'
                      className='rounded-md border border-success/25 bg-success/10 px-3 py-2 text-xs font-medium text-success hover:bg-success/10'
                    >
                      Selector seç
                    </a>
                  </div>
                </div>

                <div className='grid gap-3 md:grid-cols-2'>
                  <label className='grid gap-2'>
                    <span className='text-sm font-medium'>Monitor metodu</span>
                    <select
                      value={editing.monitor_method || 'latest_page'}
                      onChange={(e) =>
                        setEditing({
                          ...editing,
                          monitor_method: e.target.value,
                        })
                      }
                      className='rounded-lg border bg-background px-3 py-2'
                    >
                      {EDITABLE_MONITOR_METHODS.map((method) => (
                        <option key={method} value={method}>
                          {formatMonitorMethod(method)}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className='grid gap-2'>
                    <span className='text-sm font-medium'>CSS selector</span>
                    <input
                      value={editing.selector || ''}
                      onChange={(e) =>
                        setEditing({ ...editing, selector: e.target.value })
                      }
                      className='rounded-lg border bg-background px-3 py-2'
                    />
                  </label>
                </div>

                <details className='mt-4 rounded-lg border bg-muted/50 p-3'>
                  <summary className='cursor-pointer text-sm font-medium'>
                    Ətraflı selector və XPath
                  </summary>

                  <label className='mt-3 grid gap-2'>
                    <span className='text-sm font-medium'>
                      Article pattern / XPath
                    </span>
                    <textarea
                      value={editing.article_pattern || ''}
                      onChange={(e) =>
                        setEditing({
                          ...editing,
                          article_pattern: e.target.value,
                        })
                      }
                      rows={3}
                      className='rounded-lg border bg-background px-3 py-2'
                    />
                  </label>

                  <div className='mt-3 grid gap-2 md:grid-cols-2'>
                    {SELECTOR_TEMPLATES.map((template) => (
                      <button
                        key={template.name}
                        type='button'
                        onClick={() => applySelectorTemplate(template)}
                        className='rounded-lg border bg-background p-3 text-left text-xs hover:bg-muted'
                      >
                        <div className='font-medium'>{template.name}</div>
                        <div className='mt-1 line-clamp-2 text-muted-foreground'>
                          {template.articlePattern}
                        </div>
                      </button>
                    ))}
                  </div>
                </details>
              </section>

              <section className='rounded-lg border bg-muted/50 p-4'>
                <div className='mb-3'>
                  <h3 className='font-semibold'>Cari vəziyyət</h3>
                  <p className='text-xs text-muted-foreground'>
                    Bu məlumatlar sistem tərəfindən yazılır və burada yalnız
                    oxunur.
                  </p>
                </div>

                <div className='grid gap-3 text-sm md:grid-cols-3'>
                  <div>
                    <div className='text-xs text-muted-foreground'>Status</div>
                    <div className='font-medium'>
                      {editing.status === 'active' ? 'Aktiv' : 'Passiv'}
                    </div>
                  </div>
                  <div>
                    <div className='text-xs text-muted-foreground'>
                      Son nəticə
                    </div>
                    <div className='font-medium'>
                      {formatResult(editing.last_result)}
                    </div>
                  </div>
                  <div>
                    <div className='text-xs text-muted-foreground'>
                      Fail sayı
                    </div>
                    <div className='font-medium'>
                      {editing.consecutive_fail_count || 0}
                    </div>
                  </div>
                  <div>
                    <div className='text-xs text-muted-foreground'>
                      Son yoxlama
                    </div>
                    <div className='font-medium'>
                      {formatDate(editing.last_checked_at)}
                    </div>
                  </div>
                  <div>
                    <div className='text-xs text-muted-foreground'>
                      Son uğur
                    </div>
                    <div className='font-medium'>
                      {formatDate(editing.last_success_at)}
                    </div>
                  </div>
                  <div>
                    <div className='text-xs text-muted-foreground'>
                      Son xəbər
                    </div>
                    <div className='font-medium'>
                      {formatDate(editing.last_article_found_at)}
                    </div>
                  </div>
                  <div className='md:col-span-3'>
                    <div className='text-xs text-muted-foreground'>
                      Son xəta
                    </div>
                    <div className='line-clamp-2 font-medium'>
                      {editing.last_error || '-'}
                    </div>
                  </div>
                </div>
              </section>
            </div>

            <div className='mt-6 flex justify-end gap-2'>
              <button
                onClick={() => setEditing(null)}
                className='rounded-md border px-4 py-2 text-sm hover:bg-muted'
              >
                Bağla
              </button>

              <button
                onClick={saveEdit}
                className='rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground'
              >
                Yadda saxla
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
export const Route = createFileRoute('/(auth)/admin/monitor/sources')({
  component: SourcesPage,
})
