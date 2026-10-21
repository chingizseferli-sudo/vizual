import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bell, CheckCheck, ExternalLink, Loader2 } from 'lucide-react'
import { customerQueryKeys } from '@/lib/query-keys'
import { supabase } from '@/lib/supabase'
import { cn, openExternalUrl } from '@/lib/utils'
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { dateLocale, t } from '@/lib/i18n'

type NotificationRow = {
  id: string
  channel: string | null
  status: string | null
  sent_at: string | null
  monitor_matches: {
    matched_keyword: string | null
    monitored_items: {
      title: string | null
      url: string | null
    } | null
  } | null
}

type NotificationData = {
  alerts: NotificationRow[]
  userId: string | null
}

function readStorage(key: string) {
  if (typeof window === 'undefined') return [] as string[]

  try {
    const value = window.localStorage.getItem(key)
    const parsed = value ? JSON.parse(value) : []
    return Array.isArray(parsed)
      ? parsed.filter((item) => typeof item === 'string')
      : []
  } catch {
    return []
  }
}

function writeStorage(key: string, ids: string[]) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(key, JSON.stringify(ids.slice(0, 500)))
}

function decodeHtml(value: string) {
  if (typeof document === 'undefined') return value
  const textarea = document.createElement('textarea')
  textarea.innerHTML = value
  return textarea.value
}

