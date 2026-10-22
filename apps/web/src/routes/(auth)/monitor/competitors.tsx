import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import {
  ExternalLink,
  Info,
  Loader2,
  Pencil,
  Plus,
  Sparkles,
  Swords,
  Trash2,
  X,
} from 'lucide-react'
import { dateLocale, t } from '@/lib/i18n'
import { customerQueryKeys } from '@/lib/query-keys'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { ConfirmDialog } from '@/components/confirm-dialog'
import {
  addCompetitor,
  type Competitor,
  type CompetitorHeadline,
  competitorErrorMessage,
  deleteCompetitor,
  type EntityStats,
  fetchCompetitorsData,
  parseCompetitorKeywords,
  type Sentiment,
  toneShares,
  updateCompetitor,
} from '@/features/competitors/data'
import { friendlyError } from '@/lib/friendly-error'

const HEADLINES_PER_COMPETITOR = 5
const PERIODS = [7, 30] as const
type Period = (typeof PERIODS)[number]

// Tone is polarity: two poles and a gray middle; unlabelled stays muted.
const TONES = [
  {
    key: 'positive',
    label: 'Müsbət',
    bar: 'bg-emerald-500',
    dot: 'bg-emerald-500',
  },
  {
    key: 'neutral',
    label: 'Neytral',
    bar: 'bg-slate-400',
    dot: 'bg-slate-400',
  },
  { key: 'negative', label: 'Mənfi', bar: 'bg-rose-500', dot: 'bg-rose-500' },
  {
    key: 'unlabelled',
    label: 'Təhlil olunmayıb',
    bar: 'bg-muted-foreground/20',
    dot: 'bg-muted-foreground/30',
  },
] as const

function formatDate(value: string | null, withTime = false) {
  if (!value) return ''
  return new Date(value).toLocaleString(dateLocale(), {
    day: '2-digit',
    month: '2-digit',
    year: withTime ? undefined : 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  })
}

function entityName(row: EntityStats) {
  return row.kind === 'own'
    ? t('Sizin açar sözləriniz')
    : row.name || t('Rəqib')
}

function sentimentLabel(sentiment: Sentiment | null) {
  const tone = TONES.find((item) => item.key === (sentiment ?? 'unlabelled'))
  return t(tone?.label || 'Təhlil olunmayıb')
}

