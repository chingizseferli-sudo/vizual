import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { AlertTriangle, Loader2, RefreshCw, Send, Users } from 'lucide-react'
import { supabase } from '@/lib/supabase'

const STALE_POLL_MS = 10 * 60 * 1000
// Delivery reasons written to sources.last_result by the rss worker.
const DELIVERY_FAILURE_REASONS = [
  'forbidden',
  'chat_not_found',
  'bot_blocked',
  'bad_request',
  'network_error',
  'telegram_429',
  'chat_migrated',
  'telegram_error',
]

const telegramAdminQueryKey = ['admin', 'telegram'] as const

type Heartbeat = {
  last_poll_at?: string | null
  last_poll_ok_at?: string | null
  last_error?: string | null
  last_error_at?: string | null
  last_send_ok_at?: string | null
}

type FailureRow = {
  id: string
  name: string | null
  last_result: string | null
  last_checked_at: string | null
}

type TelegramAdminData = {
  heartbeat: Heartbeat | null
  heartbeatUpdatedAt: string | null
  paused: boolean
  settingsUpdatedAt: string | null
  linkedUsers: number | null
  failures: FailureRow[]
  errors: string[]
  fetchedAt: number
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'

  return date.toLocaleString('az-AZ', {
    timeZone: 'Asia/Baku',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

async function fetchTelegramAdminData(): Promise<TelegramAdminData> {
  const [stateResult, settingsResult, linkedResult, failuresResult] =
    await Promise.all([
      supabase
        .from('bot_runtime_state')
        .select('value,updated_at')
        .eq('key', 'telegram_heartbeat')
        .maybeSingle(),
      supabase
        .from('bot_settings')
        .select('notifications_paused,updated_at')
        .eq('id', 1)
        .maybeSingle(),
      supabase
        .from('user_profiles')
        .select('user_id', { count: 'exact', head: true })
        .not('telegram_chat_id', 'is', null),
      supabase
        .from('sources')
        .select('id,name,last_result,last_checked_at')
        .in('last_result', DELIVERY_FAILURE_REASONS)
        .order('last_checked_at', { ascending: false, nullsFirst: false })
        .limit(20),
    ])

  const errors = [
    stateResult.error && `Bot vəziyyəti: ${stateResult.error.message}`,
    settingsResult.error && `Tənzimləmələr: ${settingsResult.error.message}`,
    linkedResult.error &&
      `Qoşulmuş istifadəçilər: ${linkedResult.error.message}`,
    failuresResult.error &&
      `Göndərmə xətaları: ${failuresResult.error.message}`,
  ].filter(Boolean) as string[]

  const state = stateResult.data as {
    value: Heartbeat | null
    updated_at: string | null
  } | null
  const settings = settingsResult.data as {
    notifications_paused: boolean
    updated_at: string | null
  } | null

  return {
    heartbeat: state?.value ?? null,
    heartbeatUpdatedAt: state?.updated_at ?? null,
    paused: Boolean(settings?.notifications_paused),
    settingsUpdatedAt: settings?.updated_at ?? null,
    linkedUsers: linkedResult.error ? null : (linkedResult.count ?? 0),
    failures: (failuresResult.data || []) as FailureRow[],
    errors,
    fetchedAt: Date.now(),
  }
}

async function setNotificationsPaused(paused: boolean) {
  const { data, error } = await supabase
    .from('bot_settings')
    .update({ notifications_paused: paused })
    .eq('id', 1)
    .select('notifications_paused')

  if (error) throw new Error(error.message)
  if (!data || data.length === 0) {
    throw new Error('bot_settings sətri tapılmadı və ya icazə yoxdur.')
  }
}

// Codes written by the rss worker: "poll:<http status>", "poll:exception",
// "send:<reason>" (see parse_telegram_response in site_monitor.py).
const TELEGRAM_ERROR_TEXT: Record<string, string> = {
  'poll:409':
    'Başqa proses eyni botu oxuyur. Deploy zamanı qısa müddət normaldır; davam edirsə köhnə bot prosesini (köhnə Railway servisi, GitHub Actions) söndürün.',
  'poll:401': 'Bot token səhvdir. Railway-də BOT_TOKEN dəyərini yoxlayın.',
  'poll:404': 'Bot token səhvdir. Railway-də BOT_TOKEN dəyərini yoxlayın.',
  'poll:429': 'Telegram sorğuları müvəqqəti məhdudlaşdırıb.',
  'poll:exception': 'Şəbəkə xətası: Telegram-a qoşulmaq alınmadı.',
  'send:bot_blocked': 'Müştəri botu bloklayıb, ona mesaj getmir.',
  'send:chat_not_found':
    'Çat tapılmadı: müştəri botu silib və ya çat ID səhvdir.',
  'send:forbidden': 'Bot bu çata yaza bilmir (icazə yoxdur).',
  'send:telegram_429':
    'Telegram göndərişi müvəqqəti məhdudlaşdırıb, mesaj təkrar göndərilir.',
  'send:chat_migrated':
    'Qrup supergroup-a çevrilib, müştəri Telegram-ı yenidən qoşmalıdır.',
  'send:bad_request': 'Telegram mesajı qəbul etmədi (səhv sorğu).',
  'send:network_error': 'Şəbəkə xətası: mesaj göndərilmədi.',
}

function describeTelegramError(code: string) {
  return (
    TELEGRAM_ERROR_TEXT[code] ??
    (code.startsWith('poll:5') ? 'Telegram serverində müvəqqəti xəta.' : code)
  )
}

function isAfter(a: string | null | undefined, b: string | null | undefined) {
  if (!a) return false
  if (!b) return true
  return new Date(a).getTime() > new Date(b).getTime()
}

function StatusTile({
  label,
  value,
  detail,
  tone = 'default',
}: {
  label: string
  value: string
  detail?: string
  tone?: 'default' | 'warning' | 'error' | 'muted'
}) {
  const toneClass =
    tone === 'error'
      ? 'text-destructive'
      : tone === 'warning'
        ? 'text-amber-600'
        : tone === 'muted'
          ? 'text-muted-foreground'
          : 'text-foreground'

  return (
    <div className='min-w-0 rounded-lg border bg-background p-3'>
      <div className='text-xs text-muted-foreground'>{label}</div>
      <div className={`mt-1 text-sm font-medium break-words ${toneClass}`}>
        {value}
      </div>
      {detail ? (
        <div className='mt-1 text-xs text-muted-foreground'>{detail}</div>
      ) : null}
    </div>
  )
}

function TelegramAdminPage() {
  const queryClient = useQueryClient()
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: telegramAdminQueryKey,
    queryFn: fetchTelegramAdminData,
    refetchInterval: 60 * 1000,
  })
  const pauseMutation = useMutation({
    mutationFn: setNotificationsPaused,
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: telegramAdminQueryKey }),
  })

  if (isLoading || !data) {
    return (
      <div className='flex min-h-[320px] items-center justify-center p-6 text-sm text-muted-foreground'>
        <Loader2 className='mr-2 h-4 w-4 animate-spin' />
        Telegram bot məlumatları yüklənir...
      </div>
    )
  }

  const lastPollAt = data.heartbeat?.last_poll_at ?? null
  const lastError = data.heartbeat?.last_error ?? null
  // An error counts only until the same kind of call succeeds again.
  const lastErrorCurrent = lastError
    ? isAfter(
        data.heartbeat?.last_error_at,
        lastError.startsWith('poll:')
          ? data.heartbeat?.last_poll_ok_at
          : data.heartbeat?.last_send_ok_at
      )
    : false
  const lastPollTime = lastPollAt ? new Date(lastPollAt).getTime() : NaN
  const pollStale =
    Number.isNaN(lastPollTime) || data.fetchedAt - lastPollTime > STALE_POLL_MS

  function togglePause() {
    const next = !data?.paused
    const ok = window.confirm(
      next
        ? 'Bütün müştəri Telegram bildirişləri dayandırılsın? Bot əmrləri işləməyə davam edəcək.'
        : 'Müştəri Telegram bildirişləri yenidən aktiv edilsin?'
    )
    if (ok) pauseMutation.mutate(next)
  }

  return (
    <div className='grid gap-6 p-4 md:p-6'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div>
          <h1 className='text-xl font-semibold tracking-tight'>Telegram bot</h1>
          <p className='text-muted-foreground'>
            Bot vəziyyəti, bildirişlərin ümumi dayandırılması və çatdırılma
            xətaları.
          </p>
        </div>
        <button
          type='button'
          onClick={() => void refetch()}
          disabled={isFetching}
          className='inline-flex items-center gap-2 rounded-lg border bg-card px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-60'
        >
          <RefreshCw
            className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`}
          />
          Yenilə
        </button>
      </div>

      {data.errors.length > 0 ? (
        <div
          className='rounded-lg border border-destructive/25 bg-destructive/10 p-4 text-sm text-destructive'
          role='alert'
        >
          {data.errors.map((message) => (
            <div key={message}>{message}</div>
          ))}
          <div className='mt-1 text-xs'>
            Migrasiya (20261019000002_telegram_bot_admin) tətbiq olunmayıbsa, bu
            cədvəllər hələ mövcud deyil.
          </div>
        </div>
      ) : null}

      <div className='grid gap-4 lg:grid-cols-3'>
        <section className='rounded-lg border bg-card p-4 md:p-5 lg:col-span-2'>
          <div className='mb-4 flex flex-wrap items-center justify-between gap-2'>
            <div className='flex items-center gap-2'>
              <Send className='h-5 w-5 text-muted-foreground' />
              <h2 className='text-lg font-semibold'>Bot vəziyyəti</h2>
            </div>
            <span
              className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
                pollStale
                  ? 'border-amber-300 bg-amber-50 text-amber-700'
                  : 'border-success/25 bg-success/10 text-success'
              }`}
            >
              {pollStale ? 'Köhnə məlumat' : 'İşləyir'}
            </span>
          </div>

          {pollStale ? (
            <div className='mb-4 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800'>
              <AlertTriangle className='mt-0.5 h-4 w-4 shrink-0' />
              <span>
                Bot son 10 dəqiqədə Telegram-ı yoxlamayıb. Railway rss
                worker-inin işlədiyini yoxlayın.
              </span>
            </div>
          ) : null}

          <div className='grid gap-3 sm:grid-cols-3'>
            <StatusTile
              label='Son yoxlama'
              value={formatDate(lastPollAt)}
              tone={pollStale ? 'warning' : 'default'}
            />
            <StatusTile
              label='Son uğurlu göndəriş'
              value={formatDate(data.heartbeat?.last_send_ok_at)}
            />
            <StatusTile
              label='Son xəta'
              value={
                lastError ? describeTelegramError(lastError) : 'Xəta yoxdur'
              }
              detail={
                lastError
                  ? `${lastErrorCurrent ? '' : 'Köhnə, sonra bot normal işləyib · '}${lastError} · ${formatDate(data.heartbeat?.last_error_at)}`
                  : undefined
              }
              tone={
                !lastError ? 'default' : lastErrorCurrent ? 'error' : 'muted'
              }
            />
          </div>
        </section>

        <section className='grid content-start gap-4'>
          <div className='rounded-lg border bg-card p-4 md:p-5'>
            <div className='flex items-start justify-between gap-3'>
              <div>
                <h2 className='font-semibold'>Müştəri bildirişləri</h2>
                <p className='mt-1 text-sm text-muted-foreground'>
                  {data.paused
                    ? 'Dayandırılıb. Bot əmrləri (/start, /status, /stop və s.) işləyir.'
                    : 'Aktivdir. Dəyişiklik worker-ə 1 dəqiqəyə çatır.'}
                </p>
              </div>
              <button
                type='button'
                role='switch'
                aria-checked={!data.paused}
                aria-label='Müştəri bildirişləri'
                onClick={togglePause}
                disabled={pauseMutation.isPending || data.errors.length > 0}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:opacity-50 ${
                  data.paused ? 'bg-muted-foreground/40' : 'bg-success'
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 rounded-full bg-background shadow transition ${
                    data.paused ? 'translate-x-0.5' : 'translate-x-5'
                  }`}
                />
              </button>
            </div>
            {pauseMutation.isError ? (
              <p className='mt-2 text-sm text-destructive' role='alert'>
                Dəyişmədi: {pauseMutation.error.message}
              </p>
            ) : null}
            <p className='mt-2 text-xs text-muted-foreground'>
              Son dəyişiklik: {formatDate(data.settingsUpdatedAt)}
            </p>
          </div>

          <div className='rounded-lg border bg-card p-4'>
            <div className='flex items-center gap-2 text-sm text-muted-foreground'>
              <Users className='h-4 w-4' />
              Telegram qoşulmuş istifadəçi
            </div>
            <div className='mt-1 text-2xl font-bold'>
              {data.linkedUsers ?? '—'}
            </div>
          </div>
        </section>
      </div>

      <section className='rounded-lg border bg-card p-4 md:p-5'>
        <h2 className='text-lg font-semibold'>Son çatdırılma xətaları</h2>
        <p className='mb-4 text-sm text-muted-foreground'>
          Son yoxlamada Telegram göndərişi alınmayan mənbələr (son 20). Mənbə
          sağlamlığı yazılmırsa (SOURCE_HEALTH_ENABLED=false) siyahı boş qalır.
        </p>
        {data.failures.length === 0 ? (
          <div className='rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground'>
            Çatdırılma xətası qeydə alınmayıb.
          </div>
        ) : (
          <div className='overflow-x-auto'>
            <table className='w-full text-sm'>
              <thead className='text-left text-muted-foreground'>
                <tr className='border-b'>
                  <th className='py-2 pr-4 font-medium'>Mənbə</th>
                  <th className='py-2 pr-4 font-medium'>Səbəb</th>
                  <th className='py-2 font-medium'>Vaxt</th>
                </tr>
              </thead>
              <tbody>
                {data.failures.map((row) => (
                  <tr key={row.id} className='border-b last:border-0'>
                    <td className='py-2 pr-4'>{row.name || '—'}</td>
                    <td className='py-2 pr-4 font-mono text-xs text-destructive'>
                      {row.last_result}
                    </td>
                    <td className='py-2 whitespace-nowrap'>
                      {formatDate(row.last_checked_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

export const Route = createFileRoute('/(auth)/admin/telegram')({
  component: TelegramAdminPage,
})
