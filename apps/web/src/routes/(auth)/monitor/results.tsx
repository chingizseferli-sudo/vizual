import { useEffect, useMemo, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import {
  ChevronDown,
  Download,
  ExternalLink,
  FileCode2,
  FileJson2,
  FileSpreadsheet,
  FileText,
  Loader2,
  Printer,
  Search,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  fetchResultFilters,
  fetchResultsPage,
  RESULTS_PAGE_SIZE,
  type ResultRow,
  type ResultsQuery,
  type ResultsSort,
} from '@/features/results/data'
import { customerQueryKeys } from '@/lib/query-keys'
import { dateLocale, t } from '@/lib/i18n'
import { type NewsLanguage } from '@/lib/news-language'
import { buildXlsx } from '@/lib/xlsx'
import iconSvg from '../../../../public/images/vizual-icon.svg?raw'

// The export is one offline file, so the logo is embedded instead of linked.
const VIZUAL_ICON_URI = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(iconSvg)}`

// Export downloads up to this many results (the server caps it too).
const EXPORT_LIMIT = 5000
const SEARCH_DEBOUNCE_MS = 300
const ALL = 'all'

type FilterOption = {
  value: string
  label: string
}

type ExportRange = '1' | '7' | '30' | 'all'

type SourceCategory = 'web' | 'social'
const SOCIAL_NETWORKS = ['facebook', 'instagram', 'youtube', 'x', 'linkedin', 'telegram'] as const
type SocialNetwork = (typeof SOCIAL_NETWORKS)[number]

function isSocialNetwork(value: unknown): value is SocialNetwork {
  return SOCIAL_NETWORKS.includes(value as SocialNetwork)
}

type ResultsSearch = {
  cat?: SourceCategory
  sites?: string
  net?: SocialNetwork
}

const socialNetworkLabels: Record<SocialNetwork, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  youtube: 'YouTube',
  x: 'X',
  linkedin: 'LinkedIn',
  telegram: 'Telegram',
}

// A plain validator keeps zod out of the entry bundle.
function validateResultsSearch(search: Record<string, unknown>): ResultsSearch {
  const next: ResultsSearch = {}
  if (search.cat === 'web' || search.cat === 'social') next.cat = search.cat
  if (next.cat === 'web' && typeof search.sites === 'string' && search.sites) {
    next.sites = search.sites
  }
  if (next.cat === 'social' && isSocialNetwork(search.net)) next.net = search.net
  return next
}

const exportRangeLabels: Record<ExportRange, string> = {
  '1': t("Son 1 gün"),
  '7': t("Son 7 gün"),
  '30': t("Son 30 gün"),
  all: t("Bütün nəticələr"),
}

function decodeHtml(text: string) {
  const textarea = document.createElement('textarea')
  textarea.innerHTML = text
  return textarea.value
}

function formatDate(value: string | null) {
  if (!value) return '-'

  return new Date(value).toLocaleString(dateLocale(), {
    timeZone: 'Asia/Baku',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function getHost(url: string | undefined) {
  if (!url) return '-'

  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function csvCell(value: string | number | null | undefined) {
  const text = String(value ?? '').replace(/"/g, '""')
  return `"${text}"`
}

function downloadFile(filename: string, content: string | Blob, type: string) {
  const blob = content instanceof Blob ? content : new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function downloadCsv(
  filename: string,
  rows: Array<Array<string | number | null | undefined>>
) {
  const csv = rows.map((row) => row.map(csvCell).join(',')).join('\n')
  downloadFile(filename, `\ufeff${csv}`, 'text/csv;charset=utf-8')
}

function escapeHtml(value: string | null | undefined) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function mapExportRow(row: ResultRow) {
  return {
    keyword: row.matched_keyword || '-',
    title: row.title ? decodeHtml(row.title) : t("Xəbər tapılmadı"),
    source: getHost(row.url ?? undefined),
    url: row.url || '',
    published_at: formatDate(row.published_at),
    detected_at: formatDate(row.detected_at || row.created_at),
    author: row.author || '',
    likes: row.like_count ?? null,
    comments: row.comment_count ?? null,
    shares: row.share_count ?? null,
    views: row.view_count ?? null,
    engagement: row.network ? (row.engagement ?? null) : null,
  }
}

type ExportFormat = 'csv' | 'xlsx' | 'pdf' | 'json' | 'html'

function formatCount(value: number) {
  return new Intl.NumberFormat(dateLocale()).format(value)
}

function EngagementBadges({ row }: { row: ResultRow }) {
  const parts = [
    { value: row.like_count, label: t("bəyənmə") },
    { value: row.comment_count, label: t("şərh") },
    { value: row.share_count, label: t("paylaşım") },
    { value: row.view_count, label: t("baxış") },
  ].filter((part): part is { value: number; label: string } => part.value != null)
  if (!row.author && parts.length === 0) return null
  return (
    <div className='mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground'>
      {row.author ? <span className='font-semibold text-foreground/80'>{row.author}</span> : null}
      {parts.map((part) => (
        <span key={part.label}>
          {formatCount(part.value)} {part.label}
        </span>
      ))}
    </div>
  )
}

function Pagination({
  page,
  totalPages,
  totalItems,
  onPageChange,
  compact = false,
}: {
  page: number
  totalPages: number
  totalItems: number
  onPageChange: (page: number) => void
  compact?: boolean
}) {
  if (totalItems === 0) return null

  if (compact) {
    return (
      <div className='flex items-center gap-3'>
        <button
          type='button'
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1}
          className='rounded-lg border border-border bg-card px-3 py-2 text-sm font-bold hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50'
        >{t("Əvvəlki")}</button>
        <span className='text-sm font-semibold text-foreground'>
          {page} / {totalPages}
        </span>
        <button
          type='button'
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
          className='rounded-lg border border-border bg-card px-3 py-2 text-sm font-bold hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50'
        >{t("Növbəti")}</button>
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-3 rounded-2xl border border-border bg-card p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between'>
      <div className='text-sm text-muted-foreground'>
        {totalItems}{' '}{t("nəticə | səhifə")}{' '}{page} / {totalPages}
      </div>

      <div className='flex gap-2'>
        <button
          type='button'
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1}
          className='rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50'
        >{t("Əvvəlki")}</button>
        <button
          type='button'
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages}
          className='rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50'
        >{t("Növbəti")}</button>
      </div>
    </div>
  )
}

const exportRangeDays: Record<ExportRange, number> = { '1': 1, '7': 7, '30': 30, all: 31 }

function useDebouncedValue<T>(value: T, delayMs: number) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs)
    return () => window.clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}

function ResultsPage() {
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search, SEARCH_DEBOUNCE_MS)
  const [keywordFilter, setKeywordFilter] = useState(ALL)
  const [languageFilter, setLanguageFilter] = useState<NewsLanguage | typeof ALL>(ALL)
  const sourceSearch = Route.useSearch()
  const navigate = Route.useNavigate()
  const sourceCategory = sourceSearch.cat
  const selectedSites = useMemo(
    () => (sourceSearch.sites ? sourceSearch.sites.split(',') : []),
    [sourceSearch.sites]
  )
  const socialNetwork = sourceSearch.net
  const [siteQuery, setSiteQuery] = useState('')
  const [dateFilter, setDateFilter] = useState('')
  const [exportRange, setExportRange] = useState<ExportRange>('1')
  const [sort, setSort] = useState<ResultsSort>('new')
  const [page, setPage] = useState(1)
  const [isExporting, setIsExporting] = useState(false)

  useEffect(() => {
    setPage(1)
  }, [
    debouncedSearch,
    keywordFilter,
    languageFilter,
    sourceCategory,
    selectedSites,
    socialNetwork,
    dateFilter,
    exportRange,
    sort,
  ])

  const filterQuery = useMemo<Omit<ResultsQuery, 'limit' | 'offset'>>(
    () => ({
      days: exportRangeDays[exportRange],
      category: sourceCategory,
      sites: sourceCategory === 'web' ? selectedSites : [],
      network: sourceCategory === 'social' ? socialNetwork : undefined,
      keyword: keywordFilter === ALL ? undefined : keywordFilter,
      language: languageFilter === ALL ? undefined : languageFilter,
      search: debouncedSearch,
      date: dateFilter || undefined,
      sort,
    }),
    [
      sort,
      exportRange,
      sourceCategory,
      selectedSites,
      socialNetwork,
      keywordFilter,
      languageFilter,
      debouncedSearch,
      dateFilter,
    ]
  )

  const { data, isLoading, isFetching } = useQuery({
    queryKey: customerQueryKeys.results({ ...filterQuery, page }),
    queryFn: () =>
      fetchResultsPage({
        ...filterQuery,
        limit: RESULTS_PAGE_SIZE,
        offset: (page - 1) * RESULTS_PAGE_SIZE,
      }),
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  })
  const { data: filters } = useQuery({
    queryKey: customerQueryKeys.resultFilters(filterQuery.days),
    queryFn: () => fetchResultFilters(filterQuery.days),
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
  })

  const errorMessage = data?.errorMessage || ''
  const totalItems = data?.total ?? 0
  const uniqueMedia = data?.media ?? 0
  const uniqueKeywords = data?.keywords ?? 0
  const paginatedRows = data?.rows ?? []
  const totalPages = Math.max(1, Math.ceil(totalItems / RESULTS_PAGE_SIZE))
  const safePage = Math.min(page, totalPages)

  const keywordOptions = useMemo<FilterOption[]>(
    () =>
      [...(filters?.keywords ?? [])]
        .sort((a, b) => a.localeCompare(b, 'az'))
        .map((value) => ({ value, label: value })),
    [filters?.keywords]
  )

  const siteOptions = useMemo<string[]>(
    () => [...(filters?.sites ?? [])].sort((a, b) => a.localeCompare(b, 'az')),
    [filters?.sites]
  )

  const networkOptions = useMemo<SocialNetwork[]>(() => {
    const values = new Set(filters?.networks ?? [])
    return SOCIAL_NETWORKS.filter((value) => values.has(value))
  }, [filters?.networks])

  const visibleSiteOptions = useMemo(() => {
    const q = siteQuery.toLocaleLowerCase('az-AZ').trim()
    return q ? siteOptions.filter((site) => site.includes(q)) : siteOptions
  }, [siteOptions, siteQuery])

  function setSourceSearch(next: ResultsSearch) {
    void navigate({ search: next, replace: true })
  }

  function toggleSite(site: string) {
    const next = selectedSites.includes(site)
      ? selectedSites.filter((value) => value !== site)
      : [...selectedSites, site]
    setSourceSearch({ cat: 'web', sites: next.join(',') || undefined })
  }

  function clearResultFilters() {
    setSearch('')
    setKeywordFilter(ALL)
    setLanguageFilter(ALL)
    setSourceSearch({})
    setDateFilter('')
  }

  async function exportResults(format: ExportFormat) {
    // The print window is opened now, while the click still counts as the user's:
    // a window opened after the download would be blocked as a popup.
    const printWindow = format === 'pdf' ? window.open('', '_blank') : null
    setIsExporting(true)
    const result = await fetchResultsPage({
      ...filterQuery,
      limit: EXPORT_LIMIT,
      offset: 0,
    }).finally(() => setIsExporting(false))
    if (result.errorMessage) {
      printWindow?.close()
      return
    }
    const mappedRows = result.rows.map(mapExportRow)
    const tableHeader = [
      t("Açar söz"),
      t("Başlıq"),
      t("Mənbə"),
      t("Link"),
      t("Dərc tarixi"),
      t("Tapılma vaxtı"),
      t("Müəllif"),
      t("Bəyənmə"),
      t("Şərh"),
      t("Paylaşım"),
      t("Baxış"),
    ]
    const tableBody = mappedRows.map((row) => [
      row.keyword,
      row.title,
      row.source,
      row.url,
      row.published_at,
      row.detected_at,
      row.author,
      row.likes,
      row.comments,
      row.shares,
      row.views,
    ])

    if (format === 'csv') {
      downloadCsv('tapilan-xeberler.csv', [tableHeader, ...tableBody])
      return
    }

    if (format === 'xlsx') {
      downloadFile(
        'tapilan-xeberler.xlsx',
        buildXlsx(t("Nəticələr"), [tableHeader, ...tableBody]),
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      )
      return
    }

    if (format === 'json') {
      downloadFile(
        'tapilan-xeberler.json',
        JSON.stringify(mappedRows, null, 2),
        'application/json;charset=utf-8'
      )
      return
    }

    const generatedAt = new Date().toLocaleString('az-AZ', {
      timeZone: 'Asia/Baku',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })

    const tableRows = mappedRows
      .map((row) => {
        const dateValue =
          row.published_at !== '-' ? row.published_at : row.detected_at
        const [datePart = '-', timePart = '-'] = dateValue
          .split(',')
          .map((part) => part.trim())

        return `
          <tr>
            <td>${escapeHtml(row.source)}</td>
            <td><a href="${escapeHtml(row.url)}" target="_blank" rel="noreferrer">${escapeHtml(row.title)}</a></td>
            <td><span class="keyword-pill">${escapeHtml(row.keyword)}</span></td>
            <td>${row.engagement != null ? escapeHtml(formatCount(row.engagement)) : '-'}</td>
            <td>
              <div class="date-cell">
                <strong>${escapeHtml(datePart)}</strong>
                <span>${escapeHtml(timePart)}</span>
              </div>
            </td>
          </tr>`
      })
      .join('')

    const tableSection =
      mappedRows.length > 0
        ? `<table>
          <thead>
            <tr>
              <th>Mənbə</th>
              <th>Başlıq</th>
              <th>Açar söz</th>
              <th>Engagement</th>
              <th>Dərc vaxtı</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>`
        : `<div class="empty">Seçilən interval üzrə ixrac ediləcək nəticə yoxdur.</div>`

    const reportHtml = `<!doctype html>
