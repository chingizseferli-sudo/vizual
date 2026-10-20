import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Loader2, RefreshCw, Share2 } from 'lucide-react'
import { SOCIAL_INTERVAL_OPTIONS } from '@/lib/social-intervals'
import { supabase } from '@/lib/supabase'

const socialAdminQueryKey = ['admin', 'social'] as const

type SocialSettings = {
  facebook_enabled: boolean
  instagram_enabled: boolean
  default_interval_minutes: number
  monthly_budget_usd: number | null
  updated_at: string | null
}

type KeywordState = {
  platform: string
  keyword_fold: string
  last_checked_at: string | null
  last_result_count: number | null
  last_error: string | null
}

type SocialAdminData = {
  settings: SocialSettings | null
  keywords: KeywordState[]
  usage: { usd?: number; calls?: number } | null
  errors: string[]
}

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
  const [settingsResult, keywordsResult, usageResult] = await Promise.all([
    supabase
      .from('social_settings')
      .select(
        'facebook_enabled,instagram_enabled,default_interval_minutes,monthly_budget_usd,updated_at'
      )
      .eq('id', 1)
      .maybeSingle(),
    supabase
      .from('social_keyword_state')
      .select(
        'platform,keyword_fold,last_checked_at,last_result_count,last_error'
      )
      .order('last_checked_at', { ascending: false, nullsFirst: false })
      .limit(200),
    supabase
      .from('bot_runtime_state')
      .select('value')
      .eq('key', usageKey())
      .maybeSingle(),
  ])

  const errors = [
    settingsResult.error && `Tənzimləmələr: ${settingsResult.error.message}`,
    keywordsResult.error && `Açar sözlər: ${keywordsResult.error.message}`,
    usageResult.error && `Xərc: ${usageResult.error.message}`,
  ].filter(Boolean) as string[]

  return {
    settings: (settingsResult.data as SocialSettings | null) ?? null,
    keywords: (keywordsResult.data || []) as KeywordState[],
    usage:
      ((usageResult.data as { value: SocialAdminData['usage'] } | null)
        ?.value as SocialAdminData['usage']) ?? null,
    errors,
  }
}

async function updateSocialSettings(patch: Partial<SocialSettings>) {
  const { data, error } = await supabase
    .from('social_settings')
    .update(patch)
    .eq('id', 1)
    .select('id')

  if (error) throw new Error(error.message)
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
          <div className='mt-1 text-xs'>
            Migrasiya (20261020000001_social_collectors) tətbiq olunmayıbsa, bu
            cədvəllər hələ mövcud deyil.
          </div>
        </div>
      ) : null}

      {mutation.isError ? (
        <p className='text-sm text-destructive' role='alert'>
          Dəyişmədi: {mutation.error.message}
        </p>
      ) : null}

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
        </section>

        <section className='grid content-start gap-3 rounded-lg border bg-card p-4 md:p-5'>
          <h2 className='text-lg font-semibold'>Standart tezlik</h2>
          <p className='text-sm text-muted-foreground'>
            Planında tezlik olmayan müştərilər üçün. Plan tezliyi: Start 6 saat,
            Pro 3 saat, Business 1 saat. Müştəriyə ayrıca tezlik istifadəçi
            səhifəsində verilir.
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
            Bu ay: ${spent.toFixed(2)} · {data.usage?.calls ?? 0} sorğu. Limit
            dolanda axtarış ay sonuna qədər dayanır. Boş = limitsiz.
          </p>
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
        </section>
      </div>

      <section className='rounded-lg border bg-card p-4 md:p-5'>
        <h2 className='text-lg font-semibold'>Açar sözlərin son yoxlanışı</h2>
        <p className='mb-4 text-sm text-muted-foreground'>
          Eyni açar söz bütün müştərilər üçün bir dəfə axtarılır.
        </p>
        {data.keywords.length === 0 ? (
          <div className='rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground'>
            Hələ axtarış olmayıb.
          </div>
        ) : (
          <div className='overflow-x-auto'>
            <table className='w-full text-sm'>
              <thead className='text-left text-muted-foreground'>
                <tr className='border-b'>
                  <th className='py-2 pr-4 font-medium'>Platforma</th>
                  <th className='py-2 pr-4 font-medium'>Açar söz</th>
                  <th className='py-2 pr-4 font-medium'>Son yoxlama</th>
                  <th className='py-2 pr-4 font-medium'>Nəticə</th>
                  <th className='py-2 font-medium'>Xəta</th>
                </tr>
              </thead>
              <tbody>
                {data.keywords.map((row) => (
                  <tr
                    key={`${row.platform}:${row.keyword_fold}`}
                    className='border-b last:border-0'
                  >
                    <td className='py-2 pr-4 capitalize'>{row.platform}</td>
                    <td className='py-2 pr-4'>{row.keyword_fold}</td>
                    <td className='py-2 pr-4 whitespace-nowrap'>
                      {formatDate(row.last_checked_at)}
                    </td>
                    <td className='py-2 pr-4'>
                      {row.last_result_count ?? '—'}
                    </td>
                    <td className='py-2 font-mono text-xs text-destructive'>
                      {row.last_error || ''}
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

export const Route = createFileRoute('/(auth)/admin/social')({
  component: SocialAdminPage,
})