function formatTime(value: string | null) {
  if (!value) return '-'

  return new Date(value).toLocaleString(dateLocale(), {
    timeZone: 'Asia/Baku',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function getHost(url: string | null | undefined) {
  if (!url) return t("Mənbə yoxdur")

  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

async function fetchCustomerNotifications(): Promise<NotificationData> {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) return { alerts: [], userId: null }

  // Single round-trip: filter alerts by monitor owner through inner joins
  // instead of fetching every monitor and every match id first (the old
  // 3-query waterfall built an unbounded `in (...)` list of match ids).
  const { data, error } = await supabase
    .from('monitor_alerts')
    .select(
      'id,channel,status,sent_at,monitor_matches!inner(matched_keyword,user_monitors!inner(user_id),monitored_items(title,url))'
    )
    .eq('monitor_matches.user_monitors.user_id', user.id)
    .order('sent_at', { ascending: false })
    .limit(20)

  if (error) throw error

  return {
    alerts: (data || []) as unknown as NotificationRow[],
    userId: user.id,
  }
}

export function CustomerNotifications() {
  const [open, setOpen] = useState(false)
  const [readState, setReadState] = useState<{
    storageKey: string
    ids: string[]
  } | null>(null)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: [...customerQueryKeys.alerts(), 'header'],
    queryFn: fetchCustomerNotifications,
    staleTime: 30_000,
  })

  const storageKey = data?.userId
    ? `visual-monitor:customer-alerts-read:${data.userId}`
    : 'visual-monitor:customer-alerts-read:anonymous'

  const readIds =
    readState?.storageKey === storageKey
      ? readState.ids
      : readStorage(storageKey)

  const alerts = useMemo(() => {
    // Same site + headline + keyword is one notification, however many rows exist.
    const seen = new Set<string>()
    return (data?.alerts || []).filter((alert) => {
      const item = alert.monitor_matches?.monitored_items
      const title = (item?.title || '').trim().toLowerCase().replace(/\s+/g, ' ')
      if (!title) return true
      const key = `${getHost(item?.url)}|${title}|${alert.monitor_matches?.matched_keyword || ''}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [data?.alerts])
  const readSet = useMemo(() => new Set(readIds), [readIds])
  const unreadCount = alerts.filter((alert) => !readSet.has(alert.id)).length

  function updateReadIds(nextIds: string[]) {
    const unique = Array.from(new Set(nextIds))
    setReadState({ storageKey, ids: unique })
    writeStorage(storageKey, unique)
  }

  function markOneAsRead(alertId: string) {
    if (readSet.has(alertId)) return
    updateReadIds([alertId, ...readIds])
  }

  function markAllAsRead() {
    updateReadIds([...alerts.map((alert) => alert.id), ...readIds])
  }

  function openAlert(alert: NotificationRow) {
    markOneAsRead(alert.id)
    const url = alert.monitor_matches?.monitored_items?.url
    openExternalUrl(url)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type='button'
          aria-label={t("Bildirişlər")}
          className='relative inline-flex size-11 items-center justify-center rounded-xl border border-border bg-card text-foreground shadow-sm transition hover:border-primary/20 hover:bg-primary/10 hover:text-primary'
        >
          <Bell className='size-5' />
          {unreadCount > 0 ? (
            <span className='absolute -top-1.5 -right-1.5 min-w-5 rounded-full bg-primary px-1.5 py-0.5 text-[10px] leading-none font-semibold text-primary-foreground shadow-sm'>
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          ) : null}
        </button>
      </DialogTrigger>
      <DialogContent className='gap-0 overflow-hidden p-0 sm:max-w-md sm:p-0'>
        <div className='flex items-start justify-between gap-3 border-b border-border px-4 py-4 pr-14'>
          <div>
            <DialogTitle className='text-base font-semibold text-foreground'>{t("Bildirişlər")}</DialogTitle>
            <DialogDescription className='mt-1 text-sm text-muted-foreground'>
              {unreadCount}{' '}{t("yeni bildiriş")}</DialogDescription>
          </div>
          <button
            type='button'
            className='inline-flex items-center gap-2 rounded-xl bg-primary/10 px-3 py-2 text-sm font-semibold text-primary transition hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50'
            disabled={alerts.length === 0 || unreadCount === 0}
            onClick={markAllAsRead}
          >
            <CheckCheck className='size-4' />
            Oxundu
          </button>
        </div>

        <div className='max-h-[min(28rem,65dvh)] overflow-y-auto'>
          {isLoading ? (
            <div className='flex items-center gap-2 px-4 py-8 text-sm font-semibold text-muted-foreground'>
              <Loader2 className='size-4 animate-spin' />{t("Bildirişlər yüklənir...")}</div>
          ) : isError ? (
            <div className='space-y-3 px-4 py-6'>
              <p className='text-sm font-semibold text-muted-foreground'>{t("Bildirişləri yükləmək mümkün olmadı.")}</p>
              <button
                type='button'
                className='rounded-lg border border-border px-3 py-2 text-sm font-bold text-foreground hover:bg-muted/50'
                onClick={() => refetch()}
              >{t("Yenidən yoxla")}</button>
            </div>
          ) : alerts.length === 0 ? (
            <div className='px-4 py-8 text-sm font-semibold text-muted-foreground'>{t("Yeni bildiriş yoxdur.")}</div>
          ) : (
            alerts.map((alert) => {
              const item = alert.monitor_matches?.monitored_items
              const keyword =
                alert.monitor_matches?.matched_keyword || t("Açar söz")
              const title = decodeHtml(item?.title || t("Başlıq yoxdur"))
              const isUnread = !readSet.has(alert.id)

              return (
                <button
                  key={alert.id}
                  type='button'
                  className={cn(
                    'group flex w-full gap-3 border-b border-border px-4 py-4 text-left transition last:border-b-0 hover:bg-muted/50',
                    isUnread ? 'bg-primary/5' : 'bg-card'
                  )}
                  onClick={() => openAlert(alert)}
                >
                  <span
                    className={cn(
                      'mt-1 size-2.5 shrink-0 rounded-full',
                      isUnread ? 'bg-primary' : 'bg-muted'
                    )}
                  />
                  <span className='min-w-0 flex-1'>
                    <span className='line-clamp-2 text-sm leading-5 font-semibold text-foreground'>
                      {title}
                    </span>
                    <span className='mt-1 block truncate text-xs font-bold text-muted-foreground'>
                      {keyword}
                    </span>
                    <span className='mt-3 flex flex-wrap items-center gap-2'>
                      <span className='rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-foreground'>
                        {getHost(item?.url)}
                      </span>
                      <span className='rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary'>
                        {formatTime(alert.sent_at)}
                      </span>
                    </span>
                  </span>
                  <ExternalLink className='mt-1 size-4 shrink-0 text-muted-foreground transition group-hover:text-primary' />
                </button>
              )
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
