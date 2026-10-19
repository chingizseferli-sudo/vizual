import { useEffect, useMemo, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { getStatusLabel } from '@/lib/status-ui'
import { supabase } from '@/lib/supabase'
import { ResponsiveTable } from '@/components/ui/responsive-table'

type SourceCheck = {
  id: string
  name: string | null
  base_url: string | null
  latest_url: string | null
  rss_url: string | null
  status: string | null
  monitor_method: string | null
  last_checked_at: string | null
  last_success_at: string | null
  last_article_found_at: string | null
  last_result: string | null
  last_error: string | null
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
  sample_links?: string[] | null
  created_at?: string | null
  checked_at?: string | null
}

type RejectedSource = {
  id?: string | number
  domain?: string | null
  url?: string | null
  reason?: string | null
  checked_at?: string | null
}

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

function getHost(value: string | null | undefined) {
  if (!value) return ''

  try {
    const url = new URL(value.startsWith('http') ? value : `https://${value}`)
    return url.hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return value
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('/')[0]
  }
}

function sourceTitle(source: SourceCheck) {
  return (
    getHost(source.base_url) ||
    getHost(source.latest_url) ||
    getHost(source.rss_url) ||
    source.name ||
    '-'
  )
}

function getSourceState(source: SourceCheck) {
  const result = source.last_result || ''
  const failCount = source.consecutive_fail_count || 0

  if (source.status !== 'active') return 'inactive'
  if (result === 'site_error' || failCount >= 5) return 'error'
  if (result === 'no_candidate' || failCount > 0 || source.last_error)
    return 'warning'
  if (
    source.last_checked_at &&
    (source.last_success_at || source.last_article_found_at)
  )
    return 'ok'
  if (source.last_checked_at) return 'warning'
  return 'unknown'
}

function getStateLabel(state: string) {
  const labels: Record<string, string> = {
    ok: 'Bot oxuyur',
    warning: 'Diqqət lazımdır',
    error: 'Problem var',
    inactive: 'Passivdir',
    unknown: 'Yoxlanmayıb',
  }

  return labels[state] || state
}

function getActionHint(source: SourceCheck) {
  const result = source.last_result || ''
  const failCount = source.consecutive_fail_count || 0

  if (source.status !== 'active') return 'Aktiv etmədən monitorinqə düşməyəcək.'
  if (result === 'site_error' || failCount >= 5)
    return 'Bərpa et və ya Google News/RSS fallback yoxla.'
  if (result === 'no_candidate')
    return 'RSS, sitemap və selector yenidən yoxlanmalıdır.'
  if (result === 'no_date')
    return 'Tarix parseri və ya məqalə səhifəsi yoxlanmalıdır.'
  if (result === 'old_news')
    return 'Sayt oxunur, amma son 1 saatlıq xəbər tapılmayıb.'
  if (result === 'no_monitor_match')
    return 'Sayt oxunur, istifadəçi açar sözünə uyğun xəbər yoxdur.'
  if (result === 'duplicate')
    return 'Sayt oxunur, xəbər təkrar olduğu üçün keçilib.'
  if (result === 'sent') return 'Uğurlu xəbər göndərilib.'
  if (!source.last_checked_at) return 'Bot hələ bu mənbəni yoxlamayıb.'
  return 'Son nəticəyə görə mənbəni yoxla.'
}

function getRejectCategory(reason?: string | null) {
  const value = (reason || '').toLowerCase()

  if (
    value.includes('commercial_site_not_news') ||
    value.includes('rejected_commercial') ||
    value.includes('commercial site signals')
  ) {
    return 'commercial'
  }
  if (
    value.includes('insufficient_news_activity') ||
    value.includes('rejected_inactive_news') ||
    value.includes('activity too low')
  ) {
    return 'inactive'
  }
  if (value.includes('subdomain_rejected')) return 'subdomain'
  if (value.includes('gov') || value.includes('bad_url')) return 'blocked'
  return 'other'
}

function getRejectLabel(category: string) {
  const labels: Record<string, string> = {
    commercial: 'Kommersiya',
    inactive: 'Aktivlik azdır',
    subdomain: 'Subdomain',
    blocked: 'Bloklanıb',
    other: 'Digər',
  }

  return labels[category] || category
}

function formatMonitorMethod(value: string | null) {
  const labels: Record<string, string> = {
    rss: 'RSS',
    rss_discovered: 'RSS',
    latest_page: 'Son xəbərlər səhifəsi',
    sitemap: 'Sitemap',
    homepage: 'Ana səhifə',
    selector: 'CSS Selector',
    xpath_pattern: 'XPath',
    google_news_fallback: 'Google News',
    recoverable: 'Bərpa rejimi',
    blocked: 'Bloklanıb',
    dead: 'İşləmir',
    failed: 'Xəta',
  }
  return labels[value || ''] || value || 'Avtomatik'
}

function matchesMonitorMethodFilter(method: string | null, filter: string) {
  if (filter === 'all') return true
  if (filter === 'rss') return ['rss', 'rss_discovered'].includes(method || '')
  return method === filter
}

function LogsPage() {
  const [sources, setSources] = useState<SourceCheck[]>([])
  const [logs, setLogs] = useState<DiscoveryLog[]>([])
  const [rejected, setRejected] = useState<RejectedSource[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<'checks' | 'discovery' | 'rejected'>('checks')
  const [stateFilter, setStateFilter] = useState('all')
  const [methodFilter, setMethodFilter] = useState('all')
  const [rejectCategoryFilter, setRejectCategoryFilter] = useState('all')
  const [page, setPage] = useState(1)
  const pageSize = 25

  async function loadData() {
    setLoading(true)
    setMessage('')

    const [sourcesRes, logsRes, rejectedRes] = await Promise.all([
      supabase
        .from('sources')
        .select(
          'id,name,base_url,latest_url,rss_url,status,monitor_method,last_checked_at,last_success_at,last_article_found_at,last_result,last_error,consecutive_fail_count,notes'
        )
        .order('last_checked_at', { ascending: false, nullsFirst: false })
        .limit(1000),
      supabase
        .from('discovery_logs')
        .select('*')
        .order('created_at', { ascending: false, nullsFirst: false })
        .limit(500),
      supabase
        .from('rejected_sources')
        .select('id,domain,url,reason,checked_at')
        .order('checked_at', { ascending: false, nullsFirst: false })
        .limit(500),
    ])

    const errors = [sourcesRes.error, logsRes.error, rejectedRes.error]
      .filter(Boolean)
      .map((error) => error?.message)

    if (errors.length > 0) setMessage(errors.join(' | '))

    setSources((sourcesRes.data || []) as SourceCheck[])
    setLogs((logsRes.data || []) as DiscoveryLog[])
    setRejected((rejectedRes.data || []) as RejectedSource[])
    setLoading(false)
  }

  const sourceRows = useMemo(() => {
    const q = search.toLowerCase().trim()

    return sources
      .slice()
      .sort((a, b) => getTime(b.last_checked_at) - getTime(a.last_checked_at))
      .filter((source) => {
        const state = getSourceState(source)
        const matchesState = stateFilter === 'all' || state === stateFilter
        const matchesMethod = matchesMonitorMethodFilter(
          source.monitor_method,
          methodFilter
        )

        if (!matchesState || !matchesMethod) return false
        if (!q) return true

        return (
          sourceTitle(source).includes(q) ||
          (source.base_url || '').toLowerCase().includes(q) ||
          (source.last_result || '').toLowerCase().includes(q) ||
          (source.last_error || '').toLowerCase().includes(q) ||
          (source.notes || '').toLowerCase().includes(q)
        )
      })
  }, [sources, search, stateFilter, methodFilter])

  const filteredLogs = useMemo(() => {
    const q = search.toLowerCase().trim()

    return logs
      .slice()
      .sort(
        (a, b) =>
          getTime(b.created_at || b.checked_at) -
          getTime(a.created_at || a.checked_at)
      )
      .filter((row) => {
        if (!q) return true
        return (
          (row.domain || '').toLowerCase().includes(q) ||
          (row.url || '').toLowerCase().includes(q) ||
          (row.status || '').toLowerCase().includes(q) ||
          (row.reason || '').toLowerCase().includes(q) ||
          (row.method || '').toLowerCase().includes(q)
        )
      })
  }, [logs, search])

  const filteredRejected = useMemo(() => {
    const q = search.toLowerCase().trim()

    return rejected
      .slice()
      .sort((a, b) => getTime(b.checked_at) - getTime(a.checked_at))
      .filter((row) => {
        const matchesCategory =
          rejectCategoryFilter === 'all' ||
          getRejectCategory(row.reason) === rejectCategoryFilter

        if (!matchesCategory) return false
        if (!q) return true

        return (
          (row.domain || '').toLowerCase().includes(q) ||
          (row.url || '').toLowerCase().includes(q) ||
          (row.reason || '').toLowerCase().includes(q)
        )
      })
  }, [rejected, search, rejectCategoryFilter])

  const activeCount =
    tab === 'checks'
      ? sourceRows.length
      : tab === 'discovery'
        ? filteredLogs.length
        : filteredRejected.length
  const totalPages = Math.max(1, Math.ceil(activeCount / pageSize))
  const safePage = Math.min(page, totalPages)
  const paginatedSources = sourceRows.slice(
    (safePage - 1) * pageSize,
    safePage * pageSize
  )
  const paginatedLogs = filteredLogs.slice(
    (safePage - 1) * pageSize,
    safePage * pageSize
  )
  const paginatedRejected = filteredRejected.slice(
    (safePage - 1) * pageSize,
    safePage * pageSize
  )

  const methods = useMemo(() => {
    const seen = new Set<string>()
    return sources
      .map((source) =>
        source.monitor_method === 'rss_discovered'
          ? 'rss'
          : source.monitor_method
      )
      .filter((method): method is string => Boolean(method))
      .filter((method) => {
        if (seen.has(method)) return false
        seen.add(method)
        return true
      })
      .sort()
  }, [sources])

  const stats = useMemo(() => {
    return {
      total: sources.length,
      ok: sources.filter((source) => getSourceState(source) === 'ok').length,
      warning: sources.filter((source) => getSourceState(source) === 'warning')
        .length,
      error: sources.filter((source) => getSourceState(source) === 'error')
        .length,
      unchecked: sources.filter(
        (source) => getSourceState(source) === 'unknown'
      ).length,
    }
  }, [sources])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadData()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [])

  function resetFilteredView() {
    setPage(1)
  }

  if (loading) return <div className='p-6'>Yüklənir...</div>

  return (
    <div className='grid min-w-0 gap-4 p-4 md:p-6'>
      <div>
        <h1 className='text-xl font-semibold tracking-tight'>Bot logları</h1>
        <p className='mt-1 text-sm text-muted-foreground'>
          Mənbə yoxlamaları, aşkarlama və xəta qeydləri.
        </p>
      </div>

      {message ? (
        <div className='rounded-lg border bg-card p-4 text-sm text-warning'>
          {message}
        </div>
      ) : null}

      <div className='grid gap-4 md:grid-cols-5'>
        <button
          type='button'
          onClick={() => {
            setTab('checks')
            setStateFilter('all')
            resetFilteredView()
          }}
          className='rounded-lg border border-border bg-muted p-4 text-left'
        >
          <div className='text-sm text-muted-foreground'>Ümumi mənbə</div>
          <div className='text-2xl font-bold text-foreground'>
            {stats.total}
          </div>
        </button>
        <button
          type='button'
          onClick={() => {
            setTab('checks')
            setStateFilter('ok')
            resetFilteredView()
          }}
          className='rounded-lg border border-success/25 bg-success/10 p-4 text-left'
        >
          <div className='text-sm text-muted-foreground'>Bot oxuyur</div>
          <div className='text-2xl font-bold text-success'>{stats.ok}</div>
        </button>
        <button
          type='button'
          onClick={() => {
            setTab('checks')
            setStateFilter('warning')
            resetFilteredView()
          }}
          className='rounded-lg border border-warning/25 bg-warning/10 p-4 text-left'
        >
          <div className='text-sm text-muted-foreground'>Diqqət lazımdır</div>
          <div className='text-2xl font-bold text-warning'>{stats.warning}</div>
        </button>
        <button
          type='button'
          onClick={() => {
            setTab('checks')
            setStateFilter('error')
            resetFilteredView()
          }}
          className='rounded-lg border border-destructive/25 bg-destructive/10 p-4 text-left'
        >
          <div className='text-sm text-muted-foreground'>Problem var</div>
          <div className='text-2xl font-bold text-destructive'>
            {stats.error}
          </div>
        </button>
        <button
          type='button'
          onClick={() => {
            setTab('checks')
            setStateFilter('unknown')
            resetFilteredView()
          }}
          className='rounded-lg border border-border bg-muted p-4 text-left'
        >
          <div className='text-sm text-muted-foreground'>Yoxlanmayıb</div>
          <div className='text-2xl font-bold text-foreground'>
            {stats.unchecked}
          </div>
        </button>
      </div>

      <div className='grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_auto_auto_auto_auto]'>
        <input
          aria-label='Domen, nəticə, xəta, metod və ya səbəb üzrə axtar...'
          value={search}
          onChange={(event) => {
            setSearch(event.target.value)
            resetFilteredView()
          }}
          placeholder='Domen, nəticə, xəta, metod və ya səbəb üzrə axtar...'
          className='rounded-lg border bg-background px-3 py-2'
        />

        <select
          aria-label='Monitorinq metodu'
          value={methodFilter}
          onChange={(event) => {
            setMethodFilter(event.target.value)
            resetFilteredView()
          }}
          className='rounded-lg border bg-background px-3 py-2'
          disabled={tab !== 'checks'}
        >
          <option value='all'>Bütün metodlar</option>
          {methods.map((method) => (
            <option key={method} value={method}>
              {formatMonitorMethod(method)}
            </option>
          ))}
        </select>

        <select
          aria-label='Rədd səbəbi filtri'
          value={rejectCategoryFilter}
          onChange={(event) => {
            setRejectCategoryFilter(event.target.value)
            resetFilteredView()
          }}
          className='rounded-lg border bg-background px-3 py-2'
          disabled={tab !== 'rejected'}
        >
          <option value='all'>Bütün reject səbəbləri</option>
          <option value='commercial'>Kommersiya</option>
          <option value='inactive'>Aktivlik azdır</option>
          <option value='subdomain'>Subdomain</option>
          <option value='blocked'>Bloklanıb</option>
          <option value='other'>Digər</option>
        </select>

        <button
          type='button'
          onClick={() => {
            setTab('checks')
            resetFilteredView()
          }}
          className={`rounded-lg border px-4 py-2 ${tab === 'checks' ? 'bg-primary text-primary-foreground' : ''}`}
        >
          Mənbə yoxlamaları
        </button>
        <button
          type='button'
          onClick={() => {
            setTab(tab === 'discovery' ? 'rejected' : 'discovery')
            resetFilteredView()
          }}
          className={`rounded-lg border px-4 py-2 ${tab !== 'checks' ? 'bg-primary text-primary-foreground' : ''}`}
        >
          {tab === 'rejected' ? 'Rədd edilənlər' : 'Aşkarlama'}
        </button>
      </div>

      {tab === 'checks' ? (
        <ResponsiveTable label='Monitorinq məlumatları'>
          <table className='w-full text-sm'>
            <thead className='bg-muted/50'>
              <tr>
                <th className='p-4 text-left'>Mənbə</th>
                <th className='p-4 text-left'>Vəziyyət</th>
                <th className='p-4 text-left'>Bot nəticəsi</th>
                <th className='p-4 text-left'>Son yoxlama</th>
                <th className='p-4 text-left'>Təklif</th>
                <th className='p-4 text-right'>İş</th>
              </tr>
            </thead>
            <tbody>
              {paginatedSources.map((source) => {
                const state = getSourceState(source)
                const rowClass =
                  state === 'ok'
                    ? 'bg-success/15'
                    : state === 'error'
                      ? 'bg-destructive/15'
                      : state === 'warning'
                        ? 'bg-warning/15'
                        : 'bg-muted/50'

                return (
                  <tr key={source.id} className={`border-t ${rowClass}`}>
                    <td className='p-4'>
                      <div className='font-semibold'>{sourceTitle(source)}</div>
                      <div className='line-clamp-1 text-xs text-muted-foreground'>
                        {source.base_url || source.latest_url || source.rss_url}
                      </div>
                    </td>
                    <td className='p-4'>
                      <span className='rounded-full border bg-background px-2 py-1 text-xs'>
                        {getStateLabel(state)}
                      </span>
                      <div className='mt-2 text-xs text-muted-foreground'>
                        {source.monitor_method || 'auto'} · fail{' '}
                        {source.consecutive_fail_count || 0}
                      </div>
                    </td>
                    <td className='max-w-sm p-4'>
                      <div className='font-medium'>
                        {getStatusLabel(source.last_result, '-')}
                      </div>
                      <div className='mt-1 line-clamp-2 text-xs text-destructive'>
                        {source.last_error || source.notes || '-'}
                      </div>
                    </td>
                    <td className='p-4'>
                      <div>{formatDate(source.last_checked_at)}</div>
                      <div className='mt-1 text-xs text-muted-foreground'>
                        Son uğur: {formatDate(source.last_success_at)}
                      </div>
                    </td>
                    <td className='max-w-sm p-4 text-xs text-muted-foreground'>
                      {getActionHint(source)}
                    </td>
                    <td className='p-4 text-right'>
                      <div className='flex justify-end gap-2'>
                        <Link
                          to='/admin/monitor/picker'
                          search={{ sourceId: source.id }}
                          className='rounded-md border px-3 py-1 text-xs hover:bg-muted'
                        >
                          Selector
                        </Link>
                        <a
                          href={source.latest_url || source.base_url || '#'}
                          target='_blank'
                          rel='noreferrer'
                          className='rounded-md border px-3 py-1 text-xs hover:bg-muted'
                        >
                          Aç
                        </a>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {sourceRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className='p-10 text-center text-muted-foreground'
                  >
                    Mənbə yoxlama qeydi tapılmadı.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </ResponsiveTable>
      ) : null}

      {tab === 'discovery' ? (
        <ResponsiveTable label='Monitorinq məlumatları'>
          <table className='w-full text-sm'>
            <thead className='bg-muted/50'>
              <tr>
                <th className='p-4 text-left'>Domen</th>
                <th className='p-4 text-left'>Status</th>
                <th className='p-4 text-left'>Metod</th>
                <th className='p-4 text-left'>Score</th>
                <th className='p-4 text-left'>Səbəb</th>
                <th className='p-4 text-left'>Tarix</th>
                <th className='p-4 text-right'>URL</th>
              </tr>
            </thead>
            <tbody>
              {paginatedLogs.map((row, index) => (
                <tr
                  key={String(row.id || `${row.domain}-${index}`)}
                  className='border-t'
                >
                  <td className='p-4 font-medium'>{row.domain || '-'}</td>
                  <td className='p-4'>{getStatusLabel(row.status, '-')}</td>
                  <td className='p-4'>{row.method || '-'}</td>
                  <td className='p-4'>{row.score ?? '-'}</td>
                  <td className='max-w-xl p-4 text-muted-foreground'>
                    {row.reason || '-'}
                  </td>
                  <td className='p-4'>
                    {formatDate(row.created_at || row.checked_at)}
                  </td>
                  <td className='p-4 text-right'>
                    {row.url ? (
                      <a
                        href={row.url}
                        target='_blank'
                        rel='noreferrer'
                        className='text-primary underline'
                      >
                        Aç
                      </a>
                    ) : (
                      '-'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ResponsiveTable>
      ) : null}

      {tab === 'rejected' ? (
        <ResponsiveTable label='Monitorinq məlumatları'>
          <table className='w-full text-sm'>
            <thead className='bg-muted/50'>
              <tr>
                <th className='p-4 text-left'>Domen</th>
                <th className='p-4 text-left'>Kateqoriya</th>
                <th className='p-4 text-left'>Səbəb</th>
                <th className='p-4 text-left'>Tarix</th>
                <th className='p-4 text-right'>URL</th>
              </tr>
            </thead>
            <tbody>
              {paginatedRejected.map((row, index) => (
                <tr
                  key={String(row.id || `${row.domain}-${index}`)}
                  className='border-t'
                >
                  <td className='p-4 font-medium'>{row.domain || '-'}</td>
                  <td className='p-4'>
                    <span className='rounded-full border px-2 py-1 text-xs'>
                      {getRejectLabel(getRejectCategory(row.reason))}
                    </span>
                  </td>
                  <td className='max-w-2xl p-4 text-muted-foreground'>
                    {row.reason || '-'}
                  </td>
                  <td className='p-4'>{formatDate(row.checked_at)}</td>
                  <td className='p-4 text-right'>
                    {row.url ? (
                      <a
                        href={row.url}
                        target='_blank'
                        rel='noreferrer'
                        className='text-primary underline'
                      >
                        Aç
                      </a>
                    ) : (
                      '-'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ResponsiveTable>
      ) : null}

      <div className='flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4'>
        <div className='text-sm text-muted-foreground'>
          Səhifə <b>{safePage}</b> / <b>{totalPages}</b> · Hər səhifədə{' '}
          <b>{pageSize}</b> qeyd
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

export const Route = createFileRoute('/(auth)/admin/monitor/logs')({
  component: LogsPage,
})
