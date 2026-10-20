import { useEffect, useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { supabase } from '@/lib/supabase'
import { ResponsiveTable } from '@/components/ui/responsive-table'

// One source = one state. The worker keeps the health fields up to date
// (consecutive_fail_count, last_article_found_at, trial tag in notes); this
// page only reads them. States:
//   trial    new source, read silently by the bot, promoted automatically
//   active   sending news
//   degraded active but failing or silent for too long
//   review   needs a human decision
//   off      switched off
type Source = {
  id: string
  name: string
  base_url: string
  latest_url: string | null
  rss_url: string | null
  status: string | null
  monitor_method: string | null
  selector: string | null
  article_pattern: string | null
  discovery_status: string | null
  last_checked_at: string | null
  last_article_found_at: string | null
  last_error: string | null
  consecutive_fail_count: number | null
  notes: string | null
}

type SourceState = 'trial' | 'active' | 'degraded' | 'review' | 'off'
type StateFilter = 'all' | SourceState

type RepairResponse = {
  ok: boolean
  method: string
  reason: string
  candidateCount: number
  finalUrl?: string
  update: Record<string, unknown>
}

const SOURCE_COLUMNS =
  'id,name,base_url,latest_url,rss_url,status,monitor_method,selector,article_pattern,discovery_status,last_checked_at,last_article_found_at,last_error,consecutive_fail_count,notes'

const FAIL_LIMIT = 3
const SILENT_HOURS = 48
const PAGE_SIZE = 25
const MAX_BULK_ADD = 20

const TRIAL_TAG = /\[trial passes=(\d+) fails=(\d+) since=[^\]\s]+\]/
const TRIAL_TAG_WITH_SPACE = /\s*\[trial passes=\d+ fails=\d+ since=[^\]\s]+\]/

const EDITABLE_METHODS = [
  'rss',
  'latest_page',
  'sitemap',
  'homepage',
  'selector',
  'xpath_pattern',
  'google_news_fallback',
]

