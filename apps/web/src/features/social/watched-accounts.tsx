import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pause, Play, Plus, Search, Trash2, Users } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { friendlyError } from '@/lib/friendly-error'
import { isMissingTableError } from '@/lib/social-intervals'
import {
  WATCHED_DEFAULT_INTERVAL,
  WATCHED_PLATFORM_LABELS,
  isValidWatchedHandle,
  normalizeWatchedHandle,
  parseWatchedInterval,
  watchedAccountUrl,
  type WatchedPlatform,
} from './watched-accounts-model'
import { CheckCostDialog, type CheckBudgets } from './check-cost-dialog'

const watchedQueryKey = ['admin', 'social', 'watched'] as const

type WatchedStats = {
  raw?: number
  stored?: number
  alerted?: number
  too_old?: number
  no_match?: number
}

type WatchedAccount = {
  id: string
  platform: WatchedPlatform
  handle: string
  display_name: string | null
  active: boolean
  check_interval_minutes: number | null
  last_checked_at: string | null
  last_error: string | null
  last_post_count: number | null
  last_stats: WatchedStats | null
}

type WatchedData = { accounts: WatchedAccount[]; missing: boolean }

async function fetchWatched(): Promise<WatchedData> {
  const { data, error } = await supabase
    .from('social_watched_accounts')
    .select('*')
    .order('platform')
    .order('handle')
  if (error) {
    if (isMissingTableError(error)) return { accounts: [], missing: true }
    throw error
  }
  return { accounts: (data || []) as WatchedAccount[], missing: false }
}