<html lang="az">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Vizual.Az · Media Monitorinq Hesabatı</title>
    <style>
      *{box-sizing:border-box}
      body{
        margin:0;
        color:#172033;
        background:#f5f8ff;
        font-family:"Segoe UI",Tahoma,Arial,sans-serif;
        -webkit-font-smoothing:antialiased;
        text-rendering:geometricPrecision;
      }
      .page{max-width:1180px;margin:0 auto;padding:34px}
      .hero{
        overflow:hidden;
        border-radius:22px;
        padding:28px;
        color:white;
        background:
          radial-gradient(circle at 18% 20%, rgba(255,255,255,.28), transparent 28%),
          linear-gradient(135deg,#1463ff 0%,#14b8a6 58%,#f59e0b 120%);
        box-shadow:0 24px 70px rgba(20,99,255,.2);
      }
      .brand{display:flex;align-items:center;gap:12px;margin-bottom:26px}
      .logo{display:block;width:52px;height:52px;border-radius:14px}
      .brand strong{font-size:20px}
      h1{margin:0;font-size:34px;line-height:1.05;letter-spacing:0}
      .hero p{max-width:760px;margin:12px 0 0;color:rgba(255,255,255,.88);font-size:16px;line-height:1.55}
      .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:22px}
      .stat{
        border:1px solid rgba(255,255,255,.22);
        border-radius:14px;
        padding:14px;
        background:rgba(255,255,255,.14);
      }
      .stat span{display:block;color:rgba(255,255,255,.78);font-size:12px;font-weight:800;text-transform:uppercase}
      .stat strong{display:block;margin-top:6px;font-size:24px}
      .table-wrap{
        margin-top:24px;
        overflow:hidden;
        border:1px solid #dce6f3;
        border-radius:18px;
        background:white;
        box-shadow:0 18px 50px rgba(40,55,85,.08);
      }
      table{width:100%;border-collapse:collapse}
      th,td{padding:14px 16px;text-align:left;vertical-align:top;border-bottom:1px solid #e8eef7}
      th{color:#315078;background:#eef5ff;font-size:12px;text-transform:uppercase;letter-spacing:0;font-weight:900}
      th:last-child,td:last-child{width:150px}
      tr:nth-child(even) td{background:#fbfdff}
      tr:hover td{background:#f5fbff}
      a{color:#0f4fd7;font-weight:800;text-decoration:none}
      .keyword-pill{
        display:inline-flex;
        min-height:28px;
        align-items:center;
        border-radius:999px;
        padding:0 10px;
        font-size:12px;
        font-weight:900;
        white-space:nowrap;
      }
      .keyword-pill{color:#0f766e;background:#dcfdfa}
      .date-cell{display:grid;gap:6px;min-width:118px}
      .date-cell strong{font-size:14px;white-space:nowrap}
      .date-cell span{
        display:inline-flex;
        width:fit-content;
        min-height:26px;
        align-items:center;
        border-radius:999px;
        padding:0 10px;
        color:#0f4fd7;
        background:#eaf1ff;
        font-size:12px;
        font-weight:900;
      }
      .empty{padding:34px;text-align:center;color:#61708a}
      .footer{margin-top:18px;color:#61708a;font-size:12px}
      @media (max-width: 760px){
        .page{padding:18px}
        .stats{grid-template-columns:1fr}
        .table-wrap{overflow-x:auto}
        table{min-width:820px}
      }
      @media print{
        body{background:white}
        .page{padding:0}
        .hero,.table-wrap{box-shadow:none}
      }
    </style>
  </head>
  <body>
    <main class="page">
      <section class="hero">
        <div class="brand">
          <img class="logo" src="${VIZUAL_ICON_URI}" alt="Vizual.Az" />
          <strong>Vizual.Az</strong>
        </div>
        <h1>Media Monitorinq Hesabatı</h1>
        <p>Seçilmiş dövr üzrə tapılan uyğun xəbər nəticələri. Hesabat mənbə, dərc vaxtı, açar söz və keçid məlumatlarını bir yerdə göstərir.</p>
        <div class="stats">
          <div class="stat"><span>Interval</span><strong>${escapeHtml(exportRangeLabels[exportRange])}</strong></div>
          <div class="stat"><span>Nəticə sayı</span><strong>${mappedRows.length}</strong></div>
          <div class="stat"><span>Hazırlandı</span><strong>${escapeHtml(generatedAt)}</strong></div>
        </div>
      </section>

      <section class="table-wrap">${tableSection}</section>
      <div class="footer">Vizual.Az tərəfindən avtomatik yaradılıb.</div>
    </main>
  </body>
</html>`

    if (format === 'pdf') {
      if (!printWindow) return
      // The browser's print dialog saves the report as PDF.
      printWindow.document.open()
      printWindow.document.write(reportHtml)
      printWindow.document.close()
      printWindow.focus()
      printWindow.setTimeout(() => printWindow.print(), 300)
      return
    }

    downloadFile('tapilan-xeberler.html', reportHtml, 'text/html;charset=utf-8')
  }
  if (isLoading && !data) {
    return (
      <div className='flex min-h-[360px] items-center justify-center p-6'>
        <Loader2 className='mr-2 h-5 w-5 animate-spin' />
        <span>{t("Nəticələr yüklənir...")}</span>
      </div>
    )
  }

  return (
    <div className='grid gap-3 p-3 md:p-4'>
      <div className='flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between'>
        <div className='min-w-0'>
          <h1 className='text-2xl font-semibold tracking-tight text-foreground md:text-3xl'>{t("Tapılan xəbərlər")}</h1>
          <p className='mt-1 text-sm text-muted-foreground'>{t("Açar sözlərinizə uyğun gələn son media nəticələri.")}</p>
        </div>
        <Pagination
          page={safePage}
          totalPages={totalPages}
          totalItems={totalItems}
          onPageChange={setPage}
          compact
        />
      </div>

      {errorMessage ? (
        <div className='rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive'>
          {errorMessage}
        </div>
      ) : null}

      <section className='rounded-2xl border border-border bg-card p-3 shadow-sm'>
        <div className='flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between'>
          <div className='flex min-w-0 flex-wrap items-center gap-2 text-sm'>
            <span className='inline-flex items-center gap-2 rounded-xl bg-primary/10 px-3 py-2 font-semibold text-primary'>
              <Download className='h-4 w-4' />
              Export
            </span>
            <button
              type='button'
              onClick={clearResultFilters}
              className='rounded-xl bg-muted/50 px-3 py-2 font-semibold text-muted-foreground transition hover:bg-muted'
            >
              {totalItems}{' '}{t("nəticə")}</button>
            <button
              type='button'
              onClick={() => setSourceSearch({})}
              className='rounded-xl bg-muted/50 px-3 py-2 font-semibold text-muted-foreground transition hover:bg-muted'
            >
              {uniqueMedia} media
            </button>
            <button
              type='button'
              onClick={() => setKeywordFilter(ALL)}
              className='rounded-xl bg-muted/50 px-3 py-2 font-semibold text-muted-foreground transition hover:bg-muted'
            >
              {uniqueKeywords}{' '}{t("açar söz")}</button>
          </div>

          <div className='flex flex-wrap gap-2'>
            <select
              aria-label={t("Sıralama")}
              value={sort}
              onChange={(event) => setSort(event.target.value as ResultsSort)}
              className='h-9 rounded-xl border border-border bg-card px-3 text-sm font-medium'
            >
              <option value='new'>{t("Ən yenilər")}</option>
              <option value='engagement'>{t("Ən çox engagement")}</option>
            </select>
            <select
              aria-label={t("İxrac dövrü")}
              value={exportRange}
              onChange={(event) =>
                setExportRange(event.target.value as ExportRange)
              }
              className='h-9 rounded-xl border border-border bg-card px-3 text-sm font-medium'
            >
              {Object.entries(exportRangeLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <button
              type='button'
              onClick={() => void exportResults('csv')}
              disabled={totalItems === 0 || isExporting}
              className='inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-border bg-card px-3 text-sm font-semibold hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50'
            >
              <FileText className='h-4 w-4' />
              CSV
            </button>
            <button
              type='button'
              onClick={() => void exportResults('xlsx')}
              disabled={totalItems === 0 || isExporting}
              className='inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-border bg-card px-3 text-sm font-semibold hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50'
            >
              <FileSpreadsheet className='h-4 w-4' />
              Excel
            </button>
            <button
              type='button'
              onClick={() => void exportResults('pdf')}
              disabled={totalItems === 0 || isExporting}
              className='inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-border bg-card px-3 text-sm font-semibold hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50'
            >
              <Printer className='h-4 w-4' />
              PDF
            </button>
            <button
              type='button'
              onClick={() => void exportResults('json')}
              disabled={totalItems === 0 || isExporting}
              className='inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-border bg-card px-3 text-sm font-semibold hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50'
            >
              <FileJson2 className='h-4 w-4' />
              JSON
            </button>
            <button
              type='button'
              onClick={() => void exportResults('html')}
              disabled={totalItems === 0 || isExporting}
              className='inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-border bg-card px-3 text-sm font-semibold hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50'
            >
              <FileCode2 className='h-4 w-4' />
              HTML
            </button>
          </div>
        </div>

        <div className='mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.6fr)_1fr_1fr_auto]'>
          <div className='relative'>
            <Search className='pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground' />
            <input
              aria-label={t("Başlıq, link və ya açar söz üzrə axtar...")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("Başlıq, link və ya açar söz üzrə axtar...")}
              className='h-10 w-full rounded-xl border border-border bg-card pr-3 pl-9 text-sm'
            />
          </div>

          <div className='grid grid-cols-2 gap-2'>
            <select
              aria-label={t("Açar söz")}
              value={keywordFilter}
              onChange={(event) => setKeywordFilter(event.target.value)}
              className='h-10 min-w-0 rounded-xl border border-border bg-card px-3 text-sm'
            >
              <option value={ALL}>{t("Bütün açar sözlər")}</option>
              {keywordOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            <select
              aria-label={t("Dil")}
              value={languageFilter}
              onChange={(event) =>
                setLanguageFilter(event.target.value as NewsLanguage | typeof ALL)
              }
              className='h-10 min-w-0 rounded-xl border border-border bg-card px-3 text-sm'
            >
              <option value={ALL}>{t("Bütün dillər")}</option>
              <option value='az'>AZ</option>
              <option value='ru'>RU</option>
              <option value='en'>EN</option>
            </select>
          </div>

          <div className='grid grid-cols-2 gap-2'>
            <select
              aria-label={t("Mənbə növü")}
              value={sourceCategory ?? ALL}
              onChange={(event) => {
                const value = event.target.value
                setSourceSearch(
                  value === 'web' || value === 'social' ? { cat: value } : {}
                )
              }}
              className='h-10 min-w-0 rounded-xl border border-border bg-card px-3 text-sm'
            >
              <option value={ALL}>{t("Bütün mənbələr")}</option>
              <option value='web'>{t("Vebsaytlar")}</option>
              <option value='social'>{t("Sosial şəbəkələr")}</option>
            </select>

            {sourceCategory === 'social' ? (
              <select
                aria-label={t("Sosial şəbəkə")}
                value={socialNetwork ?? ALL}
                onChange={(event) => {
                  const value = event.target.value
                  setSourceSearch({
                    cat: 'social',
                    net: isSocialNetwork(value) ? value : undefined,
                  })
                }}
                className='h-10 min-w-0 rounded-xl border border-border bg-card px-3 text-sm'
              >
                <option value={ALL}>{t("Bütün şəbəkələr")}</option>
                {networkOptions.map((network) => (
                  <option key={network} value={network}>
                    {socialNetworkLabels[network]}
                  </option>
                ))}
              </select>
            ) : (
              <DropdownMenu onOpenChange={(open) => !open && setSiteQuery('')}>
                <DropdownMenuTrigger
                  disabled={sourceCategory !== 'web'}
                  className='inline-flex h-10 min-w-0 items-center justify-between gap-1 rounded-xl border border-border bg-card px-3 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50'
                >
                  <span className='truncate'>
                    {selectedSites.length === 0
                      ? t("Bütün saytlar")
                      : selectedSites.length === 1
                        ? selectedSites[0]
                        : `${selectedSites.length} ${t("sayt")}`}
                  </span>
                  <ChevronDown className='h-4 w-4 shrink-0 text-muted-foreground' />
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align='end'
                  className='w-[min(18rem,calc(100vw-2rem))]'
                >
                  <div className='p-1'>
                    <input
                      autoFocus
                      aria-label={t("Sayt axtar")}
                      value={siteQuery}
                      onChange={(event) => setSiteQuery(event.target.value)}
                      onKeyDown={(event) => event.stopPropagation()}
                      placeholder={t("Sayt axtar")}
                      className='h-9 w-full rounded-lg border border-border bg-card px-2 text-sm'
                    />
                  </div>
                  {selectedSites.length > 0 ? (
                    <>
                      <button
                        type='button'
                        onClick={() => setSourceSearch({ cat: 'web' })}
                        className='w-full rounded-sm px-2 py-1.5 text-left text-sm font-semibold text-primary hover:bg-muted'
                      >
                        {t("Seçimi təmizlə")}
                      </button>
                      <DropdownMenuSeparator />
                    </>
                  ) : null}
                  <div className='max-h-64 overflow-y-auto'>
                    {visibleSiteOptions.map((site) => (
                      <DropdownMenuCheckboxItem
                        key={site}
                        checked={selectedSites.includes(site)}
                        onCheckedChange={() => toggleSite(site)}
                        onSelect={(event) => event.preventDefault()}
                        className='break-all'
                      >
                        {site}
                      </DropdownMenuCheckboxItem>
                    ))}
                    {visibleSiteOptions.length === 0 ? (
                      <div className='px-2 py-1.5 text-sm text-muted-foreground'>
                        {t("Sayt tapılmadı")}
                      </div>
                    ) : null}
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>

          <input
            type='date'
            value={dateFilter}
            onChange={(event) => setDateFilter(event.target.value)}
            className='h-10 rounded-xl border border-border bg-card px-3 text-sm'
          />
        </div>

        <p className='mt-2 text-xs text-muted-foreground'>{t("Sistem mənbələri mütəmadi yoxlayır; uyğun yeni material tapıldıqda bu siyahıya əlavə olunur.")}</p>
      </section>

      <div className='overflow-hidden rounded-2xl border border-border bg-card shadow-sm'>
        <div className='flex items-center justify-between border-b border-border px-3 py-2 text-sm text-muted-foreground'>
          <span>
            {totalItems}{' '}{t("nəticə | səhifə")}{' '}{safePage} / {totalPages}
          </span>
          <Pagination
            page={safePage}
            totalPages={totalPages}
            totalItems={totalItems}
            onPageChange={setPage}
            compact
          />
        </div>

        <div
          className={
            isFetching ? 'divide-y divide-slate-100 opacity-60' : 'divide-y divide-slate-100'
          }
        >
          {paginatedRows.map((row) => {
            const item = row.url ? { url: row.url } : null
            const title = row.title ? decodeHtml(row.title) : t("Xəbər tapılmadı")
            const detectedAt = row.detected_at || row.created_at

            return (
              <article
                key={row.id}
                className='px-3 py-2.5 transition hover:bg-muted/50'
              >
                <div className='flex min-w-0 items-start gap-3'>
                  <div className='min-w-0 flex-1'>
                    <div className='flex flex-wrap items-center gap-1.5 text-[11px] font-bold text-muted-foreground'>
                      <span className='rounded-full bg-primary/10 px-2 py-0.5 text-primary'>
                        {row.matched_keyword || t("Açar söz yoxdur")}
                      </span>
                      <span className='rounded-full bg-muted px-2 py-0.5'>
                        {getHost(row.url ?? undefined)}
                      </span>
                    </div>

                    {item ? (
                      <a
                        href={item.url}
                        target='_blank'
                        rel='noreferrer'
                        className='mt-1 block truncate text-sm leading-5 font-semibold text-foreground hover:text-primary hover:underline'
                      >
                        {title}
                      </a>
                    ) : (
                      <div className='mt-1 truncate text-sm font-semibold text-muted-foreground'>
                        {title}
                      </div>
                    )}

                    <EngagementBadges row={row} />

                    <div className='mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground'>
                      <span>{t("Dərc:")}{' '}{formatDate(row.published_at)}
                      </span>
                      <span>{t("Tapıldı:")}{' '}{formatDate(detectedAt)}</span>
                    </div>
                  </div>

                  {item ? (
                    <a
                      href={item.url}
                      target='_blank'
                      rel='noreferrer'
                      className='inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-lg border border-border px-2.5 text-xs font-bold hover:bg-muted/50'
                    >{t("Aç")}<ExternalLink className='h-3.5 w-3.5' />
                    </a>
                  ) : null}
                </div>
              </article>
            )
          })}

          {paginatedRows.length === 0 && !errorMessage && (
            <div className='p-6 text-center'>
              <div className='font-medium'>{t("Hələ nəticə yoxdur")}</div>
              <p className='mx-auto mt-1 max-w-md text-sm text-muted-foreground'>{t("Sistem mənbələri yoxladıqca uyğun media materialları burada görünəcək. Uzun müddət nəticə yaranmırsa, açar sözləri daha konkret yazmağı yoxlayın.")}</p>
              <Link
                to='/monitor/keywords'
                className='mt-3 inline-flex rounded-lg border px-3 py-2 text-sm hover:bg-muted'
              >
                {t("Açar sözlərə bax")}
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
export const Route = createFileRoute('/(auth)/monitor/results')({
  component: ResultsPage,
  validateSearch: validateResultsSearch,
})
