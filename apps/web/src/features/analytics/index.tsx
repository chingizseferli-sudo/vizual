import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ExternalLink } from 'lucide-react'
import { getCurrentSupabaseProfile } from '@/lib/auth-session'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { PortalError, PortalLoading } from '@/components/layout/portal-state'
import { fetchAnalytics } from './api'
import {
  analyticsKey,
  defaultFilters,
  evidenceUrl,
  requestWindow,
  summarize,
  type ContentItem,
  type AnalyticsData,
} from './model'
import { metricNames, metricState, popularityGroups } from './popularity'

function date(value: string | null) {
  return value && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleString('az-AZ', { timeZone: 'Asia/Baku' })
    : 'Məlumat yoxdur'
}
function Evidence({ item }: { item: ContentItem }) {
  const metrics = metricState(item)
  const labels = {
    views: 'Baxış',
    likes: 'Bəyənmə',
    reactions: 'Reaksiya',
    comments: 'Şərh',
    shares: 'Paylaşım',
    reposts: 'Yenidən paylaşım',
    reach: 'Çatım',
  }
  const url = evidenceUrl(item.url)
  return (
    <article className='min-w-0 rounded-xl border bg-card p-4'>
      <h3 className='font-semibold'>{item.title}</h3>
      <p className='mt-2 text-sm text-muted-foreground'>
        {item.publisher || 'Mənbə adı yoxdur'} · {item.platform}
      </p>
      <dl className='mt-3 grid gap-2 text-xs text-muted-foreground'>
        <div>
          <dt>Nəşr tarixi</dt>
          <dd>{date(item.published_at)}</dd>
        </div>
        <div>
          <dt>Aşkarlanıb</dt>
          <dd>{date(item.detected_at)}</dd>
        </div>
        <div>
          <dt>Uyğun monitorlar</dt>
          <dd>{new Set(item.matches.map((match) => match.monitor_id)).size}</dd>
        </div>
        <div>
          <dt>Auditoriya fəaliyyəti göstəriciləri</dt>
          <dd>
            {metrics.snapshot
              ? metricNames
                  .map(
                    (name) =>
                      `${labels[name]}: ${metrics.snapshot![name] ?? 'Məlumat yoxdur'}`
                  )
                  .join(' · ')
              : 'Məlumat yoxdur'}
          </dd>
          {metrics.snapshot && (
            <dd>
              Mənbə: {metrics.snapshot.provider} / {metrics.snapshot.method} ·
              Ölçülüb: {date(metrics.snapshot.observed_at)}{' '}
              {metrics.stale && '· Köhnəlmiş məlumat'}
            </dd>
          )}
        </div>
      </dl>
      {url ? (
        <a
          className='mt-3 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-primary underline underline-offset-4'
          href={url}
          target='_blank'
          rel='noopener noreferrer'
          aria-label={`Mənbəyə keç: ${item.title}`}
        >
          Mənbəyə keç <ExternalLink className='size-4' aria-hidden='true' />
        </a>
      ) : (
        <p className='mt-3 text-xs text-muted-foreground'>
          Etibarlı mənbə keçidi yoxdur.
        </p>
      )}
    </article>
  )
}
function Bars({
  title,
  rows,
}: {
  title: string
  rows: { name: string; count: number }[]
}) {
  const max = Math.max(1, ...rows.map((row) => row.count))
  return (
    <section className='min-w-0 rounded-xl border bg-card p-4'>
      <h2 className='mb-4 text-base font-semibold'>{title}</h2>
      {rows.length ? (
        <ul className='grid gap-3'>
          {rows.map((row, index) => (
            <li key={`${row.name}-${index}`}>
              <div className='mb-1 flex min-w-0 justify-between gap-2 text-sm'>
                <span>{row.name}</span>
                <span className='shrink-0 tabular-nums'>{row.count} nəşr</span>
              </div>
              <div aria-hidden='true' className='h-2 rounded bg-muted'>
                <div
                  className='h-2 rounded bg-primary'
                  style={{ width: `${(row.count / max) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className='text-sm text-muted-foreground'>
          Bu seçimdə məlumat yoxdur.
        </p>
      )}
    </section>
  )
}

export function AnalyticsPage() {
  const [userId, setUserId] = useState('')
  const [identityReady, setIdentityReady] = useState(false)
  const [draft, setDraft] = useState(defaultFilters)
  const [filters, setFilters] = useState(defaultFilters)
  const [validation, setValidation] = useState('')
  const [page, setPage] = useState(0)
  const [ranking, setRanking] = useState<
    'latest' | 'monitors' | 'most' | 'least' | 'growth'
  >('latest')
  const [platform, setPlatform] = useState('')
  useEffect(() => {
    let active = true
    let authChanged = false
    getCurrentSupabaseProfile()
      .then((profile) => {
        if (active && !authChanged) {
          setUserId(profile.user?.id || '')
          setIdentityReady(true)
        }
      })
      .catch(() => {
        if (active && !authChanged) {
          setIdentityReady(true)
          setUserId('')
        }
      })
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      authChanged = true
      if (active) {
        setUserId(session?.user.id || '')
        setIdentityReady(true)
      }
    })
    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])
  const query = useQuery({
    queryKey: analyticsKey(userId, filters),
    queryFn: () => fetchAnalytics(filters, userId),
    enabled: !!userId,
    staleTime: 60000,
    retry: false,
  })
  if (!identityReady || (userId && query.isPending))
    return <PortalLoading label='Analitika yüklənir' />
  if (!userId)
    return (
      <PortalError
        message='Sessiya tapılmadı. Yenidən daxil olun.'
        onRetry={() => window.location.reload()}
      />
    )
  const data: AnalyticsData = query.data || {
    version: 1,
    owner_id: userId,
    items: [],
    truncated: false,
    limit: 500,
    collected_at: new Date().toISOString(),
    start: new Date().toISOString(),
    end: new Date().toISOString(),
    retention_days: 1,
    monitors: [],
  }
  const summary = summarize({
    ...data,
    items: platform
      ? data.items.filter((item) => item.platform === platform)
      : data.items,
  })
  const engagementCount = summary.items.filter((item) => {
    const snapshot = metricState(item).snapshot
    return snapshot && metricNames.some((name) => snapshot[name] != null)
  }).length
  const popularity = ['most', 'least', 'growth'].includes(ranking)
    ? popularityGroups(summary.items, ranking as 'most' | 'least' | 'growth')
    : []
  const ranked =
    ranking === 'monitors'
      ? [...summary.items].sort(
          (a, b) =>
            new Set(b.matches.map((m) => m.monitor_id)).size -
              new Set(a.matches.map((m) => m.monitor_id)).size ||
            b.detected_at.localeCompare(a.detected_at)
        )
      : summary.items
  const pages = Math.ceil(ranked.length / 12)
  const visible = ranked.slice(page * 12, page * 12 + 12)
  return (
    <div className='portal-page space-y-5'>
      <div>
        <h1>Kontent analitikası</h1>
        <p className='mt-2 text-sm text-muted-foreground'>
          Monitorlarınıza uyğun aşkarlanmış məzmun və mənbə fəaliyyəti.
          Göstəricilər internet üzrə tam əhatə demək deyil.
        </p>
      </div>
      <form
        className='rounded-xl border bg-card p-4'
        onSubmit={(event) => {
          event.preventDefault()
          try {
            requestWindow(draft)
            setValidation('')
            setFilters({ ...draft })
            setPage(0)
          } catch (error) {
            setValidation((error as Error).message)
          }
        }}
      >
        <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-4'>
          <label className='grid gap-1 text-sm'>
            Başlanğıc tarix (UTC)
            <input
              className='rounded-md border bg-background px-3 py-2'
              type='date'
              required
              value={draft.start}
              onChange={(e) => setDraft({ ...draft, start: e.target.value })}
            />
          </label>
          <label className='grid gap-1 text-sm'>
            Son tarix (UTC)
            <input
              className='rounded-md border bg-background px-3 py-2'
              type='date'
              required
              value={draft.end}
              onChange={(e) => setDraft({ ...draft, end: e.target.value })}
            />
          </label>
          <label className='grid gap-1 text-sm'>
            Monitor / mövzu
            <select
              className='rounded-md border bg-background px-3 py-2'
              value={draft.monitor}
              onChange={(e) => setDraft({ ...draft, monitor: e.target.value })}
            >
              <option value=''>Bütün monitorlar</option>
              {data.monitors.map((m) => (
                <option value={m.id} key={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label className='grid gap-1 text-sm'>
            Mənbə
            <select
              className='rounded-md border bg-background px-3 py-2'
              value={draft.source}
              onChange={(e) => setDraft({ ...draft, source: e.target.value })}
            >
              <option value=''>Bütün mənbələr</option>
              {summary.sources.map((source) => (
                <option value={source.id} key={source.id}>
                  {source.name}
                </option>
              ))}
              {draft.source &&
                !summary.sources.some((s) => s.id === draft.source) && (
                  <option value={draft.source}>Seçilmiş mənbə</option>
                )}
            </select>
          </label>
        </div>
        <div className='mt-3 flex flex-wrap gap-2'>
          <Button type='submit' disabled={query.isFetching}>
            Tətbiq et
          </Button>
          <Button
            type='button'
            variant='outline'
            onClick={() => {
              const reset = defaultFilters()
              setDraft(reset)
              setFilters(reset)
              setValidation('')
              setPage(0)
            }}
          >
            Sıfırla
          </Button>
        </div>
        {validation && (
          <p role='alert' className='mt-3 text-sm text-destructive'>
            {validation}
          </p>
        )}
        <p className='mt-3 text-xs text-muted-foreground'>
          Planın tarixçə həddi:{' '}
          {query.data ? `${data.retention_days} gün` : 'Məlumat yoxdur'}. Mənbə
          seçimləri göstərilən qeydlərə əsaslanır.
        </p>
      </form>
      {query.isError && (
        <PortalError
          message={query.error.message}
          onRetry={() => void query.refetch()}
        />
      )}
      {query.data && (
        <>
          <p
            role='status'
            aria-live='polite'
            className='text-xs text-muted-foreground'
          >
            {query.isFetching
              ? 'Məlumat yenilənir.'
              : `${date(data.start)} — ${date(data.end)} · Oxunub: ${date(data.collected_at)}`}{' '}
            {data.truncated
              ? `İlk ${data.limit} nəşr göstərilir; bütün göstəricilər bu məhdud seçimə əsaslanır.`
              : 'Göstəricilər bu tarix aralığında əlçatan monitor nəşrlərinə əsaslanır. Platforma seçimi bu server nəticəsi daxilində tətbiq edilir.'}
          </p>
          <label className='grid max-w-sm gap-1 text-sm'>
            Platforma (server seçimində)
            <select
              className='rounded-md border bg-card px-3 py-2'
              value={platform}
              onChange={(e) => {
                setPlatform(e.target.value)
                setPage(0)
              }}
            >
              <option value=''>Bütün platformalar</option>
              {[...new Set(data.items.map((item) => item.platform))]
                .sort()
                .map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
            </select>
          </label>
          <div className='grid grid-cols-2 gap-3 xl:grid-cols-4'>
            {[
              ['Aşkarlanmış nəşrlər', summary.items.length],
              ['Fərqli mənbələr', summary.sources.length],
              ['Uyğun monitorlar', summary.topics.length],
              ['Metrik məlumatı olan nəşrlər', engagementCount],
            ].map(([label, value]) => (
              <div key={label} className='rounded-xl border bg-card p-4'>
                <p className='text-xs text-muted-foreground'>{label}</p>
                <p className='mt-2 text-xl font-semibold'>{value}</p>
              </div>
            ))}
          </div>
          <p className='text-sm text-muted-foreground'>
            Hazırkı RSS toplaması baxış, reaksiya və paylaşım göstəriciləri
            təqdim etmir. Mənbə və nəşr sayı auditoriya ölçüsü və ya populyarlıq
            deyil.
          </p>
          {!summary.items.length && (
            <section className='rounded-xl border bg-card p-5'>
              <h2 className='font-semibold'>Bu seçim üçün məzmun yoxdur</h2>
              <p className='my-2 text-sm text-muted-foreground'>
                Tarixləri və filtrləri dəyişin və ya monitor əlavə edin.
              </p>
              <Link
                to='/monitor/monitors'
                className='inline-flex min-h-11 items-center text-primary underline'
              >
                Monitorlara keç
              </Link>
            </section>
          )}
          <div className='grid gap-4 xl:grid-cols-2'>
            <Bars title='Aşkarlanma dinamikası (UTC)' rows={summary.days} />
            <Bars
              title='Mənbə bölgüsü'
              rows={summary.sources.map((s) => ({
                name: s.name,
                count: s.count,
              }))}
            />
          </div>
          <Bars title='Platforma bölgüsü' rows={summary.platforms} />
          <section className='space-y-3'>
            <h2 className='text-lg font-semibold'>Mövzular və nəşr artımı</h2>
            <p className='text-sm text-muted-foreground'>
              Açar söz qaydalarına əsaslanan monitor qrupları; AI təsnifatı
              deyil. Qısaltmaların mənası ayrıca təsdiqlənməyib. Eyni nəşr hər
              monitorda bir dəfə sayılır.
            </p>
            <p className='text-xs text-muted-foreground'>
              Əvvəlki: {date(data.start)} — {date(summary.midpoint)}. Cari:{' '}
              {date(summary.midpoint)} — {date(data.end)}.
            </p>
            <div className='grid gap-3 md:grid-cols-2'>
              {summary.topics.map((topic) => (
                <article
                  className='rounded-xl border bg-card p-4'
                  key={topic.id}
                >
                  <h3 className='font-semibold'>{topic.name}</h3>
                  <p className='mt-2 text-sm'>
                    {topic.items.size} nəşr · {topic.sources.size} mənbə
                  </p>
                  <p className='mt-2 text-sm text-muted-foreground'>
                    {[...topic.keywords].join(' · ') ||
                      'Açar söz məlumatı yoxdur'}
                  </p>
                  <p className='mt-2 text-xs'>
                    Cari {topic.current} · Əvvəlki {topic.previous} · Dəyişiklik{' '}
                    {topic.current - topic.previous > 0 ? '+' : ''}
                    {topic.current - topic.previous} nəşr
                  </p>
                </article>
              ))}
            </div>
            {!summary.topics.length && (
              <p className='text-sm text-muted-foreground'>
                Mövzu məlumatı yoxdur.
              </p>
            )}
          </section>
          <section className='space-y-3'>
            <div className='flex flex-wrap items-center justify-between gap-3'>
              <h2 className='text-lg font-semibold'>Kontent sıralaması</h2>
              <label className='grid gap-1 text-sm'>
                Sıralama
                <select
                  className='rounded-md border bg-card px-3 py-2'
                  value={ranking}
                  onChange={(e) => {
                    setRanking(e.target.value as typeof ranking)
                    setPage(0)
                  }}
                >
                  <option value='latest'>Ən son aşkarlanan</option>
                  <option value='monitors'>Ən çox monitora uyğun</option>
                  <option value='most'>Ən yüksək auditoriya fəaliyyəti</option>
                  <option value='least'>
                    Ən aşağı auditoriya fəaliyyəti (48+ saat)
                  </option>
                  <option value='growth'>
                    Ən sürətli auditoriya fəaliyyəti artımı
                  </option>
                </select>
              </label>
            </div>
            <p className='text-xs text-muted-foreground'>
              Sıralama eyni nəşrin fərqli monitorlara uyğunluğu əsasında
              aparılır; auditoriya fəaliyyəti sıralaması deyil.
            </p>
            <div className='grid gap-3 md:grid-cols-2 xl:grid-cols-3'>
              {!['most', 'least', 'growth'].includes(ranking) &&
                visible.map((item) => <Evidence item={item} key={item.id} />)}
            </div>
            {!['most', 'least', 'growth'].includes(ranking) && pages > 1 && (
              <nav
                aria-label='Kontent səhifələri'
                className='flex flex-wrap items-center gap-3'
              >
                <Button
                  variant='outline'
                  disabled={!page}
                  onClick={() => setPage(page - 1)}
                >
                  Əvvəlki
                </Button>
                <span>
                  {page + 1} / {pages}
                </span>
                <Button
                  variant='outline'
                  disabled={page >= pages - 1}
                  onClick={() => setPage(page + 1)}
                >
                  Növbəti
                </Button>
              </nav>
            )}
          </section>
          {['most', 'least', 'growth'].includes(ranking) && (
            <section
              className='space-y-3'
              aria-label='Auditoriya fəaliyyəti sıralaması'
            >
              <p className='text-xs text-muted-foreground'>
                Yalnız eyni platforma, məzmun növü, nəşr yaşı, metrik dəsti və
                ölçmə üsulu daxilində müqayisə. 24 saatdan köhnə ölçmələr
                çıxarılır. Çəkilər: baxış × 0.01, bəyənmə/reaksiya × 1, şərh ×
                2, paylaşım/repost × 3. Artım iki uyğun ölçmə arasında
                bal/saatdır. Normallaşdırılmış faiz ən az 3 nəşr olan qrup
                daxilində sıralamadır.
              </p>
              {popularity.length ? (
                popularity.map((group) => (
                  <article
                    key={group.cohort}
                    className='rounded-xl border bg-card p-4'
                  >
                    <h3 className='text-sm font-semibold'>{group.cohort}</h3>
                    <div className='mt-3 grid gap-3 md:grid-cols-2'>
                      {group.rows.slice(0, 12).map((row) => (
                        <div key={row.item.id}>
                          <p className='mb-2 text-xs'>
                            Bal: {row.score.toFixed(2)}
                            {ranking === 'growth' ? ' / saat' : ''} · Qrup
                            faizi:{' '}
                            {row.normalized === null
                              ? 'Kifayət qədər məlumat yoxdur'
                              : row.normalized.toFixed(0) + '%'}
                          </p>
                          <Evidence item={row.item} />
                        </div>
                      ))}
                    </div>
                    <p className='mt-2 text-xs text-muted-foreground'>
                      Qrupdakı {group.rows.length} nəşrdən ilk 12-si göstərilir.
                    </p>
                  </article>
                ))
              ) : (
                <p className='text-sm text-muted-foreground'>
                  Müqayisə üçün kifayət qədər təzə və uyğun auditoriya
                  fəaliyyəti məlumatı yoxdur.
                </p>
              )}
            </section>
          )}
          <section className='space-y-3'>
            <h2 className='text-lg font-semibold'>Əlaqəli əhatə</h2>
            <p className='text-sm text-muted-foreground'>
              Eyni normallaşdırılmış başlığa malik ayrı nəşrlər mümkün əlaqədir.
              Yenidən nəşr, məzmun eyniliyi və ya manipulyasiya təsdiqlənmir.
            </p>
            {summary.related.map((group) => (
              <article
                className='rounded-xl border bg-card p-4'
                key={group[0].id}
              >
                <h3 className='font-semibold'>{group[0].title}</h3>
                <p className='my-2 text-xs text-muted-foreground'>
                  Oxşar başlıq · Üsul: dəqiq normallaşdırılmış başlıq ·
                  Yoxlanılmayıb · {group.length} nəşr
                </p>
                <ul className='grid gap-2'>
                  {group.map((item) => (
                    <li key={item.id}>
                      {evidenceUrl(item.url) ? (
                        <a
                          href={evidenceUrl(item.url)!}
                          target='_blank'
                          rel='noopener noreferrer'
                          className='inline-flex min-h-11 items-center text-sm text-primary underline'
                          aria-label={`Mənbəyə keç: ${item.title}`}
                        >
                          {item.publisher || item.platform} ·{' '}
                          {date(item.detected_at)}
                        </a>
                      ) : (
                        <span>Keçid yoxdur</span>
                      )}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
            {!summary.related.length && (
              <p className='text-sm text-muted-foreground'>
                Bu seçim üçün əlaqəli nəşr qeydi yoxdur.
              </p>
            )}
          </section>
        </>
      )}
    </div>
  )
}
