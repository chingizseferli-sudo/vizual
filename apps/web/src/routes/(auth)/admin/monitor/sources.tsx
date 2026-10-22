import { useEffect, useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Pencil, Power, RefreshCw, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { ResponsiveTable } from '@/components/ui/responsive-table'
import { friendlyError } from '@/lib/friendly-error'

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

const ACTION_BUTTON =
  'inline-flex size-8 shrink-0 items-center justify-center rounded-md border hover:bg-muted disabled:opacity-50'
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

const REASON_LABELS: Record<string, string> = {
  no_date: 'xəbərin tarixi oxunmur',
  date_parse_failed: 'tarix oxuna bilmir',
  bad_title: 'başlıq rədd edilir',
  rss_empty: 'RSS boşdur',
  selector_empty: 'selector link tapmır',
  xpath_empty: 'XPath link tapmır',
  sitemap_empty: 'sitemap boşdur',
  latest_page_empty: 'xəbər siyahısı boşdur',
  homepage_empty: 'ana səhifədə link tapılmadı',
  fallback_empty: 'heç bir üsulla link tapılmadı',
  invalid_xml: 'RSS səhv formatdadır',
  http_403: 'sayt botu bloklayır (403)',
  http_404: 'ünvan tapılmadı (404)',
  http_429: 'çox sorğu limiti (429)',
  timeout: 'sayt cavab vermir',
  dns_failure: 'domen açılmır',
  ssl_failure: 'SSL xətası',
}

function reasonLabel(reason: string | null) {
  if (!reason) return ''
  return REASON_LABELS[reason] || reason.slice(0, 120)
}

function shortReason(reason: string) {
  return reason.split(/[;\n]/)[0].trim().slice(0, 140)
}

const TELEGRAM_SENT = /\[telegram_success\]\s*sent_at=(\S+)/

function lastTelegramAt(notes: string | null) {
  return TELEGRAM_SENT.exec(notes || '')?.[1] ?? null
}

const STATE_ORDER: Record<SourceState, number> = {
  review: 0,
  degraded: 1,
  trial: 2,
  active: 3,
  off: 4,
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
      reason: `${fails} dəfə ardıcıl${source.last_error ? `: ${reasonLabel(source.last_error)}` : ' xəta'}`,
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
      .or('status.is.null,status.neq.social')
      .order('name', { ascending: true })

    if (error) {
      setMessage(`Mənbələr oxunmadı: ${friendlyError(error)}`)
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
      sources
        .map((source) => ({
          source,
          ...getSourceState(source, now),
        }))
        .sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state]),
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
      setMessage(`Status dəyişmədi: ${friendlyError(error)}`)
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
    const bot = getSourceState(source, now)
    const botNote =
      bot.state === 'degraded' ? ` Botun gördüyü: ${bot.reason}` : ''

    if (error || !data) {
      setMessage(
        `${sourceTitle(source)}: yoxlama cavab vermədi (${(error ? friendlyError(error) : 'boş cavab')}).`
      )
      return
    }
    if (data.ok) {
      const fixable = bot.state === 'degraded' || bot.state === 'review'
      const found = {
        monitor_method: nullableText(data.update?.monitor_method),
        latest_url: nullableText(data.update?.latest_url),
        rss_url: nullableText(data.update?.rss_url),
        selector: nullableText(data.update?.selector),
        article_pattern: nullableText(data.update?.article_pattern),
      }
      const changed =
        found.monitor_method !== source.monitor_method ||
        found.latest_url !== source.latest_url ||
        found.rss_url !== source.rss_url ||
        found.selector !== source.selector
      if (fixable && found.monitor_method && changed) {
        const { error: fixError } = await supabase
          .from('sources')
          .update({
            ...found,
            consecutive_fail_count: 0,
            last_error: null,
            ...(bot.state === 'review'
              ? {
                  status: 'inactive',
                  discovery_status: 'accepted',
                  notes: trialNotes(source.notes),
                }
              : {}),
          })
          .eq('id', source.id)
        setMessage(
          fixError
            ? `${sourceTitle(source)}: düzgün üsul tapıldı, amma saxlanmadı (${friendlyError(fixError)})`
            : `${sourceTitle(source)}: düzgün üsul tapıldı və saxlandı: ${formatMethod(found.monitor_method)}, ${data.candidateCount} link.${bot.state === 'review' ? ' Sınağa qoyuldu.' : ''}`
        )
        await loadSources()
        return
      }
      setMessage(
        `${sourceTitle(source)} oxuna bilir: ${formatMethod(data.method)}, ${data.candidateCount} link tapıldı. Heç nə dəyişdirilmədi.${botNote}`
      )
      return
    }

    // The check runs from Supabase Edge, which many sites block. That says
    // nothing about the Railway bot, so the bot gets the final word.
    const reason = shortReason(data.reason)
    if (source.status === 'active' || TRIAL_TAG.test(source.notes || '')) {
      setMessage(
        `${sourceTitle(source)}: Edge oxuya bilmədi (${reason}). Bu, botun oxuya bilmədiyi demək deyil; sayt aktivdirsə və xəbər gəlirsə, problem yoxdur.${botNote}`
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
        ? `${sourceTitle(source)}: sınağa qoyulmadı (${friendlyError(trialError)})`
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
      setMessage(`Silinmədi: ${friendlyError(error)}`)
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
        consecutive_fail_count: 0,
        last_error: null,
      })
      .eq('id', editing.id)

    if (error) {
      setMessage(`Yadda saxlanmadı: ${friendlyError(error)}`)
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
      reason: (error ? friendlyError(error) : 'boş cavab'),
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

    if (insertError) return `${host}: yazılmadı (${friendlyError(insertError)})`
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
        <div className='rounded-lg border bg-muted/50 p-3 text-sm whitespace-pre-line'>
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
          <thead className='bg-muted'>
            <tr>
              <th className='w-[28%] p-3 text-left'>Mənbə</th>
              <th className='w-[32%] p-3 text-left'>Vəziyyət</th>
              <th className='w-36 p-3 text-left'>Üsul</th>
              <th className='w-48 p-3 text-left'>Fəaliyyət</th>
              <th className='w-52 bg-muted p-3 text-right md:sticky md:right-0'>
                İş
              </th>
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
                      className='font-medium break-all hover:underline'
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
                  <td className='space-y-0.5 p-3 text-xs'>
                    <div>
                      <span className='text-muted-foreground'>Oxundu: </span>
                      {formatDate(source.last_checked_at)}
                    </div>
                    <div>
                      <span className='text-muted-foreground'>Xəbər: </span>
                      {formatDate(source.last_article_found_at)}
                    </div>
                    <div>
                      <span className='text-muted-foreground'>Bildiriş: </span>
                      {formatDate(lastTelegramAt(source.notes))}
                    </div>
                  </td>
                  <td className='bg-card p-3 text-right md:sticky md:right-0 md:shadow-[-8px_0_8px_-8px_rgb(0_0_0/0.15)]'>
                    <div className='flex justify-end gap-1'>
                      <button
                        type='button'
                        title='Sürətli yoxla (Supabase-dən; botun həqiqi oxuması deyil)'
                        aria-label='Sürətli yoxla'
                        disabled={busyId === source.id}
                        onClick={() => void checkNow(source)}
                        className={ACTION_BUTTON}
                      >
                        <RefreshCw className='size-4' />
                      </button>
                      <button
                        type='button'
                        title={
                          source.status === 'active' ? 'Söndür' : 'Aktiv et'
                        }
                        aria-label={
                          source.status === 'active' ? 'Söndür' : 'Aktiv et'
                        }
                        disabled={busyId === source.id}
                        onClick={() => void toggleSource(source)}
                        className={`${ACTION_BUTTON} ${source.status === 'active' ? '' : 'text-success'}`}
                      >
                        <Power className='size-4' />
                      </button>
                      <button
                        type='button'
                        title='Redaktə'
                        aria-label='Redaktə'
                        onClick={() => setEditing(source)}
                        className={ACTION_BUTTON}
                      >
                        <Pencil className='size-4' />
                      </button>
                      <button
                        type='button'
                        title='Sil'
                        aria-label='Sil'
                        onClick={() => void deleteSource(source)}
                        className={`${ACTION_BUTTON} border-destructive/25 text-destructive hover:bg-destructive/10`}
                      >
                        <Trash2 className='size-4' />
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
            <h2 className='text-xl font-bold'>Mənbəni redaktə et</h2>

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
            </div>

            <details className='rounded-lg border p-3'>
              <summary className='cursor-pointer text-sm font-medium'>
                Texniki ayarlar
              </summary>
              <p className='mt-2 text-xs text-muted-foreground'>
                Adətən lazım deyil: bot işləyən üsulu özü tapıb saxlayır.
                Selector pəncərəsi saytı Supabase-dən açır; sayt onu bloklayırsa
                açılmaya bilər.
              </p>
              <div className='mt-3 grid gap-3 md:grid-cols-2'>
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
              <div className='mt-3 grid gap-3'>
                <label className='grid gap-1 text-sm'>
                  <span className='font-medium'>Article pattern / XPath</span>
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
                <div>
                  <a
                    href={`/admin/monitor/picker?sourceId=${encodeURIComponent(editing.id)}`}
                    target='_blank'
                    rel='noreferrer'
                    className='inline-block rounded-md border px-3 py-1 text-xs hover:bg-muted'
                  >
                    Selector seç
                  </a>
                </div>
              </div>
            </details>

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