function ToneBar({ row }: { row: EntityStats }) {
  const shares = toneShares(row)
  if (!shares) {
    return <div className='h-2.5 rounded-full bg-muted' aria-hidden='true' />
  }
  const segments = TONES.map((tone) => ({
    ...tone,
    value: shares[tone.key],
  })).filter((segment) => segment.value > 0)
  return (
    <div
      className='flex h-2.5 gap-0.5 overflow-hidden rounded-full'
      role='img'
      aria-label={segments
        .map((segment) => `${t(segment.label)} ${Math.round(segment.value)}%`)
        .join(', ')}
    >
      {segments.map((segment) => (
        <Tooltip key={segment.key}>
          <TooltipTrigger asChild>
            <div
              className={cn(
                'h-full first:rounded-l-full last:rounded-r-full',
                segment.bar
              )}
              style={{ width: `${segment.value}%` }}
            />
          </TooltipTrigger>
          <TooltipContent>
            {t(segment.label)}: {Math.round(segment.value)}%
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  )
}

function Comparison({ rows, period }: { rows: EntityStats[]; period: Period }) {
  const max = Math.max(1, ...rows.map((row) => row.mentions))
  return (
    <div className='grid gap-4'>
      <ul className='grid gap-3'>
        {rows.map((row) => {
          const shares = toneShares(row)
          return (
            <li
              key={row.competitor_id || 'own'}
              className='grid gap-1.5 sm:grid-cols-[minmax(0,11rem)_1fr_minmax(0,1fr)] sm:items-center sm:gap-4'
            >
              <span
                className={cn(
                  'truncate text-sm',
                  row.kind === 'own' ? 'font-semibold' : 'font-medium'
                )}
              >
                {entityName(row)}
              </span>
              <div className='flex items-center gap-2'>
                <div className='h-2.5 flex-1 rounded-full bg-muted/60'>
                  <div
                    className='h-full rounded-full bg-primary'
                    style={{ width: `${(row.mentions / max) * 100}%` }}
                  />
                </div>
                <span className='w-10 text-right text-sm font-semibold tabular-nums'>
                  {row.mentions}
                </span>
              </div>
              <div className='grid gap-1'>
                <ToneBar row={row} />
                <span className='text-xs text-muted-foreground'>
                  {shares
                    ? t('{0}% müsbət · {1}% mənfi', [
                        Math.round(shares.positive),
                        Math.round(shares.negative),
                      ])
                    : t('Son {0} gündə xəbər yoxdur', [period])}
                </span>
              </div>
            </li>
          )
        })}
      </ul>
      <div className='flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground'>
        <span className='flex items-center gap-1.5'>
          <span className='h-2 w-4 rounded-full bg-primary' />
          {t('Xəbər sayı')}
        </span>
        {TONES.map((tone) => (
          <span key={tone.key} className='flex items-center gap-1.5'>
            <span className={cn('h-2 w-2 rounded-full', tone.dot)} />
            {t(tone.label)}
          </span>
        ))}
      </div>
    </div>
  )
}

type DraftState = { name: string; keywords: string }

function CompetitorForm({
  initial,
  busy,
  disabled,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: DraftState
  busy: boolean
  disabled?: boolean
  submitLabel: string
  onSubmit: (name: string, keywords: string[]) => Promise<string | null>
  onCancel?: () => void
}) {
  const [draft, setDraft] = useState(initial)
  const [error, setError] = useState('')

  async function submit() {
    const name = draft.name.trim()
    const keywords = parseCompetitorKeywords(draft.keywords)
    if (!name) {
      setError(t('Rəqibin adını yazın.'))
      return
    }
    if (keywords.length > 3) {
      setError(t('Hər rəqib üçün ən çox 3 açar söz yazmaq olar.'))
      return
    }
    setError('')
    const failure = await onSubmit(name, keywords)
    if (failure) setError(failure)
    else if (!onCancel) setDraft({ name: '', keywords: '' })
  }

  return (
    <div className='grid gap-2'>
      <div className='grid gap-2 sm:grid-cols-[minmax(0,14rem)_1fr_auto] sm:items-start'>
        <Input
          aria-label={t('Rəqibin adı')}
          placeholder={t('Rəqibin adı, məs. Bakcell')}
          value={draft.name}
          maxLength={80}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          disabled={disabled}
        />
        <Input
          aria-label={t('Açar sözlər')}
          placeholder={t('Açar sözlər: vergüllə, ən çox 3')}
          value={draft.keywords}
          onChange={(event) =>
            setDraft({ ...draft, keywords: event.target.value })
          }
          onKeyDown={(event) => {
            if (event.key === 'Enter') void submit()
          }}
          disabled={disabled}
        />
        <div className='flex gap-2'>
          <Button
            type='button'
            onClick={() => void submit()}
            disabled={busy || disabled}
            className='h-9 flex-1 sm:flex-none'
          >
            {busy ? (
              <Loader2 className='animate-spin' />
            ) : onCancel ? null : (
              <Plus />
            )}
            {submitLabel}
          </Button>
          {onCancel ? (
            <Button
              type='button'
              variant='outline'
              className='h-9'
              onClick={onCancel}
            >
              {t('Ləğv et')}
            </Button>
          ) : null}
        </div>
      </div>
      {error ? <p className='text-sm text-destructive'>{error}</p> : null}
    </div>
  )
}

function CompetitorCard({
  competitor,
  paused,
  stats,
  headlines,
  busy,
  onSave,
  onDelete,
}: {
  competitor: Competitor
  paused: boolean
  stats: { week: number; month: number }
  headlines: CompetitorHeadline[]
  busy: boolean
  onSave: (name: string, keywords: string[]) => Promise<string | null>
  onDelete: () => void
}) {
  const [editing, setEditing] = useState(false)

  return (
    <li className='grid content-start gap-3 rounded-xl border bg-card p-4 shadow-sm'>
      <div className='flex items-start gap-3'>
        <div className='min-w-0 flex-1'>
          <div className='flex flex-wrap items-center gap-2'>
            <h3 className='font-semibold break-words'>{competitor.name}</h3>
            {paused ? (
              <span className='inline-flex items-center rounded-full border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground'>
                {t('Plan limitinə görə dayandırılıb')}
              </span>
            ) : null}
          </div>
          <div className='mt-1.5 flex flex-wrap gap-1.5'>
            {competitor.keywords.map((keyword) => (
              <span
                key={keyword}
                className='rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground'
              >
                {keyword}
              </span>
            ))}
          </div>
        </div>
        <div className='flex shrink-0 items-center gap-1'>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type='button'
                variant='ghost'
                size='icon'
                aria-label={editing ? t('Bağla') : t('Düzəliş et')}
                onClick={() => setEditing(!editing)}
                disabled={busy}
              >
                {editing ? <X /> : <Pencil />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {editing ? t('Bağla') : t('Düzəliş et')}
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type='button'
                variant='ghost'
                size='icon'
                aria-label={t('Sil')}
                onClick={onDelete}
                disabled={busy}
                className='text-destructive hover:bg-destructive/10 hover:text-destructive'
              >
                <Trash2 />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('Sil')}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {editing ? (
        <CompetitorForm
          initial={{
            name: competitor.name,
            keywords: competitor.keywords.join(', '),
          }}
          busy={busy}
          submitLabel={t('Yadda saxla')}
          onSubmit={async (name, keywords) => {
            const failure = await onSave(name, keywords)
            if (!failure) setEditing(false)
            return failure
          }}
          onCancel={() => setEditing(false)}
        />
      ) : null}

      <div className='grid grid-cols-2 gap-2'>
        <div className='rounded-lg bg-muted/50 px-3 py-2'>
          <div className='text-xs text-muted-foreground'>{t('Son 7 gün')}</div>
          <div className='text-lg font-semibold tabular-nums'>{stats.week}</div>
        </div>
        <div className='rounded-lg bg-muted/50 px-3 py-2'>
          <div className='text-xs text-muted-foreground'>{t('Son 30 gün')}</div>
          <div className='text-lg font-semibold tabular-nums'>
            {stats.month}
          </div>
        </div>
      </div>

      {headlines.length ? (
        <ul className='grid gap-1.5'>
          {headlines.map((item) => (
            <li key={item.url} className='flex items-start gap-2 text-sm'>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className={cn(
                      'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                      TONES.find(
                        (tone) => tone.key === (item.sentiment ?? 'unlabelled')
                      )?.dot
                    )}
                    aria-label={sentimentLabel(item.sentiment)}
                  />
                </TooltipTrigger>
                <TooltipContent>
                  {sentimentLabel(item.sentiment)}
                </TooltipContent>
              </Tooltip>
              <a
                href={item.url}
                target='_blank'
                rel='noreferrer'
                className='min-w-0 flex-1 break-words hover:underline'
              >
                {item.title}
                <ExternalLink className='ml-1 inline h-3 w-3 text-muted-foreground' />
              </a>
              <span className='shrink-0 text-xs text-muted-foreground tabular-nums'>
                {formatDate(item.at, true)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className='text-sm text-muted-foreground'>
          {paused
            ? t('Bu rəqib planınızın limitindən artıq olduğu üçün izlənmir.')
            : t(
                'Hələ xəbər tapılmayıb. Yeni xəbərlər çıxdıqca burada görünəcək.'
              )}
        </p>
      )}
    </li>
  )
}

function CompetitorsPage() {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: customerQueryKeys.competitors(),
    queryFn: fetchCompetitorsData,
    staleTime: 60 * 1000,
  })
  const [period, setPeriod] = useState<Period>(7)
  const [message, setMessage] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [deleteCandidate, setDeleteCandidate] = useState<Competitor | null>(
    null
  )

  const data = query.data
  const limit = data?.limit ?? null
  const competitors = useMemo(() => data?.competitors ?? [], [data])
  const headlinesByCompetitor = useMemo(() => {
    const grouped = new Map<string, CompetitorHeadline[]>()
    for (const item of data?.headlines ?? []) {
      const list = grouped.get(item.competitorId) ?? []
      if (list.length < HEADLINES_PER_COMPETITOR) list.push(item)
      grouped.set(item.competitorId, list)
    }
    return grouped
  }, [data])
  const mentions = useMemo(() => {
    const counts = new Map<string, { week: number; month: number }>()
    for (const row of data?.stats[7] ?? []) {
      if (row.competitor_id)
        counts.set(row.competitor_id, { week: row.mentions, month: 0 })
    }
    for (const row of data?.stats[30] ?? []) {
      if (!row.competitor_id) continue
      counts.set(row.competitor_id, {
        week: counts.get(row.competitor_id)?.week ?? 0,
        month: row.mentions,
      })
    }
    return counts
  }, [data])
  const comparisonRows = useMemo(() => {
    const rows = data?.stats[period] ?? []
    const order = new Map(competitors.map((item, index) => [item.id, index]))
    return [...rows].sort((a, b) =>
      a.kind === 'own'
        ? -1
        : b.kind === 'own'
          ? 1
          : (order.get(a.competitor_id || '') ?? 0) -
            (order.get(b.competitor_id || '') ?? 0)
    )
  }, [data, period, competitors])

  async function refresh() {
    await queryClient.invalidateQueries({
      queryKey: customerQueryKeys.competitors(),
    })
  }

  async function add(name: string, keywords: string[]) {
    setBusyId('new')
    const error = await addCompetitor(name, keywords)
    setBusyId(null)
    if (error) return competitorErrorMessage(error)
    await refresh()
    setMessage(
      t('Rəqib əlavə olundu: {0}. Yeni xəbərlər tapıldıqca burada görünəcək.', [
        name,
      ])
    )
    return null
  }

  async function save(
    competitor: Competitor,
    name: string,
    keywords: string[]
  ) {
    setBusyId(competitor.id)
    const error = await updateCompetitor(competitor.id, name, keywords)
    setBusyId(null)
    if (error) return competitorErrorMessage(error)
    await refresh()
    setMessage(t('Rəqib yeniləndi: {0}', [name]))
    return null
  }

  async function remove(competitor: Competitor) {
    setBusyId(competitor.id)
    const error = await deleteCompetitor(competitor.id)
    setBusyId(null)
    setDeleteCandidate(null)
    if (error) {
      setMessage(competitorErrorMessage(error))
      return
    }
    await refresh()
    setMessage(t('Rəqib silindi: {0}', [competitor.name]))
  }

  if (query.isLoading) {
    return (
      <div className='flex min-h-[360px] items-center justify-center p-6'>
        <Loader2 className='mr-2 h-5 w-5 animate-spin' />
        <span>{t('Rəqiblər yüklənir...')}</span>
      </div>
    )
  }

  const noAccess = limit === 0
  const limitReached = limit !== null && competitors.length >= limit
  const tracked = (index: number) => limit === null || index < limit

  return (
    <>
      <div className='mx-auto grid w-full max-w-5xl gap-4 p-4 md:p-6'>
        <div className='flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between'>
          <div className='min-w-0'>
            <h1 className='text-2xl font-bold tracking-tight'>
              {t('Rəqiblər')}
            </h1>
            <p className='mt-1 text-sm text-muted-foreground'>
              {t(
                'Rəqiblərinizin xəbər saytlarında nə qədər və hansı tonda keçdiyini öz açar sözlərinizlə müqayisə edin.'
              )}
            </p>
          </div>
          {!noAccess ? (
            <div className='w-full shrink-0 rounded-xl border bg-card px-3 py-2 shadow-sm sm:w-44'>
              <div className='flex items-baseline justify-between gap-2 text-sm'>
                <span className='text-muted-foreground'>{t('Rəqib')}</span>
                <span
                  className={cn(
                    'font-semibold tabular-nums',
                    limitReached && 'text-amber-700'
                  )}
                >
                  {competitors.length}
                  {limit !== null ? ` / ${limit}` : ''}
                </span>
              </div>
            </div>
          ) : null}
        </div>

        {query.error ? (
          <div className='rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive'>
            {query.error instanceof Error
              ? friendlyError(query.error)
              : t('Rəqiblər yüklənmədi.')}
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

        {noAccess ? (
          <section className='flex flex-col items-start gap-3 rounded-xl border bg-card p-5 shadow-sm sm:flex-row sm:items-center'>
            <div className='flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10'>
              <Swords className='h-5 w-5 text-primary' />
            </div>
            <div className='min-w-0 flex-1'>
              <p className='font-semibold'>
                {t('Rəqib izləmə Pro və Biznes planlarındadır')}
              </p>
              <p className='mt-1 text-sm text-muted-foreground'>
                {t(
                  'Pro planında 3, Biznes planında 5 rəqib izləyə, onların xəbərlərinin sayını və tonunu öz brendinizlə müqayisə edə və hər gün AI xülasəsi ala bilərsiniz.'
                )}
              </p>
            </div>
            <Button asChild variant='outline' className='shrink-0'>
              <Link to='/pricing'>{t('Planlara bax')}</Link>
            </Button>
          </section>
        ) : (
          <section className='grid gap-3 rounded-xl border bg-card p-4 shadow-sm'>
            <h2 className='text-base font-semibold'>{t('Yeni rəqib')}</h2>
            <CompetitorForm
              initial={{ name: '', keywords: '' }}
              busy={busyId === 'new'}
              disabled={limitReached}
              submitLabel={t('Əlavə et')}
              onSubmit={add}
            />
            {limitReached ? (
              <p className='rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800'>
                {t(
                  'Planınızda rəqib limiti dolub. Bir rəqibi silin və ya planınızı yüksəldin.'
                )}
              </p>
            ) : null}
            <div className='flex gap-2 rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground'>
              <Info className='mt-0.5 h-3.5 w-3.5 shrink-0' />
              <p>
                {t(
                  'Açar söz yazmasanız, rəqibin adı axtarılır. Rəqiblər yalnız xəbər saytlarında izlənir və Telegram bildirişi göndərilmir. Xəbərlərin tonunu AI müəyyən edir, ona görə səhv ola bilər.'
                )}
              </p>
            </div>
          </section>
        )}

        {competitors.length ? (
          <>
            <section className='grid gap-2 rounded-xl border bg-card p-4 shadow-sm'>
              <div className='flex items-center gap-2'>
                <Sparkles className='h-4 w-4 text-primary' />
                <h2 className='text-base font-semibold'>{t('AI xülasəsi')}</h2>
                {data?.insight ? (
                  <span className='text-xs text-muted-foreground'>
                    {formatDate(data.insight.insight_date)}
                  </span>
                ) : null}
              </div>
              {data?.insight ? (
                <p className='text-sm leading-relaxed whitespace-pre-line'>
                  {data.insight.summary}
                </p>
              ) : (
                <p className='text-sm text-muted-foreground'>
                  {t(
                    'Xülasə hər səhər son 7 günün xəbərlərinə əsasən hazırlanır. İlk xülasə rəqiblər üzrə xəbərlər toplandıqdan sonra görünəcək.'
                  )}
                </p>
              )}
            </section>

            <section className='grid gap-4 rounded-xl border bg-card p-4 shadow-sm'>
              <div className='flex flex-wrap items-center justify-between gap-2'>
                <h2 className='text-base font-semibold'>{t('Müqayisə')}</h2>
                <div
                  className='inline-flex rounded-lg border p-0.5'
                  role='group'
                  aria-label={t('Dövr')}
                >
                  {PERIODS.map((value) => (
                    <button
                      key={value}
                      type='button'
                      onClick={() => setPeriod(value)}
                      aria-pressed={period === value}
                      className={cn(
                        'rounded-md px-3 py-1 text-sm',
                        period === value
                          ? 'bg-primary text-primary-foreground'
                          : 'text-muted-foreground hover:text-foreground'
                      )}
                    >
                      {t('{0} gün', [value])}
                    </button>
                  ))}
                </div>
              </div>
              <Comparison rows={comparisonRows} period={period} />
            </section>

            <ul className='grid gap-3 md:grid-cols-2'>
              {competitors.map((competitor, index) => (
                <CompetitorCard
                  key={competitor.id}
                  competitor={competitor}
                  paused={!tracked(index)}
                  stats={mentions.get(competitor.id) ?? { week: 0, month: 0 }}
                  headlines={headlinesByCompetitor.get(competitor.id) ?? []}
                  busy={busyId === competitor.id}
                  onSave={(name, keywords) => save(competitor, name, keywords)}
                  onDelete={() => setDeleteCandidate(competitor)}
                />
              ))}
            </ul>
          </>
        ) : !noAccess ? (
          <div className='flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-10 text-center'>
            <div className='flex h-10 w-10 items-center justify-center rounded-full bg-muted'>
              <Swords className='h-5 w-5 text-muted-foreground' />
            </div>
            <p className='font-medium'>{t('Hələ rəqib əlavə etməmisiniz')}</p>
            <p className='max-w-sm text-sm text-muted-foreground'>
              {t(
                'Rəqibin adını və onu tapmaq üçün 1-3 açar söz yazın. Sistem xəbər saytlarında onları izləyib sizin açar sözlərinizlə müqayisə edəcək.'
              )}
            </p>
          </div>
        ) : null}
      </div>

      <ConfirmDialog
        open={!!deleteCandidate}
        onOpenChange={(open) => {
          if (!open) setDeleteCandidate(null)
        }}
        title={t('Rəqibi sil')}
        desc={
          deleteCandidate
            ? t('"{0}" rəqibi və onun toplanmış xəbərləri silinsin?', [
                deleteCandidate.name,
              ])
            : ''
        }
        cancelBtnText={t('Ləğv et')}
        confirmText={t('Sil')}
        destructive
        isLoading={deleteCandidate ? busyId === deleteCandidate.id : false}
        handleConfirm={() => {
          if (deleteCandidate) void remove(deleteCandidate)
        }}
        className='sm:max-w-md'
      />
    </>
  )
}

export const Route = createFileRoute('/(auth)/monitor/competitors')({
  component: CompetitorsPage,
})