function formatDate(value: string | null) {
  if (!value) return 'hələ yox'
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

function errorText(error: string | null) {
  if (!error) return null
  if (error === 'telegram:no_preview')
    return 'Kanalın açıq önizləməsi yoxdur və ya ad səhvdir (t.me/s/… açılmır).'
  if (error === 'profile:private') return 'Səhifə gizlidir (private): oxunmur.'
  if (error === 'profile:not_found') return 'Belə Instagram səhifəsi tapılmadı.'
  return `Xəta: ${error}`
}

export function WatchedAccounts({
  instagramEnabled,
  telegramEnabled,
  budgets,
}: {
  instagramEnabled: boolean
  telegramEnabled: boolean
  budgets: CheckBudgets
}) {
  const queryClient = useQueryClient()
  const { data, isLoading, error } = useQuery({
    queryKey: watchedQueryKey,
    queryFn: fetchWatched,
    refetchInterval: 60 * 1000,
  })
  const [platform, setPlatform] = useState<WatchedPlatform>('instagram')
  const [handle, setHandle] = useState('')
  const [name, setName] = useState('')
  const [interval, setIntervalValue] = useState('')
  const [formError, setFormError] = useState('')

  const invalidate = () => queryClient.invalidateQueries({ queryKey: watchedQueryKey })
  const addMutation = useMutation({
    mutationFn: async (row: Partial<WatchedAccount>) => {
      const { error: insertError } = await supabase.from('social_watched_accounts').insert(row)
      if (insertError) throw insertError
    },
    onSuccess: () => {
      setHandle('')
      setName('')
      setIntervalValue('')
    },
    onSettled: invalidate,
  })
  const updateMutation = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<WatchedAccount> }) => {
      const { error: updateError } = await supabase
        .from('social_watched_accounts')
        .update(patch)
        .eq('id', id)
      if (updateError) throw updateError
    },
    onSettled: invalidate,
  })
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error: deleteError } = await supabase
        .from('social_watched_accounts')
        .delete()
        .eq('id', id)
      if (deleteError) throw deleteError
    },
    onSettled: invalidate,
  })
  const checkMutation = useMutation({
    mutationFn: async (target: { platform?: WatchedPlatform; id?: string }) => {
      const { error: rpcError } = await supabase.rpc('admin_social_account_check_now', {
        p_platform: target.platform ?? null,
        p_id: target.id ?? null,
      })
      if (rpcError) throw rpcError
    },
    onSettled: invalidate,
  })

  // Reading Instagram pages costs SocialFetch credits, so it asks first;
  // Telegram is free and runs at once.
  const [pendingCheck, setPendingCheck] = useState<{ id?: string; pages: number } | null>(null)
  function requestCheck(target: { id?: string }) {
    const pages = (data?.accounts ?? []).filter(
      (account) =>
        account.platform === 'instagram' &&
        account.active &&
        (!target.id || account.id === target.id)
    ).length
    if (instagramEnabled && pages > 0) setPendingCheck({ ...target, pages })
    else checkMutation.mutate(target)
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalized = normalizeWatchedHandle(handle)
    if (!isValidWatchedHandle(normalized)) {
      setFormError('Ad yalnız hərf, rəqəm, nöqtə və alt xətdən ibarət olmalıdır (məs. report.az).')
      return
    }
    const minutes = parseWatchedInterval(interval)
    if (minutes === 'invalid') {
      setFormError('Tezlik 5 ilə 10080 dəqiqə arasında tam ədəd olmalıdır.')
      return
    }
    setFormError('')
    addMutation.mutate({
      platform,
      handle: normalized,
      display_name: name.trim() || null,
      check_interval_minutes: minutes,
    })
  }

  const mutationError =
    addMutation.error || updateMutation.error || deleteMutation.error || checkMutation.error

  return (
    <section className='rounded-lg border bg-card p-4 md:p-5'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div>
          <div className='flex items-center gap-2'>
            <Users className='h-5 w-5 text-muted-foreground' />
            <h2 className='text-lg font-semibold'>İzlənən səhifə və kanallar</h2>
          </div>
          <p className='mt-1 text-sm text-muted-foreground'>
            Instagram səhifələrinin bütün postları oxunur və mətndə açar söz axtarılır:
            hashtag olmasa da tapılır, müştəriyə IG linki gedir (yalnız FB/IG açar sözləri).
            Telegram kanalları pulsuz oxunur və xəbər saytı kimi bütün açar sözlərə uyğunlaşdırılır.
          </p>
          <p className='mt-1 text-xs text-muted-foreground'>
            Hər səhifə bütün müştərilər üçün bir dəfə oxunur. Instagram: hər oxuma 1 SocialFetch
            krediti. Standart tezlik: Instagram {WATCHED_DEFAULT_INTERVAL.instagram} dəq,
            Telegram {WATCHED_DEFAULT_INTERVAL.telegram} dəq.
          </p>
          {!instagramEnabled || !telegramEnabled ? (
            <p className='mt-1 text-xs text-warning'>
              {!instagramEnabled ? 'Instagram səhifələri söndürülüb. ' : ''}
              {!telegramEnabled ? 'Telegram kanalları söndürülüb. ' : ''}
              Yuxarıda «Platformalar» bölməsində yandırın.
            </p>
          ) : null}
        </div>
        <button
          type='button'
          onClick={() => requestCheck({})}
          disabled={checkMutation.isPending || !data?.accounts.length}
          className='inline-flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-60'
        >
          <Search className='h-4 w-4' />
          Hamısını indi yoxla
        </button>
      </div>

      {data?.missing ? (
        <div className='mt-4 rounded-lg border border-destructive/25 bg-destructive/10 p-3 text-sm text-destructive'>
          Bu bölmənin cədvəli bazada hələ yoxdur. «npx supabase db push» edin, sonra səhifəni yeniləyin.
        </div>
      ) : null}
      {error ? (
        <p className='mt-3 text-sm text-destructive' role='alert'>
          {friendlyError(error)}
        </p>
      ) : null}

      <form onSubmit={submit} className='mt-4 grid gap-2 sm:grid-cols-[auto_1fr_1fr_8rem_auto]'>
        <select
          value={platform}
          onChange={(event) => setPlatform(event.target.value as WatchedPlatform)}
          aria-label='Platforma'
          className='h-10 rounded-lg border bg-background px-3 text-sm'
        >
          <option value='instagram'>Instagram</option>
          <option value='telegram'>Telegram</option>
        </select>
        <input
          value={handle}
          onChange={(event) => setHandle(event.target.value)}
          placeholder={platform === 'instagram' ? 'report.az və ya səhifə linki' : 'apa_az və ya t.me linki'}
          aria-label='Səhifə / kanal adı'
          className='h-10 min-w-0 rounded-lg border bg-background px-3 text-sm'
          required
        />
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder='Görünən ad (istəyə görə)'
          aria-label='Görünən ad'
          maxLength={120}
          className='h-10 min-w-0 rounded-lg border bg-background px-3 text-sm'
        />
        <input
          value={interval}
          onChange={(event) => setIntervalValue(event.target.value)}
          placeholder={`${WATCHED_DEFAULT_INTERVAL[platform]} dəq`}
          aria-label='Tezlik (dəqiqə)'
          inputMode='numeric'
          className='h-10 min-w-0 rounded-lg border bg-background px-3 text-sm'
        />
        <button
          type='submit'
          disabled={addMutation.isPending || Boolean(data?.missing)}
          className='inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60'
        >
          <Plus className='h-4 w-4' />
          Əlavə et
        </button>
      </form>
      {formError ? (
        <p className='mt-2 text-sm text-destructive' role='alert'>
          {formError}
        </p>
      ) : null}
      {mutationError ? (
        <p className='mt-2 text-sm text-destructive' role='alert'>
          {friendlyError(mutationError)}
        </p>
      ) : null}
      {checkMutation.isSuccess ? (
        <p className='mt-2 text-sm text-success'>Növbəti dövrdə (5 dəqiqəyə qədər) yenidən oxunacaq.</p>
      ) : null}

      {isLoading ? (
        <p className='mt-4 text-sm text-muted-foreground'>Yüklənir...</p>
      ) : data && data.accounts.length === 0 && !data.missing ? (
        <div className='mt-4 rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground'>
          Hələ səhifə və ya kanal əlavə olunmayıb.
        </div>
      ) : data && data.accounts.length > 0 ? (
        <div className='mt-4 overflow-x-auto'>
          <table className='w-full text-sm'>
            <thead className='text-left text-muted-foreground'>
              <tr className='border-b'>
                <th className='py-2 pr-3 font-medium'>Növ</th>
                <th className='py-2 pr-3 font-medium'>Səhifə / kanal</th>
                <th className='py-2 pr-3 font-medium'>Tezlik</th>
                <th className='py-2 pr-3 font-medium'>Son oxuma</th>
                <th className='py-2 pr-3 text-right font-medium' title='Son oxumada gələn post sayı'>Gələn</th>
                <th className='py-2 pr-3 text-right font-medium' title='Yeni və uyğun postlar'>Yeni</th>
                <th className='py-2 pr-3 text-right font-medium' title='Telegram-a gedən bildirişlər'>Bildiriş</th>
                <th className='py-2 font-medium'>
                  <span className='sr-only'>Əməliyyat</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.accounts.map((account) => {
                const problem = errorText(account.last_error)
                return (
                  <tr key={account.id} className={`border-t align-top ${account.active ? '' : 'opacity-60'}`}>
                    <td className='py-2 pr-3 whitespace-nowrap'>{WATCHED_PLATFORM_LABELS[account.platform]}</td>
                    <td className='py-2 pr-3'>
                      <a
                        href={watchedAccountUrl(account.platform, account.handle)}
                        target='_blank'
                        rel='noreferrer'
                        className='font-medium underline underline-offset-2'
                      >
                        {account.display_name || account.handle}
                      </a>
                      {account.display_name ? (
                        <div className='text-xs text-muted-foreground'>@{account.handle}</div>
                      ) : null}
                      {!account.active ? <div className='text-xs text-muted-foreground'>Dayandırılıb</div> : null}
                      {problem ? <div className='text-xs text-destructive'>{problem}</div> : null}
                    </td>
                    <td className='py-2 pr-3 whitespace-nowrap'>
                      {account.check_interval_minutes ?? WATCHED_DEFAULT_INTERVAL[account.platform]} dəq
                    </td>
                    <td className='py-2 pr-3 whitespace-nowrap'>{formatDate(account.last_checked_at)}</td>
                    <td className='py-2 pr-3 text-right tabular-nums'>{account.last_post_count ?? '—'}</td>
                    <td className='py-2 pr-3 text-right tabular-nums'>{account.last_stats?.stored ?? '—'}</td>
                    <td className='py-2 pr-3 text-right tabular-nums'>{account.last_stats?.alerted ?? '—'}</td>
                    <td className='py-2'>
                      <div className='flex justify-end gap-1'>
                        <button
                          type='button'
                          onClick={() => requestCheck({ id: account.id })}
                          disabled={checkMutation.isPending || !account.active}
                          className='rounded-md border px-2 py-1 text-xs font-medium whitespace-nowrap hover:bg-muted disabled:opacity-60'
                        >
                          İndi yoxla
                        </button>
                        <button
                          type='button'
                          onClick={() =>
                            updateMutation.mutate({ id: account.id, patch: { active: !account.active } })
                          }
                          disabled={updateMutation.isPending}
                          title={account.active ? 'Dayandır' : 'Davam etdir'}
                          aria-label={account.active ? 'Dayandır' : 'Davam etdir'}
                          className='rounded-md border p-1.5 hover:bg-muted disabled:opacity-60'
                        >
                          {account.active ? <Pause className='h-3.5 w-3.5' /> : <Play className='h-3.5 w-3.5' />}
                        </button>
                        <button
                          type='button'
                          onClick={() => {
                            if (window.confirm(`${account.handle} siyahıdan silinsin?`)) {
                              deleteMutation.mutate(account.id)
                            }
                          }}
                          disabled={deleteMutation.isPending}
                          title='Sil'
                          aria-label='Sil'
                          className='rounded-md border p-1.5 text-destructive hover:bg-destructive/10 disabled:opacity-60'
                        >
                          <Trash2 className='h-3.5 w-3.5' />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      <CheckCostDialog
        open={pendingCheck !== null}
        onOpenChange={(open) => {
          if (!open) setPendingCheck(null)
        }}
        title={pendingCheck?.id ? 'Bu səhifə indi oxunsun?' : 'Bütün səhifələr indi oxunsun?'}
        scope={{ instagramPages: pendingCheck?.pages ?? 0 }}
        fbMaxPostsPerQuery={1}
        budgets={budgets}
        isLoading={checkMutation.isPending}
        onConfirm={() => {
          if (pendingCheck) checkMutation.mutate({ id: pendingCheck.id })
          setPendingCheck(null)
        }}
      />
    </section>
  )
}