const METHOD_LABELS: Record<string, string> = {
  rss: 'RSS',
  rss_discovered: 'RSS',
  selector: 'CSS Selector',
  xpath_pattern: 'XPath',
  latest_page: 'Son xəbərlər səhifəsi',
  sitemap: 'Sitemap',
  homepage: 'Ana səhifə',
  google_news_fallback: 'Google News',
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

const STATE_META: Record<SourceState, { label: string; badge: string }> = {
  active: {
    label: 'Aktiv',
    badge: 'border-success/25 bg-success/10 text-success',
  },
  trial: {
    label: 'Sınaqda',
    badge: 'border-primary/25 bg-primary/10 text-primary',
  },
  degraded: {
    label: 'Zəifləyib',
    badge: 'border-warning/25 bg-warning/10 text-warning',
  },
  review: {
    label: 'Yoxlanmalıdır',
    badge: 'border-destructive/25 bg-destructive/10 text-destructive',
  },
  off: {
    label: 'Söndürülüb',
    badge: 'bg-muted text-muted-foreground',
  },
}

const STATE_FILTERS: Array<{ key: StateFilter; label: string }> = [
  { key: 'all', label: 'Hamısı' },
  { key: 'active', label: 'Aktiv' },
  { key: 'degraded', label: 'Zəifləyib' },
  { key: 'trial', label: 'Sınaqda' },
  { key: 'review', label: 'Yoxlanmalıdır' },
  { key: 'off', label: 'Söndürülüb' },
]

function formatMethod(value: string | null) {
  if (!value) return '—'
  return METHOD_LABELS[value] || value
}

function formatDate(value: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'

  return new Intl.DateTimeFormat('az-AZ', {
    timeZone: 'Asia/Baku',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .format(date)
    .replace(',', '')
}

function hoursSince(value: string | null, now: number) {
  if (!value) return null
  const time = new Date(value).getTime()
  if (Number.isNaN(time)) return null
  return (now - time) / 3_600_000
}

function formatHours(hours: number) {
  if (hours < 48) return `${Math.round(hours)} saat`
  return `${Math.round(hours / 24)} gün`
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

function normalizeUrl(value: string) {
  const raw = value.trim()
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

function isValidHost(host: string) {
  const parts = host.split('.')
  if (parts.length < 2) return false
  if (PROTECTED_PARENT_DOMAINS.has(host)) return false
  if (parts.some((part) => !part || part.length > 63 || part.includes('_')))
    return false
  if (!/^[a-z]{2,24}$/.test(parts[parts.length - 1])) return false
  return /^[a-z0-9.-]+$/.test(host)
}

function trialNotes(notes: string | null, extra = '') {
  const base = (notes || '').replace(TRIAL_TAG_WITH_SPACE, '').trim()
  const tag = `[trial passes=0 fails=0 since=${new Date().toISOString()}]`
  return [base, extra, tag].filter(Boolean).join(' ')
}

function shortReason(reason: string) {
  return reason.split(/[;\n]/)[0].trim().slice(0, 140)
}

function sourceTitle(source: Source) {
  return (
    getHostname(source.base_url) ||
    getHostname(source.latest_url) ||
    source.name ||
    '—'
  )
}

function text(value: unknown) {
  return value === null || value === undefined ? '' : String(value).trim()
}

function nullableText(value: unknown) {
  return text(value) || null
}

function toSource(row: Record<string, unknown>, index: number): Source {
  const base = text(row.base_url)
  return {
    id: text(row.id) || `missing-${index}`,
    name: text(row.name) || getHostname(base) || `Mənbə ${index + 1}`,
    base_url: base,
    latest_url: nullableText(row.latest_url),
    rss_url: nullableText(row.rss_url),
    status: nullableText(row.status) || 'inactive',
    monitor_method: nullableText(row.monitor_method),
    selector: nullableText(row.selector),
    article_pattern: nullableText(row.article_pattern),
    discovery_status: nullableText(row.discovery_status),
    last_checked_at: nullableText(row.last_checked_at),
    last_article_found_at: nullableText(row.last_article_found_at),
    last_error: nullableText(row.last_error),
    consecutive_fail_count:
      typeof row.consecutive_fail_count === 'number'
        ? row.consecutive_fail_count
        : 0,
    notes: nullableText(row.notes),
  }
}

function getSourceState(
  source: Source,
  now: number
): { state: SourceState; reason: string } {
  const notes = source.notes || ''
  const trial = TRIAL_TAG.exec(notes)
  const fails = source.consecutive_fail_count || 0

  if (source.status !== 'active') {
    if (trial) {
      return {
        state: 'trial',
        reason: `${trial[1]} uğurlu, ${trial[2]} uğursuz yoxlama. Telegram-a göndərilmir.`,
      }
    }
    if (
      source.discovery_status === 'needs_review' ||
      source.discovery_status === 'manual_needed'
    ) {
      const reason =
        source.last_error || notes.replace(TRIAL_TAG_WITH_SPACE, '')
      return { state: 'review', reason: reason.slice(0, 160) }
    }
    return { state: 'off', reason: '' }
  }

  if (fails >= FAIL_LIMIT) {
    return {
      state: 'degraded',
      reason: `${fails} dəfə ardıcıl xəta${source.last_error ? `: ${source.last_error.slice(0, 120)}` : ''}`,
    }
  }

  const silent = hoursSince(source.last_article_found_at, now)
  if (silent !== null && silent > SILENT_HOURS) {
    return {
      state: 'degraded',
      reason: `${formatHours(silent)}dir yeni xəbər tapılmayıb`,
    }
  }

  return { state: 'active', reason: '' }
}

function SourcesPage() {
  const [sources, setSources] = useState<Source[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<StateFilter>('all')
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<Source | null>(null)
  const [addInput, setAddInput] = useState('')
  const [adding, setAdding] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  async function loadSources() {
    setLoading(true)
    const { data, error } = await supabase
      .from('sources')
      .select(SOURCE_COLUMNS)
      .order('name', { ascending: true })

    if (error) {
      setMessage(`Mənbələr oxunmadı: ${error.message}`)
      setSources([])
    } else {
      setSources(
        (data || []).map((row, index) =>
          toSource(row as Record<string, unknown>, index)
        )
      )
      setNow(Date.now())
    }
    setLoading(false)
  }

  useEffect(() => {
    void loadSources()
  }, [])

  const rows = useMemo(
    () =>
      sources.map((source) => ({
        source,
        ...getSourceState(source, now),
      })),
    [sources, now]
  )

  const counts = useMemo(() => {
    const result: Record<StateFilter, number> = {
      all: rows.length,
      active: 0,
      degraded: 0,
      trial: 0,
      review: 0,
      off: 0,
    }
    for (const row of rows) result[row.state] += 1
    return result
  }, [rows])

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return rows.filter((row) => {
      if (filter !== 'all' && row.state !== filter) return false
      if (!q) return true
      return [row.source.name, row.source.base_url, row.source.rss_url]
        .join(' ')
        .toLowerCase()
        .includes(q)
    })
  }, [rows, filter, search])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const visible = filtered.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  )

  async function toggleSource(source: Source) {
    setBusyId(source.id)
    const turningOn = source.status !== 'active'
    const patch = turningOn
      ? {
          status: 'active',
          discovery_status: 'accepted',
          consecutive_fail_count: 0,
          notes: (source.notes || '').replace(TRIAL_TAG_WITH_SPACE, '') || null,
        }
      : { status: 'inactive' }

    const { error } = await supabase
      .from('sources')
      .update(patch)
      .eq('id', source.id)

    setBusyId(null)
    if (error) {
      setMessage(`Status dəyişmədi: ${error.message}`)
      return
    }
    setMessage('')
    await loadSources()
  }

  async function checkNow(source: Source) {
    setBusyId(source.id)
    setMessage(`${sourceTitle(source)} yoxlanır...`)
    const { data, error } = await supabase.functions.invoke<RepairResponse>(
      'source-repair',
      { body: { source } }
    )
    setBusyId(null)

    if (error || !data) {
      setMessage(
        `${sourceTitle(source)}: yoxlama cavab vermədi (${error?.message || 'boş cavab'}).`
      )
      return
    }
    if (data.ok) {
      setMessage(
        `${sourceTitle(source)} oxuna bilir: ${formatMethod(data.method)}, ${data.candidateCount} link tapıldı. Heç nə dəyişdirilmədi.`
      )
      return
    }

    // The check runs from Supabase Edge, which many sites block. That says
    // nothing about the Railway bot, so the bot gets the final word.
    const reason = shortReason(data.reason)
    if (source.status === 'active' || TRIAL_TAG.test(source.notes || '')) {
      setMessage(
        `${sourceTitle(source)}: Edge oxuya bilmədi (${reason}). Bu, botun oxuya bilmədiyi demək deyil; sayt aktivdirsə və xəbər gəlirsə, problem yoxdur.`
      )
      return
    }

    const { error: trialError } = await supabase
      .from('sources')
      .update({
        status: 'inactive',
        discovery_status: 'accepted',
        consecutive_fail_count: 0,
        notes: trialNotes(source.notes),
      })
      .eq('id', source.id)
    setMessage(
      trialError
        ? `${sourceTitle(source)}: sınağa qoyulmadı (${trialError.message})`
        : `${sourceTitle(source)}: Edge oxuya bilmədi (${reason}). Sınağa qoyuldu, Railway botu gizli yoxlayıb özü qərar verəcək.`
    )
    await loadSources()
  }

  async function deleteSource(source: Source) {
    const ok = window.confirm(
      `"${sourceTitle(source)}" mənbəsini silmək istəyirsən? Bu əməliyyat geri qaytarılmır.`
    )
    if (!ok) return

    const { error } = await supabase
      .from('sources')
      .delete()
      .eq('id', source.id)
    if (error) {
      setMessage(`Silinmədi: ${error.message}`)
      return
    }
    await loadSources()
  }

  async function saveEdit() {
    if (!editing) return
    const { error } = await supabase
      .from('sources')
      .update({
        name: editing.name.trim() || sourceTitle(editing),
        base_url: editing.base_url,
        latest_url: editing.latest_url || null,
        rss_url: editing.rss_url || null,
        monitor_method: editing.monitor_method || 'latest_page',
        selector: editing.selector || null,
        article_pattern: editing.article_pattern || null,
      })
      .eq('id', editing.id)

    if (error) {
      setMessage(`Yadda saxlanmadı: ${error.message}`)
      return
    }
    setEditing(null)
    await loadSources()
  }

  // A new source never goes live directly: it starts as a trial and the
  // worker promotes it after clean reads (see apps/worker/rss/source_lifecycle.py).
  async function addOne(
    url: string,
    host: string,
    known: Set<string>
  ): Promise<string> {
    if (known.has(host)) return `${host}: artıq siyahıdadır`

    const draft = {
      name: host,
      base_url: url,
      latest_url: url,
      rss_url: null,
      status: 'inactive',
      monitor_method: 'latest_page',
      selector: null,
      article_pattern: null,
    }

    const { data, error } = await supabase.functions.invoke<RepairResponse>(
      'source-repair',
      { body: { source: { id: `new-${host}`, ...draft } } }
    )

    // No site is dropped because the Edge check failed; the bot decides.
    const repair: RepairResponse = data ?? {
      ok: false,
      method: 'latest_page',
      reason: error?.message || 'boş cavab',
      candidateCount: 0,
      update: {},
    }

    const update = repair.update || {}
    const stamp = new Date().toISOString()
    const { error: insertError } = await supabase.from('sources').insert({
      name: host,
      base_url: url,
      latest_url: String(repair.finalUrl || url),
      rss_url: typeof update.rss_url === 'string' ? update.rss_url : null,
      source_type: 'news_site',
      status: 'inactive',
      trust_level: 'medium',
      monitor_method: repair.ok ? repair.method : 'latest_page',
      selector: typeof update.selector === 'string' ? update.selector : null,
      article_pattern:
        typeof update.article_pattern === 'string'
          ? update.article_pattern
          : null,
      discovery_status: 'accepted',
      last_checked_at: stamp,
      last_error: null,
      last_result: 'source_added',
      consecutive_fail_count: 0,
      last_discovered_at: stamp,
      notes: trialNotes(
        null,
        repair.ok
          ? `[manual_add] ${repair.method}, ${repair.candidateCount} link.`
          : `[manual_add] Edge oxuya bilmədi: ${shortReason(repair.reason)}`
      ),
    })

    if (insertError) return `${host}: yazılmadı (${insertError.message})`
    known.add(host)
    return repair.ok
      ? `${host}: sınaqa qoyuldu (${formatMethod(repair.method)}). Bot gizli oxuyub avtomatik aktivləşdirəcək.`
      : `${host}: Edge oxuya bilmədi (${shortReason(repair.reason)}). Yenə də sınaqa qoyuldu, Railway botu yoxlayacaq.`
  }

  async function addSources() {
    const known = new Set(
      sources.map((s) => getHostname(s.base_url) || getHostname(s.latest_url))
    )
    const seen = new Set<string>()
    const targets: Array<{ url: string; host: string }> = []
    let invalid = 0

    for (const piece of addInput.split(/[\n,;\s]+/)) {
      if (!piece.trim()) continue
      const url = normalizeUrl(piece)
      const host = getHostname(url)
      if (!url || !host || !isValidHost(host)) {
        invalid += 1
        continue
      }
      if (seen.has(host)) continue
      seen.add(host)
      targets.push({ url, host })
    }

    if (targets.length === 0) {
      setMessage('Düzgün domen tapılmadı.')
      return
    }
    if (targets.length > MAX_BULK_ADD) {
      setMessage(`Bir dəfəyə ən çox ${MAX_BULK_ADD} mənbə əlavə et.`)
      return
    }

    setAdding(true)
    const results: string[] = []
    for (const target of targets) {
      setMessage(`${target.host} analiz olunur...`)
      results.push(await addOne(target.url, target.host, known))
    }
    setAdding(false)
    setAddInput('')
    setMessage(
      results.join('\n') + (invalid ? `\n${invalid} yanlış sətir atlandı.` : '')
    )
    await loadSources()
  }

  return (
    <div className='space-y-4 p-4'>
      <div>
        <h1 className='text-2xl font-bold'>Mənbələr</h1>
        <p className='text-sm text-muted-foreground'>
          Yeni sayt əvvəlcə sınaqda gizli oxunur, təmiz oxunuşdan sonra bot onu
          özü aktivləşdirir. Zəifləyən mənbələr avtomatik görünür.
        </p>
      </div>

      <section className='space-y-2 rounded-xl border bg-card p-4'>
        <h2 className='text-base font-semibold'>Yeni mənbə</h2>
        <textarea
          value={addInput}
          onChange={(event) => setAddInput(event.target.value)}
          placeholder={
            'Domen və ya URL, hər sətirdə biri:\napa.az\nhttps://report.az'
          }
          rows={3}
          className='w-full resize-y rounded-lg border bg-background px-3 py-2 text-sm'
        />
        <button
          type='button'
          disabled={adding || !addInput.trim()}
          onClick={() => void addSources()}
          className='rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50'
        >
          {adding ? 'Analiz olunur...' : 'Sınağa əlavə et'}
        </button>
      </section>

      {message ? (
        <div className='whitespace-pre-line rounded-lg border bg-muted/50 p-3 text-sm'>
          {message}
        </div>
      ) : null}

      <div className='flex flex-wrap items-center gap-2'>
        {STATE_FILTERS.map((item) => (
          <button
            key={item.key}
            type='button'
            onClick={() => {
              setFilter(item.key)
              setPage(1)
            }}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              filter === item.key
                ? 'border-primary bg-primary text-primary-foreground'
                : 'bg-background text-muted-foreground'
            }`}
          >
            {item.label} ({counts[item.key]})
          </button>
        ))}
        <input
          value={search}
          onChange={(event) => {
            setSearch(event.target.value)
            setPage(1)
          }}
          placeholder='Axtar...'
          className='ml-auto w-full rounded-lg border bg-background px-3 py-2 text-sm sm:w-64'
        />
      </div>

      <ResponsiveTable label='Mənbələr'>
        <table className='w-full min-w-[860px] table-fixed text-sm'>
          <thead className='bg-muted/50'>
            <tr>
              <th className='w-[28%] p-3 text-left'>Mənbə</th>
              <th className='w-[32%] p-3 text-left'>Vəziyyət</th>
              <th className='w-36 p-3 text-left'>Üsul</th>
              <th className='w-36 p-3 text-left'>Son xəbər</th>
              <th className='w-44 p-3 text-right'>İş</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={5}
                  className='p-6 text-center text-muted-foreground'
                >
                  Yüklənir...
                </td>
              </tr>
            ) : visible.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className='p-6 text-center text-muted-foreground'
                >
                  Mənbə tapılmadı.
                </td>
              </tr>
            ) : (
              visible.map(({ source, state, reason }) => (
                <tr key={source.id} className='border-t align-top'>
                  <td className='p-3'>
                    <a
                      href={source.latest_url || source.base_url}
                      target='_blank'
                      rel='noreferrer'
                      className='break-all font-medium hover:underline'
                    >
                      {sourceTitle(source)}
                    </a>
                  </td>
                  <td className='p-3'>
                    <span
                      className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${STATE_META[state].badge}`}
                    >
                      {STATE_META[state].label}
                    </span>
                    {reason ? (
                      <div className='mt-1 line-clamp-2 text-xs text-muted-foreground'>
                        {reason}
                      </div>
                    ) : null}
                  </td>
                  <td className='p-3'>{formatMethod(source.monitor_method)}</td>
                  <td className='p-3'>
                    {formatDate(source.last_article_found_at)}
                  </td>
                  <td className='p-3 text-right'>
                    <div className='flex flex-wrap justify-end gap-1'>
                      <button
                        type='button'
                        disabled={busyId === source.id}
                        onClick={() => void checkNow(source)}
                        className='rounded-md border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50'
                      >
                        Yoxla
                      </button>
                      <button
                        type='button'
                        disabled={busyId === source.id}
                        onClick={() => void toggleSource(source)}
                        className='rounded-md border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50'
                      >
                        {source.status === 'active' ? 'Söndür' : 'Aktiv et'}
                      </button>
                      <button
                        type='button'
                        onClick={() => setEditing(source)}
                        className='rounded-md border px-2 py-1 text-xs hover:bg-muted'
                      >
                        Redaktə
                      </button>
                      <button
                        type='button'
                        onClick={() => void deleteSource(source)}
                        className='rounded-md border border-destructive/25 px-2 py-1 text-xs text-destructive hover:bg-destructive/10'
                      >
                        Sil
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </ResponsiveTable>

      {pageCount > 1 ? (
        <div className='flex items-center justify-between text-sm'>
          <button
            type='button'
            disabled={currentPage <= 1}
            onClick={() => setPage(currentPage - 1)}
            className='rounded-md border px-3 py-1 disabled:opacity-50'
          >
            Əvvəlki
          </button>
          <span className='text-muted-foreground'>
            {currentPage} / {pageCount}
          </span>
          <button
            type='button'
            disabled={currentPage >= pageCount}
            onClick={() => setPage(currentPage + 1)}
            className='rounded-md border px-3 py-1 disabled:opacity-50'
          >
            Növbəti
          </button>
        </div>
      ) : null}

      {editing ? (
        <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4'>
          <div className='max-h-[90vh] w-full max-w-2xl space-y-4 overflow-auto rounded-xl border bg-background p-5'>
            <div className='flex items-start justify-between gap-3'>
              <h2 className='text-xl font-bold'>Mənbəni redaktə et</h2>
              <a
                href={`/admin/monitor/picker?sourceId=${encodeURIComponent(editing.id)}`}
                target='_blank'
                rel='noreferrer'
                className='rounded-md border px-3 py-1 text-xs hover:bg-muted'
              >
                Selector seç
              </a>
            </div>

            <div className='grid gap-3 md:grid-cols-2'>
              <label className='grid gap-1 text-sm'>
                <span className='font-medium'>Ad</span>
                <input
                  value={editing.name}
                  onChange={(e) =>
                    setEditing({ ...editing, name: e.target.value })
                  }
                  className='rounded-lg border bg-background px-3 py-2'
                />
              </label>
              <label className='grid gap-1 text-sm'>
                <span className='font-medium'>Sayt (base URL)</span>
                <input
                  value={editing.base_url}
                  onChange={(e) =>
                    setEditing({ ...editing, base_url: e.target.value })
                  }
                  className='rounded-lg border bg-background px-3 py-2'
                />
              </label>
              <label className='grid gap-1 text-sm'>
                <span className='font-medium'>Son xəbərlər səhifəsi</span>
                <input
                  value={editing.latest_url || ''}
                  onChange={(e) =>
                    setEditing({ ...editing, latest_url: e.target.value })
                  }
                  className='rounded-lg border bg-background px-3 py-2'
                />
              </label>
              <label className='grid gap-1 text-sm'>
                <span className='font-medium'>RSS</span>
                <input
                  value={editing.rss_url || ''}
                  onChange={(e) =>
                    setEditing({ ...editing, rss_url: e.target.value })
                  }
                  className='rounded-lg border bg-background px-3 py-2'
                />
              </label>
              <label className='grid gap-1 text-sm'>
                <span className='font-medium'>Oxuma üsulu</span>
                <select
                  value={editing.monitor_method || 'latest_page'}
                  onChange={(e) =>
                    setEditing({ ...editing, monitor_method: e.target.value })
                  }
                  className='rounded-lg border bg-background px-3 py-2'
                >
                  {EDITABLE_METHODS.map((method) => (
                    <option key={method} value={method}>
                      {formatMethod(method)}
                    </option>
                  ))}
                </select>
              </label>
              <label className='grid gap-1 text-sm'>
                <span className='font-medium'>CSS selector</span>
                <input
                  value={editing.selector || ''}
                  onChange={(e) =>
                    setEditing({ ...editing, selector: e.target.value })
                  }
                  className='rounded-lg border bg-background px-3 py-2'
                />
              </label>
            </div>

            <label className='grid gap-1 text-sm'>
              <span className='font-medium'>Article pattern / XPath</span>
              <textarea
                value={editing.article_pattern || ''}
                onChange={(e) =>
                  setEditing({ ...editing, article_pattern: e.target.value })
                }
                rows={3}
                className='rounded-lg border bg-background px-3 py-2'
              />
            </label>

            <div className='flex justify-end gap-2'>
              <button
                type='button'
                onClick={() => setEditing(null)}
                className='rounded-lg border px-4 py-2 text-sm hover:bg-muted'
              >
                Bağla
              </button>
              <button
                type='button'
                onClick={() => void saveEdit()}
                className='rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground'
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
