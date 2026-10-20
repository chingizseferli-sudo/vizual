import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Loader2, Pause, Play, Plus, Search, Trash2 } from 'lucide-react'
import {
  addKeyword,
  type CustomerKeyword,
  deleteKeyword,
  fetchKeywordsData,
  keywordErrorMessage,
  setKeywordStatus,
} from '@/features/keywords/data'
import { customerQueryKeys } from '@/lib/query-keys'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { t } from '@/lib/i18n'

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
      setMessage(
        draft.trim()
          ? t("Bu açar sözlər artıq əlavə edilib.")
          : t("Açar söz yazılmalıdır.")
      )
      return
    }

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
  const limitReached = maxKeywords !== null && activeCount >= maxKeywords

  return (
    <>
      <div className='grid gap-4 p-4 md:p-6'>
        <div>
          <h1 className='text-2xl font-bold tracking-tight'>{t("Açar sözlər")}</h1>
          <p className='text-muted-foreground'>{t("Sistem xəbər saytlarını və sosial şəbəkələri bu açar sözlər üzrə izləyir və uyğun nəticələri sizə göndərir.")}</p>
        </div>

        {query.error ? (
          <div className='rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive'>
            {query.error instanceof Error
              ? query.error.message
              : t("Açar sözlər yüklənmədi.")}
          </div>
        ) : null}

        {message ? (
          <div className='rounded-2xl border border-border bg-card px-4 py-3 text-sm shadow-sm'>
            {message}
          </div>
        ) : null}

        <section className='grid gap-3 rounded-2xl border border-border bg-card p-3 shadow-sm'>
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <h2 className='text-base font-semibold'>{t("Yeni açar söz")}</h2>
            <span
              className={
                limitReached
                  ? 'rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-sm text-amber-700'
                  : 'rounded-full border px-3 py-1 text-sm text-muted-foreground'
              }
            >
              {t("Aktiv açar söz")}: {activeCount}
              {maxKeywords !== null ? ` / ${maxKeywords}` : ''}
            </span>
          </div>
          <div className='grid gap-3 md:grid-cols-[1fr_auto]'>
            <textarea
              aria-label={t("Yeni açar sözlər")}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && event.ctrlKey) void addKeywords()
              }}
              placeholder={t("Açar sözləri vergül və ya yeni sətrlə yaz: təşkilat, brend, şəxs, layihə, dəqiq ifadə")}
              className='min-h-16 rounded-xl border border-border bg-card px-3 py-2 text-sm'
            />
            <button
              type='button'
              onClick={() => void addKeywords()}
              disabled={saving || limitReached}
              className='inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-60'
            >
              {saving ? (
                <Loader2 className='h-4 w-4 animate-spin' />
              ) : (
                <Plus className='h-4 w-4' />
              )}
              {t("Əlavə et")}
            </button>
          </div>
          {limitReached ? (
            <p className='text-sm text-amber-700'>{t("Planınızda açar söz limiti dolub. Bir açar sözü silin, dayandırın və ya planınızı yüksəldin.")}</p>
          ) : null}
          <p className='text-xs text-muted-foreground'>{t("Hər açar söz xəbər saytlarında və Facebook, Instagram paylaşımlarında axtarılır. Sosial şəbəkələrin yoxlanma tezliyi Profil səhifəsində göstərilir. Dayandırılmış açar söz limitə daxil deyil.")}</p>
        </section>

        <section className='grid gap-3 rounded-2xl border border-border bg-card p-3 shadow-sm'>
          <div className='relative'>
            <Search className='pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground' />
            <input
              aria-label={t("Açar söz axtar...")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("Açar söz axtar...")}
              className='w-full rounded-xl border border-border bg-card py-2 pr-3 pl-9'
            />
          </div>

          {keywords.length === 0 ? (
            <div className='rounded-2xl border border-border bg-muted/40 p-4 text-sm text-muted-foreground'>
              {data?.keywords.length
                ? t("Axtarışa uyğun açar söz tapılmadı.")
                : t("Hələ açar söz yoxdur. İlk açar sözü əlavə edin; uyğun nəticələr aşkar olunduqca Nəticələr səhifəsində görünəcək.")}
            </div>
          ) : (
            <ul className='grid gap-2'>
              {keywords.map((item) => (
                <li
                  key={item.id}
                  className='flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2'
                >
                  <div className='flex min-w-0 items-center gap-2'>
                    <span className='truncate font-medium'>{item.keyword}</span>
                    {item.status === 'paused' ? (
                      <span className='rounded-full border px-2 py-0.5 text-xs text-muted-foreground'>
                        {t("Dayandırılıb")}
                      </span>
                    ) : null}
                  </div>
                  <div className='flex items-center gap-1.5'>
                    {data?.statusSupported ? (
                      <button
                        type='button'
                        onClick={() => void toggleKeyword(item)}
                        disabled={busyId === item.id}
                        className='inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-60'
                      >
                        {item.status === 'active' ? (
                          <>
                            <Pause className='h-4 w-4' />
                            {t("Dayandır")}
                          </>
                        ) : (
                          <>
                            <Play className='h-4 w-4' />
                            {t("Davam et")}
                          </>
                        )}
                      </button>
                    ) : null}
                    <button
                      type='button'
                      onClick={() => setDeleteCandidate(item)}
                      disabled={busyId === item.id}
                      className='inline-flex items-center gap-1.5 rounded-lg border border-destructive/40 px-2.5 py-1.5 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-60'
                    >
                      <Trash2 className='h-4 w-4' />
                      {t("Sil")}
                    </button>
                  </div>
                </li>
              ))}
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
