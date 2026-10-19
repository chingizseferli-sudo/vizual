import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { getStatusLabel } from '@/lib/status-ui'
import { supabase } from '@/lib/supabase'
import { ResponsiveTable } from '@/components/ui/responsive-table'

type Source = {
  id: string
  name: string | null
  base_url: string
  latest_url: string | null
  rss_url: string | null
  source_type: string | null
  status: string | null
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
  notes: string | null
}

type DiscoveryLog = {
  id?: string | number
  domain?: string | null
  url?: string | null
  status?: string | null
  reason?: string | null
  method?: string | null
  score?: number | null
  created_at?: string | null
  checked_at?: string | null
}

type RepairResponse = {
  ok: boolean
  method: string
  reason: string
  candidateCount: number
  sampleLinks: string[]
  update: Record<string, unknown>
}

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

function formatDate(value: string | null | undefined) {
  if (!value) return '-'

  return new Date(value).toLocaleString('az-AZ', {
    timeZone: 'Asia/Baku',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function getTime(value: string | null | undefined) {
  if (!value) return 0
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : 0
}

function getHostname(url: string | null | undefined) {
  if (!url) return ''

  try {
    const normalized = url.startsWith('http') ? url : `https://${url}`
    return new URL(normalized).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return ''
  }
}

function getSourceTitle(source: Source) {
  return (
    getHostname(source.base_url) ||
    getHostname(source.latest_url) ||
    source.name ||
    '-'
  )
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

function isRssMethod(source: Source) {
  return ['rss', 'rss_discovered', 'google_news_fallback'].includes(
    source.monitor_method || ''
  )
}

function isSelectorMethod(source: Source) {
  return ['selector', 'xpath_pattern'].includes(source.monitor_method || '')
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

function isStale(source: Source) {
  if (!source.last_checked_at) return source.status === 'active'

  const checkedAt = new Date(source.last_checked_at).getTime()
  if (!Number.isFinite(checkedAt)) return true

  return Date.now() - checkedAt > 24 * 60 * 60 * 1000
}

function getIssues(source: Source, sources: Source[]) {
  const issues: string[] = []
  const parentDomain = findParentDomain(source, sources)

  if (source.status !== 'active') issues.push('passivdir')
  if (parentDomain && source.discovery_status !== 'accepted') {
    issues.push(`subdomain: ${parentDomain}`)
  }
  if (isRssMethod(source) && !(source.rss_url || '').trim()) {
    issues.push('RSS yoxdur')
  }
  if (
    isSelectorMethod(source) &&
    !(source.selector || '').trim() &&
    !(source.article_pattern || '').trim()
  ) {
    issues.push('selector yoxdur')
  }
  if (['blocked', 'dead', 'failed'].includes(source.monitor_method || '')) {
    issues.push(source.monitor_method || 'problem')
  }
  if ((source.consecutive_fail_count || 0) > 0) {
    issues.push(`fail: ${source.consecutive_fail_count}`)
  }
  if (source.last_result === 'site_error') issues.push('sayt xətası')
  if (source.last_result === 'no_candidate') issues.push('xəbər linki tapmır')
  if (source.discovery_status === 'needs_manual_selector') {
    issues.push('manual selector lazımdır')
  }
  if (hasNonNewsSignal(source)) issues.push('xəbər saytı deyil')
  if (isStale(source)) issues.push('24 saatdan çox yoxlanmayıb')

  return Array.from(new Set(issues))
}

function getHealth(source: Source, sources: Source[]) {
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

  const issues = getIssues(source, sources)

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

function getRepairPlan(source: Source) {
  if (hasNonNewsSignal(source)) return 'Passiv saxla və siyahıdan çıxar'
  if ((source.rss_url || '').trim()) return 'RSS metoduna qaytar'
  if ((source.selector || '').trim() || (source.article_pattern || '').trim()) {
    return 'Selector metoduna qaytar'
  }
  if (source.discovery_status === 'needs_manual_selector') {
    return 'Selector seç'
  }
  if (source.last_result === 'site_error') return 'Google News fallback yoxla'
  return 'Latest page ilə yenidən yoxlat'
}

function getLatestLog(source: Source, logs: DiscoveryLog[]) {
  const host = getSourceTitle(source)

  return logs
    .filter((log) => {
      const domain = (log.domain || getHostname(log.url)).toLowerCase()
      return domain === host || domain.endsWith(`.${host}`)
    })
    .sort(
      (a, b) =>
        getTime(b.created_at || b.checked_at) -
        getTime(a.created_at || a.checked_at)
    )[0]
}

function ProblemSourcesPage() {
  const [sources, setSources] = useState<Source[]>([])
  const [logs, setLogs] = useState<DiscoveryLog[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'warning' | 'error'>('all')
  const [message, setMessage] = useState('')
  const [repairing, setRepairing] = useState(false)
  const [page, setPage] = useState(1)
  const pageSize = 20

  async function loadData() {
    setLoading(true)
    setMessage('')

    const [sourcesRes, logsRes] = await Promise.all([
      supabase
        .from('sources')
        .select(
          'id,name,base_url,latest_url,rss_url,source_type,status,monitor_method,selector,article_pattern,discovery_status,discovery_score,last_checked_at,last_success_at,last_article_found_at,last_error,last_result,consecutive_fail_count,notes'
        )
        .order('last_checked_at', { ascending: false, nullsFirst: false }),
      supabase
        .from('discovery_logs')
        .select(
          'id,domain,url,status,reason,method,score,created_at,checked_at'
        )
        .limit(500),
    ])

    if (sourcesRes.error) {
      setSources([])
      setMessage(`Mənbələr oxunmadı: ${sourcesRes.error.message}`)
    } else {
      setSources((sourcesRes.data || []) as Source[])
    }

    if (!logsRes.error) {
      setLogs((logsRes.data || []) as DiscoveryLog[])
    }

    setLoading(false)
  }

  async function runAutoRepair(source: Source) {
    const { data: repair, error: repairError } =
      await supabase.functions.invoke<RepairResponse>('source-repair', {
        body: { source },
      })

    if (repairError || !repair) {
      return {
        ok: false,
        message: repairError?.message || 'source-repair cavab vermədi',
      }
    }

    const { data: updated, error: updateError } = await supabase
      .from('sources')
      .update(repair.update)
      .eq('id', source.id)
      .select('id')

    if (updateError || !updated || updated.length === 0) {
      return {
        ok: false,
        message: updateError?.message || 'Supabase mənbəni yeniləmədi',
      }
    }

    return {
      ok: repair.ok,
      message: repair.ok
        ? `${getSourceTitle(source)} işləyir: ${repair.method}, ${repair.candidateCount} link tapıldı.`
        : `${getSourceTitle(source)} bərpa olunmadı: ${repair.reason}`,
    }
  }

  async function repairSource(source: Source) {
    setRepairing(true)
    setMessage(`${getSourceTitle(source)} real test edilir...`)

    const result = await runAutoRepair(source)

    setRepairing(false)
    setMessage(result.message)
    await loadData()
  }

  async function repairAllVisible() {
    const rows = filteredProblemSources.filter(
      (source) => !hasNonNewsSignal(source)
    )

    if (rows.length === 0) {
      alert('Bərpa ediləcək mənbə yoxdur.')
      return
    }

    const ok = window.confirm(
      `${rows.length} problemli mənbə real test ediləcək. Davam edək?`
    )
    if (!ok) return

    setRepairing(true)
    setMessage(`${rows.length} mənbə real test edilir...`)

    let fixed = 0
    let failed = 0

    for (const source of rows) {
      const result = await runAutoRepair(source)
      if (result.ok) fixed += 1
      else failed += 1
    }

    setRepairing(false)
    setMessage(
      `Avtomatik bərpa bitdi: ${fixed} mənbə real işlək tapıldı, ${failed} mənbə hələ problemli qaldı.`
    )
    await loadData()
  }

  async function deactivateSource(source: Source) {
    const ok = window.confirm(`${getSourceTitle(source)} passiv edilsin?`)
    if (!ok) return

    const { error } = await supabase
      .from('sources')
      .update({
        name: getSourceTitle(source),
        status: 'inactive',
        notes: 'Admin problemli mənbə bölməsindən passiv etdi',
      })
      .eq('id', source.id)

    if (error) {
      alert(`Passiv edilmədi: ${error.message}`)
      return
    }

    await loadData()
  }

  const problemSources = sources.filter(
    (source) => getHealth(source, sources) !== 'ok'
  )

  const filteredProblemSources = problemSources
    .filter(
      (source) => filter === 'all' || getHealth(source, sources) === filter
    )
    .filter((source) => {
      const q = search.toLowerCase().trim()

      if (!q) return true
      return (
        getSourceTitle(source).includes(q) ||
        (source.base_url || '').toLowerCase().includes(q) ||
        (source.last_result || '').toLowerCase().includes(q) ||
        (source.last_error || '').toLowerCase().includes(q) ||
        getIssues(source, sources).join(' ').toLowerCase().includes(q)
      )
    })
    .sort((a, b) => {
      const ah = getHealth(a, sources) === 'error' ? 0 : 1
      const bh = getHealth(b, sources) === 'error' ? 0 : 1
      if (ah !== bh) return ah - bh
      return (b.consecutive_fail_count || 0) - (a.consecutive_fail_count || 0)
    })

  const stats = {
    total: sources.length,
    ok: sources.filter((source) => getHealth(source, sources) === 'ok').length,
    warning: sources.filter(
      (source) => getHealth(source, sources) === 'warning'
    ).length,
    error: sources.filter((source) => getHealth(source, sources) === 'error')
      .length,
    shown: filteredProblemSources.length,
  }

  const totalPages = Math.max(
    1,
    Math.ceil(filteredProblemSources.length / pageSize)
  )
  const safePage = Math.min(page, totalPages)
  const paginatedSources = filteredProblemSources.slice(
    (safePage - 1) * pageSize,
    safePage * pageSize
  )

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadData()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [])

  if (loading) return <div className='p-6'>Yüklənir...</div>

  return (
    <div className='grid gap-6 p-6'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div>
          <h1 className='text-xl font-semibold tracking-tight'>
            Problemli mənbələr
          </h1>
          <p className='text-muted-foreground'>
            Botun oxuya bilmədiyi və bərpa tələb edən saytlar
          </p>
        </div>
        <button
          type='button'
          onClick={repairAllVisible}
          disabled={repairing}
          className='rounded-lg border border-success/25 bg-success/10 px-4 py-2 text-sm font-medium text-success hover:bg-success/10'
        >
          Görünənləri bərpa et
        </button>
      </div>

      {message ? (
        <div className='rounded-lg border border-border bg-muted p-4 text-sm text-foreground'>
          {message}
        </div>
      ) : null}

      <div className='grid gap-4 md:grid-cols-5'>
        <button
          type='button'
          onClick={() => {
            setFilter('all')
            setPage(1)
          }}
          className='rounded-lg border bg-card p-4 text-left hover:bg-muted/50'
        >
          <div className='text-sm text-muted-foreground'>Ümumi mənbə</div>
          <div className='text-2xl font-bold'>{stats.total}</div>
        </button>
        <div className='rounded-lg border border-success/25 bg-success/10 p-4'>
          <div className='text-sm text-muted-foreground'>Bot izləyir</div>
          <div className='text-2xl font-bold text-success'>{stats.ok}</div>
        </div>
        <button
          type='button'
          onClick={() => {
            setFilter('warning')
            setPage(1)
          }}
          className='rounded-lg border border-warning/25 bg-warning/10 p-4 text-left hover:bg-warning/15'
        >
          <div className='text-sm text-muted-foreground'>Bərpa oluna bilər</div>
          <div className='text-2xl font-bold text-warning'>{stats.warning}</div>
        </button>
        <button
          type='button'
          onClick={() => {
            setFilter('error')
            setPage(1)
          }}
          className='rounded-lg border border-destructive/25 bg-destructive/10 p-4 text-left hover:bg-destructive/15'
        >
          <div className='text-sm text-muted-foreground'>İşləmir</div>
          <div className='text-2xl font-bold text-destructive'>
            {stats.error}
          </div>
        </button>
        <div className='rounded-lg border border-border bg-muted p-4'>
          <div className='text-sm text-muted-foreground'>Göstərilən</div>
          <div className='text-2xl font-bold text-foreground'>
            {stats.shown}
          </div>
        </div>
      </div>

      <div className='rounded-lg border bg-card p-4'>
        <input
          aria-label='Domen, problem, bot nəticəsi və ya xəta üzrə axtar...'
          value={search}
          onChange={(event) => {
            setSearch(event.target.value)
            setPage(1)
          }}
          placeholder='Domen, problem, bot nəticəsi və ya xəta üzrə axtar...'
          className='w-full rounded-lg border bg-background px-3 py-2'
        />
      </div>

      <ResponsiveTable label='Monitorinq məlumatları'>
        <table className='w-full text-sm'>
          <thead className='bg-muted/50'>
            <tr>
              <th className='p-4 text-left'>Mənbə</th>
              <th className='p-4 text-left'>Vəziyyət</th>
              <th className='p-4 text-left'>Problem</th>
              <th className='p-4 text-left'>Son log</th>
              <th className='p-4 text-left'>Təklif</th>
              <th className='p-4 text-right'>İş</th>
            </tr>
          </thead>
          <tbody>
            {paginatedSources.map((source) => {
              const health = getHealth(source, sources)
              const issues = getIssues(source, sources)
              const latestLog = getLatestLog(source, logs)
              const rowClass =
                health === 'error' ? 'bg-destructive/15' : 'bg-warning/15'

              return (
                <tr key={source.id} className={`border-t ${rowClass}`}>
                  <td className='p-4'>
                    <div className='font-semibold'>
                      {getSourceTitle(source)}
                    </div>
                    <div className='line-clamp-1 text-xs text-muted-foreground'>
                      {source.base_url}
                    </div>
                  </td>
                  <td className='p-4'>
                    <span
                      className={`rounded-full border px-2 py-1 text-xs ${health === 'error' ? 'border-destructive/25 bg-destructive/10 text-destructive' : 'border-warning/25 bg-warning/10 text-warning'}`}
                    >
                      {health === 'error' ? 'İşləmir' : 'Bərpa oluna bilər'}
                    </span>
                    <div className='mt-2 text-xs text-muted-foreground'>
                      {source.monitor_method || 'auto'} · fail{' '}
                      {source.consecutive_fail_count || 0}
                    </div>
                  </td>
                  <td className='max-w-md p-4'>
                    <div className='flex flex-wrap gap-1'>
                      {issues.slice(0, 4).map((issue) => (
                        <span
                          key={issue}
                          className='rounded-full border bg-background px-2 py-1 text-xs'
                        >
                          {issue}
                        </span>
                      ))}
                    </div>
                    {source.last_error ? (
                      <div className='mt-2 line-clamp-1 text-xs text-destructive'>
                        {source.last_error}
                      </div>
                    ) : null}
                  </td>
                  <td className='max-w-sm p-4'>
                    <div className='text-xs font-medium'>
                      {getStatusLabel(
                        source.last_result || latestLog?.status,
                        '-'
                      )}
                    </div>
                    <div className='mt-1 line-clamp-2 text-xs text-muted-foreground'>
                      {latestLog?.reason || source.notes || '-'}
                    </div>
                    <div className='mt-1 text-xs text-muted-foreground'>
                      {formatDate(
                        source.last_checked_at ||
                          latestLog?.created_at ||
                          latestLog?.checked_at
                      )}
                    </div>
                  </td>
                  <td className='p-4'>
                    <span className='rounded-full border border-border bg-muted px-2 py-1 text-xs text-foreground'>
                      {getRepairPlan(source)}
                    </span>
                  </td>
                  <td className='p-4 text-right'>
                    <div className='flex flex-wrap justify-end gap-2'>
                      <button
                        type='button'
                        onClick={() => repairSource(source)}
                        disabled={repairing}
                        className='rounded-md border border-success/25 bg-success/10 px-3 py-1 text-xs text-success hover:bg-success/10'
                      >
                        Bərpa et
                      </button>
                      <a
                        href={`/admin/monitor/picker?sourceId=${source.id}`}
                        className='rounded-md border px-3 py-1 text-xs hover:bg-muted'
                      >
                        Selector
                      </a>
                      <a
                        href={source.latest_url || source.base_url}
                        target='_blank'
                        rel='noreferrer'
                        className='rounded-md border px-3 py-1 text-xs hover:bg-muted'
                      >
                        Aç
                      </a>
                      <button
                        type='button'
                        onClick={() => deactivateSource(source)}
                        className='rounded-md border border-destructive/25 px-3 py-1 text-xs text-destructive hover:bg-destructive/10'
                      >
                        Passiv et
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}

            {paginatedSources.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className='p-10 text-center text-muted-foreground'
                >
                  Problemli mənbə tapılmadı.
                </td>
              </tr>
            ) : null}
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
    </div>
  )
}

export const Route = createFileRoute('/(auth)/admin/monitor/problems')({
  component: ProblemSourcesPage,
})
