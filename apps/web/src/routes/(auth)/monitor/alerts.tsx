import { useEffect, useMemo, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import {
  Bell,
  CheckCircle2,
  Download,
  ExternalLink,
  Loader2,
  Send,
  XCircle,
} from 'lucide-react'
import { fetchCustomerAlerts } from '@/features/keywords/alerts'
import { customerQueryKeys } from '@/lib/query-keys'
import { dateLocale, t } from '@/lib/i18n'

const PAGE_SIZE = 12
const ALL = 'all'

type FilterOption = {
  value: string
  label: string
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

function getHost(url: string | null | undefined) {
  if (!url) return '-'

  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function getChannelLabel(channel: string | null) {
  const normalized = channel || 'web'

  if (normalized === 'telegram') return t("Telegram")
  if (normalized === 'email') return t("Email")
  if (normalized === 'web') return 'Panel'
  return normalized
}

function getStatusInfo(status: string | null) {
  const normalized = status || 'new'

  if (['sent', 'delivered', 'new'].includes(normalized)) {
    return {
      label: normalized === 'new' ? t("Yeni") : t("Göndərildi"),
      className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    }
  }

  if (['pending', 'queued'].includes(normalized)) {
    return {
      label: t("Gözləyir"),
      className: 'border-amber-200 bg-amber-50 text-amber-700',
    }
  }

  if (['failed', 'error'].includes(normalized)) {
    return {
      label: t("Göndərilmədi"),
      className: 'border-destructive/30 bg-destructive/10 text-destructive',
    }
  }

  return {
    label: normalized,
    className: 'border-muted bg-muted/40 text-muted-foreground',
  }
}

function csvCell(value: string | number | null | undefined) {
  const text = String(value ?? '').replace(/"/g, '""')
  return `"${text}"`
}

function downloadCsv(
  filename: string,
  rows: Array<Array<string | number | null | undefined>>
) {
  const csv = rows.map((row) => row.map(csvCell).join(',')).join('\n')
  const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function Pagination({
  page,
  totalPages,
  totalItems,
  onPageChange,
}: {
  page: number
  totalPages: number
  totalItems: number
  onPageChange: (page: number) => void
}) {
  if (totalItems === 0) return null

  return (
    <div className='flex flex-col gap-3 rounded-2xl border border-border bg-card p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between'>
      <div className='text-sm text-muted-foreground'>
        {t('{0} bildiriş | səhifə {1} / {2}', [totalItems, page, totalPages])}
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

function AlertsPage() {
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: customerQueryKeys.alerts(),
    queryFn: fetchCustomerAlerts,
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  })
  const alerts = useMemo(() => data?.alerts ?? [], [data?.alerts])
  const errorMessage = data?.errorMessage || ''
  const [channelFilter, setChannelFilter] = useState(ALL)
  const [statusFilter, setStatusFilter] = useState(ALL)
  const [keywordFilter, setKeywordFilter] = useState(ALL)
  const [page, setPage] = useState(1)

  useEffect(() => {
    setPage(1)
  }, [channelFilter, statusFilter, keywordFilter])

  const keywordOptions = useMemo<FilterOption[]>(() => {
    const values = new Set(
      alerts
        .map((alert) => alert.monitor_matches?.matched_keyword)
        .filter((value): value is string => Boolean(value))
    )
    return Array.from(values)
      .sort((a, b) => a.localeCompare(b, 'az'))
      .map((value) => ({ value, label: value }))
  }, [alerts])

  const statusOptions = useMemo<FilterOption[]>(() => {
    const values = Array.from(
      new Set(alerts.map((alert) => alert.status || 'new'))
    )
    return values
      .sort((a, b) => a.localeCompare(b, 'az'))
      .map((value) => ({ value, label: getStatusInfo(value).label }))
  }, [alerts])

  const filteredAlerts = useMemo(() => {
    return alerts.filter((alert) => {
      const channel = alert.channel || 'web'
      const status = alert.status || 'new'
      const keyword = alert.monitor_matches?.matched_keyword

      return (
        (channelFilter === ALL || channel === channelFilter) &&
        (statusFilter === ALL || status === statusFilter) &&
        (keywordFilter === ALL || keyword === keywordFilter)
      )
    })
  }, [alerts, channelFilter, statusFilter, keywordFilter])

  const totalPages = Math.max(1, Math.ceil(filteredAlerts.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const paginatedAlerts = filteredAlerts.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE
  )

  const stats = useMemo(
    () => ({
      all: alerts.length,
      telegram: alerts.filter((item) => item.channel === 'telegram').length,
      web: alerts.filter((item) => (item.channel || 'web') === 'web').length,
      sent: alerts.filter((item) =>
        ['sent', 'delivered', 'new'].includes(item.status || 'new')
      ).length,
      failed: alerts.filter((item) =>
        ['failed', 'error'].includes(item.status || '')
      ).length,
    }),
    [alerts]
  )

  function exportAlerts() {
    downloadCsv('bildirisler.csv', [
      [
        t("Açar söz"),
        t("Başlıq"),
        t("Mənbə"),
        t("Link"),
        'Kanal',
        t("Status"),
        t("Göndərilmə vaxtı"),
      ],
      ...filteredAlerts.map((alert) => {
        const match = alert.monitor_matches
        const item = match?.monitored_items
        return [
          match?.matched_keyword || '-',
          item?.title ? decodeHtml(item.title) : t("Xəbər tapılmadı"),
          getHost(item?.url),
          item?.url || '',
          getChannelLabel(alert.channel),
          getStatusInfo(alert.status).label,
          formatDate(alert.sent_at),
        ]
      }),
    ])
  }

  if (isLoading && !data) {
    return (
      <div className='flex min-h-[360px] items-center justify-center p-6'>
        <Loader2 className='mr-2 h-5 w-5 animate-spin' />
        <span>{t("Bildirişlər yüklənir...")}</span>
      </div>
    )
  }

  if (errorMessage) {
    return (
      <div className='grid gap-4 p-4 md:p-6'>
        <div>
          <h1 className='text-2xl font-bold tracking-tight'>{t("Bildirişlər")}</h1>
          <p className='text-muted-foreground'>{t("Vacib uyğunluqlar üzrə yaradılan və göndərilən bildirişlərin tarixçəsi burada görünür.")}</p>
        </div>

        <div className='rounded-lg border border-destructive/30 bg-destructive/10 p-6 text-sm text-destructive'>
          <div className='font-medium'>{errorMessage}</div>
          <button
            type='button'
            onClick={() => void refetch()}
            disabled={isFetching}
            className='mt-4 inline-flex items-center justify-center rounded-lg border border-destructive/30 bg-background px-3 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50'
          >
            {isFetching ? t("Yüklənir...") : t("Yenidən cəhd et")}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className='grid gap-4 p-4 md:p-6'>
      <div className='flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between'>
        <div>
          <h1 className='text-2xl font-bold tracking-tight'>{t("Bildirişlər")}</h1>
          <p className='text-muted-foreground'>{t("Vacib uyğunluqlar üzrə yaradılan və göndərilən bildirişlərin tarixçəsi burada görünür.")}</p>
        </div>
        <button
          type='button'
          onClick={exportAlerts}
          disabled={filteredAlerts.length === 0}
          className='inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50'
        >
          <Download className='h-4 w-4' />
          CSV ixrac et
        </button>
      </div>

      <section className='rounded-2xl border border-border bg-card p-4 shadow-sm'>
        <h2 className='text-base font-semibold'>{t("Bildirişlər necə yaranır?")}</h2>
        <p className='mt-1 text-sm text-muted-foreground'>{t("Uyğun nəticə tapıldıqdan sonra sistem bildiriş yarada və seçilmiş kanala göndərə bilər. Bəzən nəticə paneldə görünə bilər, amma bildiriş hələ göndərilməmiş ola bilər.")}</p>
      </section>

      <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-5'>
        <div className='rounded-2xl border border-border bg-card p-4 shadow-sm'>
          <div className='flex items-center justify-between'>
            <div>
              <div className='text-sm text-muted-foreground'>{t("Hamısı")}</div>
              <div className='mt-1 text-2xl font-semibold'>{stats.all}</div>
            </div>
            <Bell className='h-5 w-5 text-muted-foreground' />
          </div>
        </div>

        <div className='rounded-2xl border border-border bg-card p-4 shadow-sm'>
          <div className='flex items-center justify-between'>
            <div>
              <div className='text-sm text-muted-foreground'>{t("Telegram")}</div>
              <div className='mt-1 text-2xl font-semibold'>
                {stats.telegram}
              </div>
            </div>
            <Send className='h-5 w-5 text-muted-foreground' />
          </div>
        </div>

        <div className='rounded-2xl border border-border bg-card p-4 shadow-sm'>
          <div className='flex items-center justify-between'>
            <div>
              <div className='text-sm text-muted-foreground'>Panel</div>
              <div className='mt-1 text-2xl font-semibold'>{stats.web}</div>
            </div>
            <Bell className='h-5 w-5 text-muted-foreground' />
          </div>
        </div>

        <div className='rounded-2xl border border-border bg-card p-4 shadow-sm'>
          <div className='flex items-center justify-between'>
            <div>
              <div className='text-sm text-muted-foreground'>{t("Göndərilən")}</div>
              <div className='mt-1 text-2xl font-semibold'>{stats.sent}</div>
            </div>
            <CheckCircle2 className='h-5 w-5 text-muted-foreground' />
          </div>
        </div>

        <div className='rounded-2xl border border-border bg-card p-4 shadow-sm'>
          <div className='flex items-center justify-between'>
            <div>
              <div className='text-sm text-muted-foreground'>{t("Xətalı")}</div>
              <div className='mt-1 text-2xl font-semibold'>{stats.failed}</div>
            </div>
            <XCircle className='h-5 w-5 text-muted-foreground' />
          </div>
        </div>
      </div>

      <div className='grid gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm md:grid-cols-3'>
        <select
          aria-label={t("Bildiriş kanalı")}
          value={channelFilter}
          onChange={(event) => setChannelFilter(event.target.value)}
          className='rounded-xl border border-border bg-card px-3 py-2 text-sm'
        >
          <option value={ALL}>{t("Bütün kanallar")}</option>
          <option value='telegram'>{t("Telegram")}</option>
          <option value='web'>Panel</option>
          <option value='email'>{t("Email")}</option>
        </select>

        <select
          aria-label={t("İstifadəçi vəziyyəti")}
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
          className='rounded-xl border border-border bg-card px-3 py-2 text-sm'
        >
          <option value={ALL}>{t("Bütün statuslar")}</option>
          {statusOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <select
          aria-label={t("Açar söz")}
          value={keywordFilter}
          onChange={(event) => setKeywordFilter(event.target.value)}
          className='rounded-xl border border-border bg-card px-3 py-2 text-sm'
        >
          <option value={ALL}>{t("Bütün açar sözlər")}</option>
          {keywordOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <Pagination
        page={safePage}
        totalPages={totalPages}
        totalItems={filteredAlerts.length}
        onPageChange={setPage}
      />

      <div className='grid gap-3'>
        {paginatedAlerts.map((alert) => {
          const match = alert.monitor_matches
          const item = match?.monitored_items
          const title = item?.title ? decodeHtml(item.title) : t("Xəbər tapılmadı")
          const statusInfo = getStatusInfo(alert.status)

          return (
            <article
              key={alert.id}
              className='rounded-2xl border border-border bg-card p-4 shadow-sm'
            >
              <div className='flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between'>
                <div className='min-w-0 flex-1'>
                  <div className='mb-2 flex flex-wrap items-center gap-2'>
                    <span className='rounded-full border px-2 py-1 text-xs'>
                      {match?.matched_keyword || t("Açar söz yoxdur")}
                    </span>
                    <span className='rounded-full border px-2 py-1 text-xs'>
                      {getChannelLabel(alert.channel)}
                    </span>
                    <span
                      className={`rounded-full border px-2 py-1 text-xs ${statusInfo.className}`}
                    >
                      {statusInfo.label}
                    </span>
                  </div>

                  <div className='text-xs text-muted-foreground'>
                    {getHost(item?.url)}
                  </div>

                  {item ? (
                    <a
                      href={item.url || undefined}
                      target='_blank'
                      rel='noreferrer'
                      className='mt-2 line-clamp-2 text-base leading-snug font-semibold hover:underline'
                    >
                      {title}
                    </a>
                  ) : (
                    <div className='mt-2 text-base font-semibold text-muted-foreground'>
                      {title}
                    </div>
                  )}

                  <div className='mt-2 text-sm text-muted-foreground'>{t("Göndərilmə vaxtı:")}{' '}{formatDate(alert.sent_at)}
                  </div>
                </div>

                {item ? (
                  <a
                    href={item.url || undefined}
                    target='_blank'
                    rel='noreferrer'
                    className='inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted'
                  >{t("Aç")}<ExternalLink className='h-4 w-4' />
                  </a>
                ) : null}
              </div>
            </article>
          )
        })}

        {paginatedAlerts.length === 0 && (
          <div className='rounded-2xl border border-border bg-card p-8 text-center shadow-sm'>
            <div className='font-medium'>{t("Hələ bildiriş yoxdur")}</div>
            <p className='mx-auto mt-1 max-w-md text-sm text-muted-foreground'>{t("Bildirişlər uyğun nəticə tapıldıqda və göndərildikdə burada görünür. Nəticələr bölməsində material ola bilər, amma bildiriş hələ yaranmamış və ya göndərilməmiş ola bilər.")}</p>
            <Link
              to='/monitor/results'
              className='mt-3 inline-flex rounded-lg border px-3 py-2 text-sm hover:bg-muted'
            >{t("Nəticələrə bax")}</Link>
          </div>
        )}
      </div>

      <Pagination
        page={safePage}
        totalPages={totalPages}
        totalItems={filteredAlerts.length}
        onPageChange={setPage}
      />
    </div>
  )
}

export const Route = createFileRoute('/(auth)/monitor/alerts')({
  component: AlertsPage,
})
