import { Fragment } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Activity, Loader2, RefreshCw, Search, Share2 } from 'lucide-react'
import {
  SOCIAL_INTERVAL_OPTIONS,
  isMissingTableError,
} from '@/lib/social-intervals'
import { supabase } from '@/lib/supabase'
import { friendlyError } from '@/lib/friendly-error'
import { WatchedAccounts } from '@/features/social/watched-accounts'

const socialAdminQueryKey = ['admin', 'social'] as const

type SocialSettings = {
  facebook_enabled: boolean
  instagram_enabled: boolean
  instagram_accounts_enabled?: boolean
  telegram_channels_enabled?: boolean
  default_interval_minutes: number
  monthly_budget_usd: number | null
  facebook_monthly_budget_usd?: number | null
  instagram_monthly_budget_usd?: number | null
  fb_must_contain_query?: boolean
  fb_min_interval_minutes?: number
  fb_max_posts_per_query?: number
  fb_daily_posts_per_keyword?: number | null
  updated_at: string | null
}

type Usage = {
  usd?: number
  calls?: number
  facebook_usd?: number
  facebook_calls?: number
  instagram_usd?: number
  instagram_calls?: number
}

type KeywordStats = {
  raw?: number
  no_url?: number
  no_date?: number
  too_old?: number
  no_match?: number
  duplicate?: number
  stored?: number
  matched_users?: number
  alerted?: number
  usd?: number
  month?: string
  month_usd?: number
  day?: string
  day_posts?: number
  samples?: { url: string | null; text: string; date: string | null }[]
}

type KeywordState = {
  platform: string
  keyword_fold: string
  last_checked_at: string | null
  last_result_count: number | null
  last_error: string | null
  last_stats?: KeywordStats | null
}

type Heartbeat = {
  at?: string
  facebook_enabled?: boolean
  instagram_enabled?: boolean
  instagram_accounts_enabled?: boolean
  telegram_channels_enabled?: boolean
  apify_key?: boolean
  socialfetch_key?: boolean
  keywords?: number
  problem?: string
}

type SocialAdminData = {
  settings: SocialSettings | null
  keywords: KeywordState[]
  usage: Usage | null
  heartbeat: Heartbeat | null
  errors: string[]
}

// The collector wakes every 5 minutes; 15 minutes of silence means it is not running.
const HEARTBEAT_STALE_MINUTES = 15

const STAT_COLUMNS: { key: keyof KeywordStats; label: string; hint: string }[] = [
  { key: 'raw', label: 'Gələn', hint: 'Provayderin bu axtarışda qaytardığı post sayı.' },
  { key: 'stored', label: 'Yeni', hint: 'Yeni və uyğun postlar: bazaya yazıldı.' },
  { key: 'matched_users', label: 'Müştəri', hint: 'Bu postların düşdüyü müştəri açar sözləri.' },
  { key: 'alerted', label: 'Bildiriş', hint: 'Telegram-a gedən bildirişlər.' },
  { key: 'duplicate', label: 'Təkrar', hint: 'Əvvəl yazılmış postlar: yenidən göndərilmir.' },
  { key: 'too_old', label: 'Köhnə', hint: 'Son 48 saatdan köhnə postlar: göndərilmir.' },
  { key: 'no_match', label: 'Uyğunsuz', hint: 'Mətnində açar söz tapılmayan postlar (provayderin səs-küyü).' },
  { key: 'no_date', label: 'Tarixsiz', hint: 'Tarixi olmayan postlar: yaşını bilmədiyimiz üçün göndərilmir.' },
  { key: 'no_url', label: 'Linksiz', hint: 'Linki olmayan postlar.' },
]

