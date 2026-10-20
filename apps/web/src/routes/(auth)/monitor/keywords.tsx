import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import {
  Info,
  KeyRound,
  Loader2,
  Pause,
  Play,
  Plus,
  Search,
  Trash2,
} from 'lucide-react'
import {
  addKeyword,
  type CustomerKeyword,
  deleteKeyword,
  fetchKeywordsData,
  keywordErrorMessage,
  setKeywordStatus,
} from '@/features/keywords/data'
import { customerQueryKeys } from '@/lib/query-keys'
import { cn } from '@/lib/utils'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { t } from '@/lib/i18n'

// The list gets a search box once it is longer than this.
const SEARCH_THRESHOLD = 6

function parseKeywordInput(value: string) {
  const seen = new Set<string>()
  return value
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter((item) => {
      const key = item.toLocaleLowerCase('az-AZ')
      if (!item || seen.has(key)) return false
      seen.add(key)
      return true
    })
}

function KeywordsPage() {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: customerQueryKeys.keywords(),
    queryFn: fetchKeywordsData,
    staleTime: 60 * 1000,
  })
  const [draft, setDraft] = useState('')
  const [search, setSearch] = useState('')
  const [message, setMessage] = useState('')
  const [inputError, setInputError] = useState('')
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [deleteCandidate, setDeleteCandidate] =
    useState<CustomerKeyword | null>(null)

  const data = query.data
  const keywords = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('az-AZ')
    const rows = data?.keywords || []
    return q
      ? rows.filter((item) =>
          item.keyword.toLocaleLowerCase('az-AZ').includes(q)
        )
      : rows
  }, [data, search])

  async function refresh() {
    await queryClient.invalidateQueries({
      queryKey: customerQueryKeys.keywords(),
    })
    void queryClient.invalidateQueries({
      queryKey: customerQueryKeys.dashboard(),
    })
  }

  async function addKeywords() {
    const existing = new Set(
      (data?.keywords || []).map((item) =>
        item.keyword.trim().toLocaleLowerCase('az-AZ')
      )
    )
    const fresh = parseKeywordInput(draft).filter(
      (item) => !existing.has(item.toLocaleLowerCase('az-AZ'))
    )
    if (fresh.length === 0) {
      setInputError(
        draft.trim()
          ? t("Bu açar sözlər artıq əlavə edilib.")
          : t("Açar söz yazılmalıdır.")
      )
      return
    }

    setInputError('')
    setSaving(true)
    let added = 0
    let failure = ''
    for (const keyword of fresh) {
      const error = await addKeyword(keyword)
      if (error) {
        failure = keywordErrorMessage(error)
        break
      }
      added += 1
    }
    setSaving(false)
    await refresh()

    if (added > 0) setDraft('')
    setMessage(
      failure
        ? added > 0
          ? t("{0} açar söz əlavə olundu. {1}", [added, failure])
          : t("Açar söz əlavə olunmadı: {0}", [failure])
        : t("{0} açar söz əlavə olundu. Sistem mənbələri mütəmadi yoxlayacaq.", [added])
    )
  }

  async function toggleKeyword(item: CustomerKeyword) {
    const next = item.status === 'active' ? 'paused' : 'active'
    setBusyId(item.id)
    const error = await setKeywordStatus(item.id, next)
    setBusyId(null)
    if (error) {
      setMessage(keywordErrorMessage(error))
      return
    }
    await refresh()
    setMessage(
      next === 'active'
        ? t("Açar söz yenidən izlənir: {0}", [item.keyword])
        : t("Açar söz dayandırıldı: {0}", [item.keyword])
    )
  }

  async function removeKeyword(item: CustomerKeyword) {
    setBusyId(item.id)
    const error = await deleteKeyword(item.id)
    setBusyId(null)
    setDeleteCandidate(null)
    if (error) {
      setMessage(t("Açar söz silinmədi: {0}", [error.message]))
      return
    }
    await refresh()
    setMessage(t("Açar söz silindi: {0}", [item.keyword]))
  }

  if (query.isLoading) {
    return (
      <div className='flex min-h-[360px] items-center justify-center p-6'>
        <Loader2 className='mr-2 h-5 w-5 animate-spin' />
        <span>{t("Açar sözlər yüklənir...")}</span>
      </div>
    )
  }

  const maxKeywords = data?.maxKeywords ?? null
  const activeCount = data?.activeCount ?? 0
  const totalCount = data?.keywords.length ?? 0
  const limitReached = maxKeywords !== null && activeCount >= maxKeywords
  const usage =
    maxKeywords && maxKeywords > 0
      ? Math.min(100, Math.round((activeCount / maxKeywords) * 100))
      : 0

  return (
    <>
      <div className='mx-auto grid w-full max-w-4xl gap-4 p-4 md:p-6'>
        <div className='flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between'>
          <div className='min-w-0'>
            <h1 className='text-2xl font-bold tracking-tight'>{t("Açar sözlər")}</h1>
            <p className='mt-1 text-sm text-muted-foreground'>{t("Sistem xəbər saytlarını və sosial şəbəkələri bu açar sözlər üzrə izləyir və uyğun nəticələri sizə göndərir.")}</p>
          </div>
          <div className='w-full shrink-0 rounded-xl border bg-card px-3 py-2 shadow-sm sm:w-52'>
            <div className='flex items-baseline justify-between gap-2 text-sm'>
              <span className='text-muted-foreground'>{t("Aktiv açar söz")}</span>
              <span
                className={cn(
                  'font-semibold tabular-nums',
                  limitReached && 'text-amber-700'
                )}
              >
                {activeCount}
                {maxKeywords !== null ? ` / ${maxKeywords}` : ''}
              </span>
            </div>
            {maxKeywords !== null ? (
              <div className='mt-2 h-1.5 overflow-hidden rounded-full bg-muted'>
                <div
                  className={cn(
                    'h-full rounded-full transition-all',
                    limitReached ? 'bg-amber-500' : 'bg-primary'
                  )}
                  style={{ width: `${usage}%` }}
                />
              </div>
            ) : (
              <p className='mt-1 text-xs text-muted-foreground'>{t("Limitsiz")}</p>
            )}
          </div>
        </div>

        {query.error ? (
          <div className='rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive'>
            {query.error instanceof Error
              ? query.error.message
              : t("Açar sözlər yüklənmədi.")}
          </div>
        ) : null}

        {message ? (
          <div
            role='status'
            className='rounded-xl border bg-card px-4 py-3 text-sm shadow-sm'
          >
            {message}
          </div>
        ) : null}

        <section className='grid gap-3 rounded-xl border bg-card p-4 shadow-sm'>
          <h2 className='text-base font-semibold'>{t("Yeni açar söz")}</h2>
          <div className='grid gap-2 sm:grid-cols-[1fr_auto] sm:items-start'>
            <Textarea
              aria-label={t("Yeni açar sözlər")}
              aria-invalid={inputError ? true : undefined}
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value)
                if (inputError) setInputError('')
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && event.ctrlKey) void addKeywords()
              }}
              placeholder={t("Açar sözləri vergül və ya yeni sətrlə yaz: təşkilat, brend, şəxs, layihə, dəqiq ifadə")}
              className='min-h-20 resize-y'
            />
            <Button
              type='button'
              onClick={() => void addKeywords()}
              disabled={saving || limitReached}
              className='h-10 w-full sm:w-auto'
            >
              {saving ? <Loader2 className='animate-spin' /> : <Plus />}
              {t("Əlavə et")}
            </Button>
          </div>
          {inputError ? (
            <p className='text-sm text-destructive'>{inputError}</p>
          ) : null}
          {limitReached ? (
            <p className='rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800'>{t("Planınızda açar söz limiti dolub. Bir açar sözü silin, dayandırın və ya planınızı yüksəldin.")}</p>
          ) : null}
          <div className='flex gap-2 rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground'>
            <Info className='mt-0.5 h-3.5 w-3.5 shrink-0' />
            <p>{t("Hər açar söz xəbər saytlarında və Facebook, Instagram paylaşımlarında axtarılır. Sosial şəbəkələrin yoxlanma tezliyi Profil səhifəsində göstərilir. Dayandırılmış açar söz limitə daxil deyil.")}</p>
          </div>
        </section>

        <section className='grid gap-3 rounded-xl border bg-card p-4 shadow-sm'>
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <h2 className='text-base font-semibold'>
              {t("Sizin açar sözləriniz")}
              {totalCount ? (
                <span className='ml-2 text-sm font-normal text-muted-foreground'>
                  {totalCount}
                </span>
              ) : null}
            </h2>
            {totalCount > SEARCH_THRESHOLD ? (
              <div className='relative w-full sm:w-64'>
                <Search className='pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground' />
                <Input
                  aria-label={t("Açar söz axtar...")}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={t("Açar söz axtar...")}
                  className='pl-9'
                />
              </div>
            ) : null}
          </div>

          {totalCount === 0 ? (
            <div className='flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-10 text-center'>
              <div className='flex h-10 w-10 items-center justify-center rounded-full bg-muted'>
                <KeyRound className='h-5 w-5 text-muted-foreground' />
              </div>
              <p className='font-medium'>{t("Açar söz yoxdur")}</p>
              <p className='max-w-sm text-sm text-muted-foreground'>{t("İlk açar sözü yuxarıda əlavə edin. Uyğun nəticələr tapıldıqca Nəticələr səhifəsində görünəcək.")}</p>
            </div>
          ) : keywords.length === 0 ? (
            <p className='rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground'>
              {t("Axtarışa uyğun açar söz tapılmadı.")}
            </p>
          ) : (
            <ul className='divide-y rounded-lg border'>
              {keywords.map((item) => {
                const paused = item.status === 'paused'
                const busy = busyId === item.id
                return (
                  <li
                    key={item.id}
                    className='flex items-center gap-3 px-3 py-2.5'
                  >
                    <div className='flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-2'>
                      <span
                        className={cn(
                          'font-medium break-words',
                          paused && 'text-muted-foreground'
                        )}
                      >
                        {item.keyword}
                      </span>
                      <span
                        className={cn(
                          'inline-flex w-fit items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium',
                          paused
                            ? 'bg-muted text-muted-foreground'
                            : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        )}
                      >
                        <span
                          className={cn(
                            'h-1.5 w-1.5 rounded-full',
                            paused ? 'bg-muted-foreground/60' : 'bg-emerald-500'
                          )}
                        />
                        {paused ? t("Dayandırılıb") : t("Aktiv")}
                      </span>
                    </div>
                    <div className='flex shrink-0 items-center gap-1'>
                      {data?.statusSupported ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              type='button'
                              variant='ghost'
                              size='icon'
                              aria-label={paused ? t("Davam et") : t("Dayandır")}
                              onClick={() => void toggleKeyword(item)}
                              disabled={busy}
                            >
                              {busy ? (
                                <Loader2 className='animate-spin' />
                              ) : paused ? (
                                <Play />
                              ) : (
                                <Pause />
                              )}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            {paused ? t("Davam et") : t("Dayandır")}
                          </TooltipContent>
                        </Tooltip>
                      ) : null}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type='button'
                            variant='ghost'
                            size='icon'
                            aria-label={t("Sil")}
                            onClick={() => setDeleteCandidate(item)}
                            disabled={busy}
                            className='text-destructive hover:bg-destructive/10 hover:text-destructive'
                          >
                            <Trash2 />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{t("Sil")}</TooltipContent>
                      </Tooltip>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>

      <ConfirmDialog
        open={!!deleteCandidate}
        onOpenChange={(open) => {
          if (!open) setDeleteCandidate(null)
        }}
        title={t("Açar sözü sil")}
        desc={
          deleteCandidate
            ? t("\"{0}\" açar sözü silinsin?", [deleteCandidate.keyword])
            : ''
        }
        cancelBtnText={t("Ləğv et")}
        confirmText={t("Sil")}
        destructive
        isLoading={deleteCandidate ? busyId === deleteCandidate.id : false}
        handleConfirm={() => {
          if (deleteCandidate) void removeKeyword(deleteCandidate)
        }}
        className='sm:max-w-md'
      />
    </>
  )
}

export const Route = createFileRoute('/(auth)/monitor/keywords')({
  component: KeywordsPage,
})