function formatDate(value: string | null | undefined) {
  if (!value) return '—'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'

  return date.toLocaleString('az-AZ', {
    timeZone: 'Asia/Baku',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function usageKey() {
  const now = new Date()
  return `social_usage_${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}

async function fetchSocialAdminData(): Promise<SocialAdminData> {
  const [settingsResult, keywordsResult, usageResult, heartbeatResult] = await Promise.all([
    supabase
      .from('social_settings')
      .select('*')
      .eq('id', 1)
      .maybeSingle(),
    supabase
      .from('social_keyword_state')
      // '*' so the page still loads before last_stats exists.
      .select('*')
      .order('last_checked_at', { ascending: false, nullsFirst: false })
      .limit(200),
    supabase
      .from('bot_runtime_state')
      .select('value')
      .eq('key', usageKey())
      .maybeSingle(),
    supabase
      .from('bot_runtime_state')
      .select('value')
      .eq('key', 'social_heartbeat')
      .maybeSingle(),
  ])

  const results = [settingsResult, keywordsResult, usageResult]
  const tablesMissing = results.some(
    (result) => result.error && isMissingTableError(result.error)
  )
  const errors = tablesMissing
    ? [
        'Sosial monitorinq cədvəlləri bazada hələ yoxdur. Terminalda «npx supabase db push» əmrini işlədin, sonra səhifəni yeniləyin.',
      ]
    : ([
        settingsResult.error &&
          `Tənzimləmələr yüklənmədi: ${friendlyError(settingsResult.error)}`,
        keywordsResult.error &&
          `Açar sözlər yüklənmədi: ${friendlyError(keywordsResult.error)}`,
        usageResult.error && `Xərc yüklənmədi: ${friendlyError(usageResult.error)}`,
      ].filter(Boolean) as string[])

  return {
    settings: (settingsResult.data as SocialSettings | null) ?? null,
    keywords: (keywordsResult.data || []) as KeywordState[],
    usage:
      ((usageResult.data as { value: SocialAdminData['usage'] } | null)
        ?.value as SocialAdminData['usage']) ?? null,
    heartbeat:
      ((heartbeatResult.data as { value: Heartbeat | null } | null)?.value as
        | Heartbeat
        | null) ?? null,
    errors,
  }
}

async function checkNow(target: { platform?: string; keyword?: string }) {
  const { error } = await supabase.rpc('admin_social_check_now', {
    p_platform: target.platform ?? null,
    p_keyword_fold: target.keyword ?? null,
  })
  if (error) throw error
}

function formatUsd(value: number | null | undefined) {
  return value == null ? '—' : `$${Number(value).toFixed(2)}`
}

function BudgetBar({ spent, budget }: { spent: number; budget: number | null | undefined }) {
  if (budget == null) return null
  const percent = budget > 0 ? Math.min(100, (spent / budget) * 100) : 100
  return (
    <div
      className='h-2 overflow-hidden rounded-full bg-muted'
      role='progressbar'
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(percent)}
    >
      <div
        className={`h-full ${percent >= 100 ? 'bg-destructive' : percent >= 80 ? 'bg-warning' : 'bg-success'}`}
        style={{ width: `${percent}%` }}
      />
    </div>
  )
}

function NumberSetting({
  name,
  label,
  hint,
  value,
  min,
  max,
  step = 1,
  allowEmpty = false,
  disabled,
  onSave,
}: {
  name: string
  label: string
  hint: string
  value: number | null | undefined
  min: number
  max?: number
  step?: number
  allowEmpty?: boolean
  disabled: boolean
  onSave: (value: number | null) => void
}) {
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const raw = String(new FormData(event.currentTarget).get(name) ?? '').trim()
    if (raw === '') {
      if (allowEmpty) onSave(null)
      return
    }
    const next = Number(raw)
    if (!Number.isFinite(next) || next < min || (max !== undefined && next > max)) return
    onSave(next)
  }

  return (
    <form key={String(value ?? '')} onSubmit={submit} className='grid gap-1'>
      <label htmlFor={`social-${name}`} className='text-sm font-medium'>
        {label}
      </label>
      <div className='flex gap-2'>
        <input
          id={`social-${name}`}
          name={name}
          type='number'
          min={min}
          max={max}
          step={step}
          inputMode='decimal'
          defaultValue={value ?? ''}
          className='h-10 w-full rounded-lg border bg-background px-3 text-sm'
        />
        <button
          type='submit'
          disabled={disabled}
          className='rounded-lg border bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60'
        >
          Saxla
        </button>
      </div>
      <p className='text-xs text-muted-foreground'>{hint}</p>
    </form>
  )
}

function minutesSince(value: string | undefined) {
  if (!value) return null
  const time = new Date(value).getTime()
  if (Number.isNaN(time)) return null
  return Math.max(0, Math.round((Date.now() - time) / 60000))
}

function ServiceStatus({
  heartbeat,
  settings,
}: {
  heartbeat: Heartbeat | null
  settings: SocialSettings | null
}) {
  const ago = minutesSince(heartbeat?.at)
  const running = ago !== null && ago <= HEARTBEAT_STALE_MINUTES
  const checks: { label: string; ok: boolean; problem: string }[] = [
    {
      label: 'Facebook açarı (APIFY_TOKEN)',
      ok: Boolean(heartbeat?.apify_key),
      problem: 'Railway-də vizual-social servisinə APIFY_TOKEN əlavə edin.',
    },
    {
      label: 'Instagram açarı (SOCIALFETCH_API_KEY)',
      ok: Boolean(heartbeat?.socialfetch_key),
      problem: 'Railway-də vizual-social servisinə SOCIALFETCH_API_KEY əlavə edin.',
    },
    {
      label: 'Facebook aktivdir',
      ok: Boolean(settings?.facebook_enabled),
      problem: 'Aşağıda Facebook açarını yandırın.',
    },
    {
      label: 'Instagram aktivdir',
      ok: Boolean(settings?.instagram_enabled),
      problem: 'Aşağıda Instagram açarını yandırın.',
    },
    {
      label: `FB/IG üçün seçilmiş açar söz: ${heartbeat?.keywords ?? 0}`,
      ok: (heartbeat?.keywords ?? 0) > 0,
      problem:
        heartbeat?.problem === 'social_keyword_ids_for_worker'
          ? 'Bazada sosial açar söz funksiyası yoxdur: «npx supabase db push» edin.'
          : 'Müştərilər Açar sözlər səhifəsində sözlərin FB/IG açarını yandırmalıdır (planda FB/IG limiti olmalıdır).',
    },
  ]

  return (
    <section className='grid gap-3 rounded-lg border bg-card p-4 md:p-5'>
      <div className='flex items-center gap-2'>
        <Activity className='h-5 w-5 text-muted-foreground' />
        <h2 className='text-lg font-semibold'>Sosial servisin vəziyyəti</h2>
      </div>
      {heartbeat ? (
        <p className={running ? 'text-sm text-success' : 'text-sm text-destructive'}>
          {running
            ? `Servis işləyir: son dövr ${ago} dəqiqə əvvəl (${formatDate(heartbeat.at)}).`
            : `Servis ${ago ?? '?'} dəqiqədir işləmir (son dövr ${formatDate(heartbeat.at)}). Railway-də vizual-social servisinin loglarına baxın.`}
        </p>
      ) : (
        <p className='text-sm text-destructive'>
          Servis heç işləməyib. Railway-də vizual-social servisini yaradın (Root
          Directory /apps/worker, WORKER=social).
        </p>
      )}
      {heartbeat ? (
        <ul className='grid gap-1.5 text-sm'>
          {checks.map((check) => (
            <li key={check.label} className='flex flex-wrap gap-x-2'>
              <span className={check.ok ? 'text-success' : 'text-destructive'}>
                {check.ok ? '✓' : '✗'}
              </span>
              <span>{check.label}</span>
              {check.ok ? null : (
                <span className='text-muted-foreground'>— {check.problem}</span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

async function updateSocialSettings(patch: Partial<SocialSettings>) {
  const { data, error } = await supabase
    .from('social_settings')
    .update(patch)
    .eq('id', 1)
    .select('id')

  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error('social_settings sətri tapılmadı və ya icazə yoxdur.')
  }
}

function PlatformSwitch({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string
  hint: string
  checked: boolean
  disabled: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <div className='flex items-start justify-between gap-3 rounded-lg border bg-background p-3'>
      <div>
        <div className='font-medium'>{label}</div>
        <div className='text-xs text-muted-foreground'>{hint}</div>
      </div>
      <button
        type='button'
        role='switch'
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        disabled={disabled}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:opacity-50 ${
          checked ? 'bg-success' : 'bg-muted-foreground/40'
        }`}
      >
        <span
          className={`inline-block h-5 w-5 rounded-full bg-background shadow transition ${
            checked ? 'translate-x-5' : 'translate-x-0.5'
          }`}
        />
      </button>
    </div>
  )
}

function SocialAdminPage() {
  const queryClient = useQueryClient()
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: socialAdminQueryKey,
    queryFn: fetchSocialAdminData,
    refetchInterval: 60 * 1000,
  })
  const mutation = useMutation({
    mutationFn: updateSocialSettings,
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: socialAdminQueryKey }),
  })
  const checkMutation = useMutation({
    mutationFn: checkNow,
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: socialAdminQueryKey }),
  })
  if (isLoading || !data) {
    return (
      <div className='flex min-h-[320px] items-center justify-center p-6 text-sm text-muted-foreground'>
        <Loader2 className='mr-2 h-4 w-4 animate-spin' />
        Sosial monitorinq məlumatları yüklənir...
      </div>
    )
  }

  const settings = data.settings
  const disabled = mutation.isPending || !settings
  const spent = Number(data.usage?.usd ?? 0)
  const facebookSpent = Number(data.usage?.facebook_usd ?? 0)
  const instagramSpent = Number(data.usage?.instagram_usd ?? 0)

  function saveBudget(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const raw = String(new FormData(event.currentTarget).get('budget') ?? '')
    const value = raw.trim() === '' ? null : Number(raw)
    if (value !== null && (!Number.isFinite(value) || value < 0)) return
    mutation.mutate({ monthly_budget_usd: value })
  }

  return (
    <div className='grid gap-6 p-4 md:p-6'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div>
          <h1 className='text-xl font-semibold tracking-tight'>
            Sosial monitorinq
          </h1>
          <p className='text-muted-foreground'>
            Facebook və Instagram axtarışı, yoxlama tezliyi və aylıq xərc
            limiti.
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
        </div>
      ) : null}

      {mutation.isError ? (
        <p className='text-sm text-destructive' role='alert'>
          Dəyişmədi: {friendlyError(mutation.error)}
        </p>
      ) : null}

      <ServiceStatus heartbeat={data.heartbeat} settings={settings} />

      <div className='grid gap-4 lg:grid-cols-3'>
        <section className='grid content-start gap-3 rounded-lg border bg-card p-4 md:p-5'>
          <div className='flex items-center gap-2'>
            <Share2 className='h-5 w-5 text-muted-foreground' />
            <h2 className='text-lg font-semibold'>Platformalar</h2>
          </div>
          <PlatformSwitch
            label='Facebook'
            hint='Apify açar söz axtarışı'
            checked={Boolean(settings?.facebook_enabled)}
            disabled={disabled}
            onChange={(next) => mutation.mutate({ facebook_enabled: next })}
          />
          <PlatformSwitch
            label='Instagram'
            hint='SocialFetch hashtag axtarışı'
            checked={Boolean(settings?.instagram_enabled)}
            disabled={disabled}
            onChange={(next) => mutation.mutate({ instagram_enabled: next })}
          />
          <PlatformSwitch
            label='Instagram səhifələri'
            hint='Seçilmiş səhifələrin bütün postları, hashtag olmadan'
            checked={Boolean(settings?.instagram_accounts_enabled)}
            disabled={disabled}
            onChange={(next) => mutation.mutate({ instagram_accounts_enabled: next })}
          />
          <PlatformSwitch
            label='Telegram kanalları'
            hint='Açıq kanallar (t.me/s), pulsuz'
            checked={Boolean(settings?.telegram_channels_enabled)}
            disabled={disabled}
            onChange={(next) => mutation.mutate({ telegram_channels_enabled: next })}
          />
        </section>

        <section className='grid content-start gap-3 rounded-lg border bg-card p-4 md:p-5'>
          <h2 className='text-lg font-semibold'>Standart tezlik</h2>
          <p className='text-sm text-muted-foreground'>
            Planında tezlik olmayan müştərilər üçün. Planın tezliyi Abunəliklər
            səhifəsində, müştəriyə fərdi təklif isə istifadəçi səhifəsində
            verilir.
          </p>
          <select
            value={settings?.default_interval_minutes ?? 360}
            disabled={disabled}
            onChange={(event) =>
              mutation.mutate({
                default_interval_minutes: Number(event.target.value),
              })
            }
            className='h-10 rounded-lg border bg-background px-3 text-sm'
            aria-label='Standart tezlik'
          >
            {SOCIAL_INTERVAL_OPTIONS.map((option) => (
              <option key={option.minutes} value={option.minutes}>
                {option.label}
              </option>
            ))}
          </select>
        </section>

        <section className='grid content-start gap-3 rounded-lg border bg-card p-4 md:p-5'>
          <h2 className='text-lg font-semibold'>Aylıq xərc limiti</h2>
          <p className='text-sm text-muted-foreground'>
            Bu ay cəmi: ${spent.toFixed(2)} · {data.usage?.calls ?? 0} sorğu.
            Limit dolanda axtarış ay sonuna qədər dayanır. Boş = limitsiz.
          </p>
          <BudgetBar spent={spent} budget={settings?.monthly_budget_usd} />
          <form
            key={String(settings?.monthly_budget_usd ?? '')}
            onSubmit={saveBudget}
            className='flex gap-2'
          >
            <input
              name='budget'
              type='number'
              min={0}
              step='1'
              inputMode='decimal'
              defaultValue={settings?.monthly_budget_usd ?? ''}
              placeholder='USD'
              aria-label='Aylıq xərc limiti (USD)'
              className='h-10 w-full rounded-lg border bg-background px-3 text-sm'
            />
            <button
              type='submit'
              disabled={disabled}
              className='rounded-lg border bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60'
            >
              Saxla
            </button>
          </form>
          {(
            [
              {
                key: 'facebook_monthly_budget_usd',
                label: 'Facebook aylıq büdcə ($)',
                spent: facebookSpent,
                calls: data.usage?.facebook_calls ?? 0,
              },
              {
                key: 'instagram_monthly_budget_usd',
                label: 'Instagram aylıq büdcə ($)',
                spent: instagramSpent,
                calls: data.usage?.instagram_calls ?? 0,
              },
            ] as const
          ).map((platform) => (
            <div key={platform.key} className='grid gap-2 border-t pt-3'>
              <NumberSetting
                name={platform.key}
                label={platform.label}
                hint={`Bu ay: $${platform.spent.toFixed(2)} · ${platform.calls} sorğu${
                  settings?.[platform.key] != null
                    ? ` / $${Number(settings[platform.key]).toFixed(2)}`
                    : ''
                }. Dolanda yalnız bu platforma dayanır. Boş = limitsiz.`}
                value={settings?.[platform.key]}
                min={0}
                allowEmpty
                disabled={disabled}
                onSave={(value) => mutation.mutate({ [platform.key]: value })}
              />
              <BudgetBar spent={platform.spent} budget={settings?.[platform.key]} />
            </div>
          ))}
        </section>
      </div>

      <section className='grid content-start gap-4 rounded-lg border bg-card p-4 md:p-5'>
        <div>
          <h2 className='text-lg font-semibold'>Facebook xərc nəzarəti</h2>
          <p className='text-sm text-muted-foreground'>
            Apify hər gələn post üçün ödəniş alır (təxminən 1000 post = $2.40).
            Xərc yoxlama tezliyindən və bir yoxlamada gələn post sayından asılıdır.
          </p>
        </div>
        <PlatformSwitch
          label='Yalnız açar sözü olan postlar (FB)'
          hint='Apify yalnız mətnində açar söz olan postları qaytarır. Süzülən postlara görə ödəniş alınıb-alınmadığı təsdiqlənməyib.'
          checked={settings?.fb_must_contain_query ?? true}
          disabled={disabled}
          onChange={(next) => mutation.mutate({ fb_must_contain_query: next })}
        />
        <div className='grid gap-4 md:grid-cols-3'>
          <NumberSetting
            name='fb_min_interval_minutes'
            label='FB minimum yoxlama intervalı (dəq)'
            hint='Plan və ya fərdi tezlik nə olursa olsun, Facebook bundan tez yoxlanmır. Instagram öz tezliyində qalır.'
            value={settings?.fb_min_interval_minutes ?? 360}
            min={10}
            max={10080}
            disabled={disabled}
            onSave={(value) =>
              value != null && mutation.mutate({ fb_min_interval_minutes: value })
            }
          />
          <NumberSetting
            name='fb_max_posts_per_query'
            label='FB: bir yoxlamada maksimum post (hər söz)'
            hint='1–50. Railway-də SOCIAL_MAX_POSTS_PER_QUERY verilibsə, o üstündür.'
            value={settings?.fb_max_posts_per_query ?? 10}
            min={1}
            max={50}
            disabled={disabled}
            onSave={(value) =>
              value != null && mutation.mutate({ fb_max_posts_per_query: value })
            }
          />
          <NumberSetting
            name='fb_daily_posts_per_keyword'
            label='FB: hər söz üçün gündəlik maksimum post'
            hint='Bakı vaxtı ilə gün ərzində bu qədər post gələndən sonra söz sabaha qədər axtarılmır. Boş = limitsiz.'
            value={settings?.fb_daily_posts_per_keyword}
            min={1}
            max={1000}
            allowEmpty
            disabled={disabled}
            onSave={(value) => mutation.mutate({ fb_daily_posts_per_keyword: value })}
          />
        </div>
      </section>

      <section className='rounded-lg border bg-card p-4 md:p-5'>
        <div className='flex flex-wrap items-start justify-between gap-3'>
          <div>
            <h2 className='text-lg font-semibold'>Diaqnostika</h2>
            <p className='text-sm text-muted-foreground'>
              Hər açar sözün son axtarışında postlara nə olduğunu göstərir. Eyni
              açar söz bütün müştərilər üçün bir dəfə axtarılır.
            </p>
          </div>
          <button
            type='button'
            onClick={() => checkMutation.mutate({})}
            disabled={checkMutation.isPending || data.keywords.length === 0}
            className='inline-flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-60'
          >
            <Search className='h-4 w-4' />
            Hamısını indi yoxla
          </button>
        </div>
        {checkMutation.isSuccess ? (
          <p className='mt-2 text-sm text-success'>
            Növbəti dövrdə (5 dəqiqəyə qədər) yenidən axtarılacaq.
          </p>
        ) : null}
        {checkMutation.isError ? (
          <p className='mt-2 text-sm text-destructive' role='alert'>
            {friendlyError(checkMutation.error)}
          </p>
        ) : null}
        <details className='mt-3 text-sm text-muted-foreground'>
          <summary className='cursor-pointer font-medium text-foreground'>
            Sütunlar nə deməkdir?
          </summary>
          <ul className='mt-2 grid gap-1'>
            {STAT_COLUMNS.map((column) => (
              <li key={column.key}>
                <span className='font-medium text-foreground'>{column.label}:</span>{' '}
                {column.hint}
              </li>
            ))}
            <li>
              <span className='font-medium text-foreground'>Təxmini xərc:</span>{' '}
              son yoxlama / bu ay. Facebook: gələn post × $0.0024; Instagram:
              kredit × təxmini qiymət.
            </li>
            <li>
              <span className='font-medium text-foreground'>Instagram:</span>{' '}
              yalnız hashtag axtarılır (#kapitalbank). Hashtag qoyulmayan postlar
              tapılmır.
            </li>
          </ul>
        </details>
        {data.keywords.length === 0 ? (
          <div className='mt-4 rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground'>
            Hələ axtarış olmayıb.
          </div>
        ) : (
          <div className='mt-4 overflow-x-auto'>
            <table className='w-full text-sm'>
              <thead className='text-left text-muted-foreground'>
                <tr className='border-b'>
                  <th className='py-2 pr-3 font-medium'>Platforma</th>
                  <th className='py-2 pr-3 font-medium'>Açar söz</th>
                  <th className='py-2 pr-3 font-medium'>Son yoxlama</th>
                  {STAT_COLUMNS.map((column) => (
                    <th
                      key={column.key}
                      className='py-2 pr-3 text-right font-medium'
                      title={column.hint}
                    >
                      {column.label}
                    </th>
                  ))}
                  <th
                    className='py-2 pr-3 text-right font-medium whitespace-nowrap'
                    title='Son yoxlama / bu ay. Facebook: gələn post × $0.0024; Instagram: kredit × təxmini qiymət.'
                  >
                    Təxmini xərc
                  </th>
                  <th className='py-2 font-medium'>
                    <span className='sr-only'>Əməliyyat</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.keywords.map((row) => {
                  const stats = row.last_stats
                  const samples = stats?.samples ?? []
                  return (
                    <Fragment key={`${row.platform}:${row.keyword_fold}`}>
                      <tr className='border-t align-top'>
                        <td className='py-2 pr-3 capitalize'>{row.platform}</td>
                        <td className='py-2 pr-3 wrap-anywhere'>
                          {row.keyword_fold}
                        </td>
                        <td className='py-2 pr-3 whitespace-nowrap'>
                          {formatDate(row.last_checked_at)}
                        </td>
                        {STAT_COLUMNS.map((column) => (
                          <td
                            key={column.key}
                            className='py-2 pr-3 text-right tabular-nums'
                          >
                            {column.key === 'raw'
                              ? (stats?.raw ?? row.last_result_count ?? '—')
                              : stats
                                ? Number(stats[column.key] ?? 0)
                                : '—'}
                          </td>
                        ))}
                        <td className='py-2 pr-3 text-right tabular-nums whitespace-nowrap'>
                          {formatUsd(stats?.usd)}
                          <span className='text-muted-foreground'>
                            {' / '}
                            {formatUsd(
                              stats?.month === usageKey().slice('social_usage_'.length)
                                ? stats.month_usd
                                : stats
                                  ? 0
                                  : null
                            )}
                          </span>
                        </td>
                        <td className='py-2'>
                          <button
                            type='button'
                            onClick={() =>
                              checkMutation.mutate({
                                platform: row.platform,
                                keyword: row.keyword_fold,
                              })
                            }
                            disabled={checkMutation.isPending}
                            className='rounded-md border px-2 py-1 text-xs font-medium whitespace-nowrap hover:bg-muted disabled:opacity-60'
                          >
                            İndi yoxla
                          </button>
                        </td>
                      </tr>
                      {row.last_error || samples.length > 0 ? (
                        <tr>
                          <td colSpan={STAT_COLUMNS.length + 5} className='pb-3'>
                            {row.last_error ? (
                              <div className='font-mono text-xs wrap-anywhere text-destructive'>
                                Xəta: {row.last_error}
                              </div>
                            ) : null}
                            {samples.length > 0 ? (
                              <details className='text-xs text-muted-foreground'>
                                <summary className='cursor-pointer'>
                                  Gələn postlardan nümunələr ({samples.length})
                                </summary>
                                <ul className='mt-1 grid gap-1'>
                                  {samples.map((item, index) => (
                                    <li key={`${item.url}-${index}`} className='wrap-anywhere'>
                                      {formatDate(item.date)} ·{' '}
                                      {item.url ? (
                                        <a
                                          href={item.url}
                                          target='_blank'
                                          rel='noreferrer'
                                          className='underline underline-offset-2'
                                        >
                                          {item.text || item.url}
                                        </a>
                                      ) : (
                                        item.text || '—'
                                      )}
                                    </li>
                                  ))}
                                </ul>
                              </details>
                            ) : null}
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <WatchedAccounts
        instagramEnabled={Boolean(settings?.instagram_accounts_enabled)}
        telegramEnabled={Boolean(settings?.telegram_channels_enabled)}
      />
    </div>
  )
}

export const Route = createFileRoute('/(auth)/admin/social')({
  component: SocialAdminPage,
})
