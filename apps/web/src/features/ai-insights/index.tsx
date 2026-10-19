import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getCurrentSupabaseProfile } from '@/lib/auth-session'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { PortalError, PortalLoading } from '@/components/layout/portal-state'
import { defaultFilters, evidenceUrl } from '@/features/analytics/model'
import { fetchInsights, requestInsights } from './api'
import {
  insightsKey,
  sentimentLabels,
  sentimentNames,
  type AnalysisResult,
  evidenceQuality,
  evidenceKindLabels,
  qualityLabels,
  isRecommendationBasis,
} from './model'

function date(value: string) {
  return new Date(value).toLocaleString('az-AZ', { timeZone: 'Asia/Baku' })
}
const stances = {
  opinion: 'Rəy',
  reported_quote: 'Nəql edilən sitat',
  allegation: 'İddia',
  fact_report: 'Mənbədə verilən məlumat (təsdiqlənməyib)',
  uncertain: 'Qeyri-müəyyən şərh',
}
function Result({
  result,
  periodStart,
  periodEnd,
}: {
  result: AnalysisResult
  periodStart: string
  periodEnd: string
}) {
  const sourceCounts = [
    ...new Set(result.evidence.map((item) => item.source_id)),
  ].map((id) => ({
    id,
    name:
      result.evidence.find((item) => item.source_id === id)?.publisher ||
      'Mənbə adı yoxdur',
    count: result.evidence.filter((item) => item.source_id === id).length,
  }))
  const total = Math.max(1, result.evidence.length)
  const insufficient = result.evidence_status !== 'sufficient'
  const recommendations = insufficient
    ? []
    : result.recommendations.filter((rec) =>
        rec.evidence_ids.every((id) => {
          const item = result.evidence.find((e) => e.id === id)
          return !!item && isRecommendationBasis(item)
        })
      )
  const age = new Date().getTime() - Date.parse(result.analysis_at)
  const fresh = age >= 0 && age < 24 * 3600000
  return (
    <div className='space-y-5'>
      <section className='rounded-xl border bg-card p-4'>
        <h2 className='text-lg font-semibold'>{result.entity.name}</h2>
        <p className='mt-2 text-sm text-muted-foreground'>
          {result.method === 'deterministic'
            ? 'Söz qaydaları ilə təhlil; semantik AI deyil.'
            : 'Model dəstəkli təhlil; insan yoxlaması tələb olunur.'}
        </p>
        <p className='mt-2 text-xs text-muted-foreground'>
          {date(periodStart)} — {date(periodEnd)} · Təhlil:{' '}
          {date(result.analysis_at)} ·{' '}
          {fresh ? 'Son 24 saatda işlənib' : 'Təhlil köhnəlib'}
        </p>
        <ul className='mt-3 grid gap-2 text-xs text-muted-foreground'>
          {result.limitations.map((value, i) => (
            <li key={i}>{value}</li>
          ))}
        </ul>
      </section>
      <section className='rounded-xl border bg-card p-4'>
        <h2 className='font-semibold'>Dəlillərin əhatəsi və müstəqilliyi</h2>
        <p className='mt-2 text-sm'>
          Təhlilə seçilən nəşrlər: {result.evidence.length} · Mənbə qeydləri:{' '}
          {
            new Set(
              result.evidence.map((item) => item.source_id).filter(Boolean)
            ).size
          }
        </p>
        <p className='mt-2 text-sm'>
          Müstəqil müəlliflər:{' '}
          {result.independent_author_count ?? 'Məlumat yoxdur'} · Müstəqil
          naşirlər: {result.independent_publisher_count ?? 'Məlumat yoxdur'}
        </p>
        <p className='mt-2 text-xs text-muted-foreground'>
          Nəşr və mənbə sayı ayrı-ayrı insanların rəylərinin sayı deyil.
          Müəlliflərin müstəqilliyi bu göstəricilərdən çıxarıla bilməz.
        </p>
      </section>
      {insufficient && (
        <section role='status' className='rounded-xl border bg-card p-4'>
          <h2 className='font-semibold'>Dəlil kifayət etmir</h2>
          <p className='mt-2 text-sm text-muted-foreground'>
            Başlıq, məhdud xülasə və ya mətnə çıxış problemi geniş yayılmış
            narazılığı təsdiqləmir. Mətn və müəllif müstəqilliyi yoxlanmadan
            tövsiyə göstərilmir.
          </p>
          <ul className='mt-2 grid gap-1 text-xs text-muted-foreground'>
            {(result.insufficient_evidence_reasons?.length
              ? result.insufficient_evidence_reasons
              : ['Mətn keyfiyyəti və tövsiyə əsası təsdiqlənməyib.']
            ).map((reason, i) => (
              <li key={i}>{reason}</li>
            ))}
          </ul>
        </section>
      )}
      <details className='rounded-xl border bg-card p-4'>
        <summary className='cursor-pointer font-medium'>
          Ad variantları və qeyri-müəyyən uyğunluq
        </summary>
        <ul className='mt-3 grid gap-2 text-sm'>
          {result.entity.aliases.map((alias) => (
            <li key={alias.value}>
              {alias.value} ·{' '}
              {alias.ambiguous ? 'Kontekst tələb olunur' : 'Ad variantı'} ·
              Kontekst: {alias.context.join(', ') || 'Məlumat yoxdur'}
            </li>
          ))}
        </ul>
        {!result.entity.aliases.length && (
          <p className='mt-2 text-sm text-muted-foreground'>
            Əlavə ad variantı qeyd edilməyib.
          </p>
        )}
      </details>
      <section className='rounded-xl border bg-card p-4'>
        <h2 className='mb-3 text-base font-semibold'>
          Dəlillərin mənbə bölgüsü
        </h2>
        <ul className='grid gap-2'>
          {sourceCounts.map((source) => (
            <li
              key={source.id || 'unknown'}
              className='flex justify-between gap-3 text-sm'
            >
              <span>{source.name}</span>
              <span className='shrink-0'>{source.count} mətn</span>
            </li>
          ))}
        </ul>
        {!sourceCounts.length && (
          <p className='text-sm text-muted-foreground'>
            Mənbə məlumatı yoxdur.
          </p>
        )}
      </section>
      <section className='rounded-xl border bg-card p-4'>
        <h2 className='mb-3 text-base font-semibold'>Sentiment bölgüsü</h2>
        <p className='mb-3 text-xs text-muted-foreground'>
          Seçilmiş mətnlərin təsnifatı; ictimaiyyətin ümumi mövqeyi və
          təsdiqlənmiş fakt deyil.
        </p>
        <ul className='grid gap-3'>
          {sentimentNames.map((name) => {
            const count = result.evidence.filter(
              (item) => item.sentiment === name
            ).length
            return (
              <li key={name}>
                <div className='flex justify-between gap-2 text-sm'>
                  <span>{sentimentLabels[name]}</span>
                  <span>{count} mətn</span>
                </div>
                <div aria-hidden='true' className='mt-1 h-2 rounded bg-muted'>
                  <div
                    className='h-2 rounded bg-primary'
                    style={{ width: `${(count / total) * 100}%` }}
                  />
                </div>
              </li>
            )
          })}
        </ul>
      </section>
      <section className='space-y-3'>
        <h2 className='text-lg font-semibold'>Mövzular və dəyişikliklər</h2>
        <p className='text-xs text-muted-foreground'>
          Əvvəlki və cari saylar seçilmiş dövrün bərabər iki yarısını müqayisə
          edir. Artım ümumi trendin təsdiqi deyil.
        </p>
        <div className='grid gap-3 md:grid-cols-2'>
          {result.topics.map((topic) => (
            <article className='rounded-xl border bg-card p-4' key={topic.name}>
              <h3 className='font-semibold'>{topic.name}</h3>
              <p className='mt-2 text-sm'>
                {topic.mentions} mətn · {topic.distinct_sources} mənbə
              </p>
              <p className='mt-2 text-xs text-muted-foreground'>
                Əvvəlki: {topic.change.previous} · Cari: {topic.change.current}{' '}
                · Dəyişiklik: {topic.change.delta > 0 ? '+' : ''}
                {topic.change.delta}
              </p>
              <p className='mt-2 text-xs text-muted-foreground'>
                {sentimentNames
                  .map((name) => `${sentimentLabels[name]} ${topic[name]}`)
                  .join(' · ')}
              </p>
              <a
                href='#analysis-evidence'
                className='mt-2 inline-flex min-h-11 items-center text-sm text-primary underline'
              >
                Dəlillərə bax
              </a>
            </article>
          ))}
        </div>
        {!result.topics.length && (
          <p className='text-sm text-muted-foreground'>
            Uyğun mövzu müəyyən edilməyib.
          </p>
        )}
      </section>
      <section className='space-y-3'>
        <h2 className='text-lg font-semibold'>Dəlilə əsaslanan tövsiyələr</h2>
        {recommendations.map((rec, i) => (
          <article key={i} className='rounded-xl border bg-card p-4'>
            <h3 className='font-semibold'>
              {rec.topic}: {rec.issue}
            </h3>
            <p className='mt-3 text-sm'>{rec.summary}</p>
            <p className='mt-2 text-xs text-muted-foreground'>
              {date(rec.period_start)} — {date(rec.period_end)} · Mənbələr:{' '}
              {sourceCounts
                .filter((source) =>
                  rec.evidence_ids.some(
                    (id) =>
                      result.evidence.find((item) => item.id === id)
                        ?.source_id === source.id
                  )
                )
                .map((source) => source.name)
                .join(', ')}
            </p>
            <dl className='mt-3 grid gap-3 text-sm sm:grid-cols-2'>
              <div>
                <dt className='text-xs text-muted-foreground'>Dəstək</dt>
                <dd>
                  {rec.mentions} nəşr · {rec.distinct_sources} mənbə qeydi ·{' '}
                  {sentimentLabels[rec.sentiment]}
                </dd>
              </div>
              <div>
                <dt className='text-xs text-muted-foreground'>
                  Etibar səviyyəsi
                </dt>
                <dd>
                  {rec.confidence === 'moderate' ? 'Orta' : 'Aşağı'} ·{' '}
                  {rec.confidence_explanation}
                </dd>
              </div>
              <div>
                <dt className='text-xs text-muted-foreground'>
                  Təklif edilən addım
                </dt>
                <dd>{rec.action}</dd>
              </div>
              <div>
                <dt className='text-xs text-muted-foreground'>
                  Gözlənilən fayda
                </dt>
                <dd>{rec.expected_benefit}</dd>
              </div>
            </dl>
            <ul className='mt-3 grid gap-2'>
              {rec.evidence_ids.map((id) => {
                const item = result.evidence.find((e) => e.id === id)!
                const url = evidenceUrl(item.url)
                return (
                  <li key={id}>
                    {url ? (
                      <a
                        className='inline-flex min-h-11 items-center text-sm text-primary underline'
                        href={url}
                        target='_blank'
                        rel='noopener noreferrer'
                      >
                        Dəlil: {item.title}
                      </a>
                    ) : (
                      <span>Etibarlı dəlil keçidi yoxdur.</span>
                    )}
                  </li>
                )
              })}
            </ul>
          </article>
        ))}
        {!recommendations.length && (
          <div className='rounded-xl border bg-card p-4'>
            <p className='font-medium'>
              Tövsiyə üçün kifayət qədər dəlil yoxdur
            </p>
            <p className='mt-2 text-sm text-muted-foreground'>
              Tək şikayət, yalnız başlıq və ya qeyri-müəyyən fikir geniş
              yayılmış problem kimi təqdim edilmir.
            </p>
          </div>
        )}
      </section>
      <section id='analysis-evidence' className='scroll-mt-20 space-y-3'>
        <h2 className='text-lg font-semibold'>Orijinal dəlillər</h2>
        <div className='grid gap-3 md:grid-cols-2'>
          {result.evidence.map((item) => {
            const url = evidenceUrl(item.url)
            return (
              <article className='rounded-xl border bg-card p-4' key={item.id}>
                <h3 className='font-semibold'>{item.title}</h3>
                <p className='mt-2 text-xs text-muted-foreground'>
                  {item.publisher || 'Mənbə adı yoxdur'} ·{' '}
                  {sentimentLabels[item.sentiment]} · {stances[item.stance]} ·{' '}
                  {qualityLabels[evidenceQuality(item)]}
                </p>
                <p className='mt-2 text-xs text-muted-foreground'>
                  Mətn növü:{' '}
                  {evidenceKindLabels[item.evidence_kind || 'uncertain']}.{' '}
                  {item.text_scope === 'title'
                    ? 'Yalnız başlıq üzrə məhdud qruplaşdırma; tam mətn təhlili deyil.'
                    : ['full_text', 'substantial_excerpt'].includes(
                          evidenceQuality(item)
                        )
                      ? 'Mənbə mətnindən seçilmiş parça təhlil olunub.'
                      : 'Məhdud mətn / metadata; tam mətn təhlili aparılmayıb.'}
                </p>
                <p className='mt-2 text-xs text-muted-foreground'>
                  Mətn alınıb:{' '}
                  {item.retrieved_at
                    ? date(item.retrieved_at)
                    : 'Məlumat yoxdur'}{' '}
                  ·{' '}
                  {item.retrieved_at &&
                  new Date().getTime() - Date.parse(item.retrieved_at) >= 0 &&
                  new Date().getTime() - Date.parse(item.retrieved_at) <
                    24 * 3600000
                    ? 'Son 24 saatda alınıb'
                    : 'Alınma tarixinin təzəliyi təsdiqlənməyib'}
                </p>
                <p className='mt-2 text-xs text-muted-foreground'>
                  {isRecommendationBasis(item)
                    ? 'Tövsiyə üçün uyğun mətn əsası var; digər dəlillərlə birlikdə qiymətləndirilir.'
                    : 'Bu mətn tövsiyə əsası kimi təsdiqlənməyib.'}
                </p>
                <p className='mt-3 text-sm whitespace-pre-wrap'>
                  {item.excerpt}
                </p>
                <p className='mt-2 text-xs text-muted-foreground'>
                  Aşkarlanıb: {date(item.detected_at)} · Nəşr:{' '}
                  {item.published_at
                    ? date(item.published_at)
                    : 'Məlumat yoxdur'}
                </p>
                {url ? (
                  <a
                    href={url}
                    target='_blank'
                    rel='noopener noreferrer'
                    className='mt-2 inline-flex min-h-11 items-center text-sm text-primary underline'
                    aria-label={`Mənbəyə keç: ${item.title}`}
                  >
                    Mənbəyə keç
                  </a>
                ) : (
                  <p className='text-xs text-muted-foreground'>
                    Etibarlı keçid yoxdur.
                  </p>
                )}
              </article>
            )
          })}
        </div>
        {!result.evidence.length && (
          <p className='text-sm text-muted-foreground'>
            Uyğun mətn aşkarlanmayıb.
          </p>
        )}
      </section>
    </div>
  )
}
export function AIInsightsPage() {
  const client = useQueryClient()
  const [identity, setIdentity] = useState<string | null>(null)
  const [filters, setFilters] = useState(defaultFilters)
  const [runId, setRunId] = useState('')
  const request = useRef<{
    filters: string
    key: string
    requestedAt: Date
  } | null>(null)
  useEffect(() => {
    let active = true,
      changed = false
    getCurrentSupabaseProfile()
      .then((profile) => {
        if (active && !changed) setIdentity(profile.user?.id || '')
      })
      .catch(() => {
        if (active && !changed) setIdentity('')
      })
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      changed = true
      if (active) {
        setIdentity(session?.user.id || '')
        setRunId('')
      }
    })
    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])
  const query = useQuery({
    queryKey: insightsKey(identity || ''),
    queryFn: () => fetchInsights(identity!),
    enabled: !!identity,
    retry: false,
    staleTime: 30000,
    refetchInterval: (q) =>
      q.state.data?.runs.some((run) =>
        ['pending', 'running'].includes(run.status)
      )
        ? 15000
        : false,
  })
  const mutation = useMutation({
    mutationFn: () => {
      const serialized = JSON.stringify(filters)
      if (request.current?.filters !== serialized)
        request.current = {
          filters: serialized,
          key: crypto.randomUUID(),
          requestedAt: new Date(),
        }
      return requestInsights(
        filters,
        request.current.key,
        request.current.requestedAt
      )
    },
    onSuccess: () => {
      request.current = null
      void client.invalidateQueries({ queryKey: insightsKey(identity || '') })
    },
  })
  if (identity === null || (identity && query.isPending))
    return <PortalLoading label='Təhlil məlumatı yüklənir' />
  if (!identity)
    return (
      <PortalError
        message='Sessiya tapılmadı. Yenidən daxil olun.'
        onRetry={() => window.location.reload()}
      />
    )
  if (query.isError || !query.data)
    return (
      <PortalError
        message={query.error?.message || 'Təhlil əlçatan deyil.'}
        onRetry={() => void query.refetch()}
      />
    )
  const data = query.data
  const runs = data.runs.filter(
    (run) =>
      (!filters.monitor || run.monitor_id === filters.monitor) &&
      run.period_start.slice(0, 10) <= filters.end &&
      run.period_end.slice(0, 10) >= filters.start
  )
  const selected = runs.find((run) => run.id === runId) || runs[0]
  const running = data.runs.some(
    (run) =>
      run.monitor_id === filters.monitor &&
      ['pending', 'running'].includes(run.status)
  )
  const disabledReason =
    data.reason === 'disabled'
      ? 'Təhlil xidməti hələ aktivləşdirilməyib.'
      : data.reason === 'subscription_required'
        ? 'Aktiv abunəlik tələb olunur.'
        : 'Planınızda bu funksiya aktiv deyil.'
  return (
    <div className='portal-page space-y-5'>
      <div>
        <h1>Müzakirə təhlili və tövsiyələr</h1>
        <p className='mt-2 text-sm text-muted-foreground'>
          Mənbələrdəki mövzular və rəylər, orijinal dəlillərlə. Bu ekran məhdud
          seçməni təhlil edir; nəticələr insan yoxlaması tələb edir.
        </p>
      </div>
      {!data.available && (
        <section role='status' className='rounded-xl border bg-card p-4'>
          <h2 className='font-semibold'>Funksiya hazırda bağlıdır</h2>
          <p className='mt-2 text-sm text-muted-foreground'>{disabledReason}</p>
        </section>
      )}
      <form
        className='rounded-xl border bg-card p-4'
        onSubmit={(event) => {
          event.preventDefault()
          mutation.mutate()
        }}
      >
        <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-3'>
          <label className='grid gap-1 text-sm'>
            Monitor / təşkilat
            <select
              className='rounded-md border bg-background px-3 py-2'
              value={filters.monitor}
              onChange={(e) => {
                setFilters({ ...filters, monitor: e.target.value })
                setRunId('')
                mutation.reset()
              }}
            >
              <option value=''>Monitor seçin</option>
              {data.monitors.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label className='grid gap-1 text-sm'>
            Başlanğıc tarix (UTC)
            <input
              className='rounded-md border bg-background px-3 py-2'
              type='date'
              required
              value={filters.start}
              onChange={(e) => {
                setFilters({ ...filters, start: e.target.value })
                mutation.reset()
              }}
            />
          </label>
          <label className='grid gap-1 text-sm'>
            Son tarix (UTC)
            <input
              className='rounded-md border bg-background px-3 py-2'
              type='date'
              required
              value={filters.end}
              onChange={(e) => {
                setFilters({ ...filters, end: e.target.value })
                mutation.reset()
              }}
            />
          </label>
        </div>
        <div className='mt-3 flex flex-wrap items-center gap-3'>
          <Button
            type='submit'
            disabled={
              !data.available ||
              data.quota.remaining === 0 ||
              !filters.monitor ||
              mutation.isPending ||
              running
            }
          >
            {mutation.isPending
              ? 'Sorğu göndərilir'
              : running
                ? 'Təhlil növbədədir'
                : 'Təhlil sorğusu yarat'}
          </Button>
          <Button
            type='button'
            variant='outline'
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            Yenilə
          </Button>
          <p className='text-xs text-muted-foreground'>
            Aylıq sorğu limiti: {data.quota.limit} · İstifadə: {data.quota.used}{' '}
            · Qalıq: {data.quota.remaining}
          </p>
        </div>
        {data.available && data.quota.remaining === 0 && (
          <p role='status' className='mt-3 text-sm text-muted-foreground'>
            Aylıq təhlil limiti bitib. Mövcud nəticələrə baxa bilərsiniz.
          </p>
        )}
        {mutation.isError && (
          <p role='alert' className='mt-3 text-sm text-destructive'>
            {mutation.error.message}
          </p>
        )}
        {mutation.isSuccess && (
          <p role='status' className='mt-3 text-sm'>
            Sorğu qəbul edildi. Nəticə hazır olduqda bu ekran yenilənəcək.
          </p>
        )}
        <p className='mt-3 text-xs text-muted-foreground'>
          Tarixlər yeni sorğuya və ən son 20 təhlilin seçiminə tətbiq edilir. Ən
          çox 100 monitor göstərilir.
        </p>
      </form>
      {!!runs.length && (
        <label className='grid gap-1 text-sm'>
          Təhlil tarixçəsi
          <select
            className='rounded-md border bg-card px-3 py-2'
            value={selected?.id || ''}
            onChange={(e) => setRunId(e.target.value)}
          >
            {runs.map((run) => (
              <option key={run.id} value={run.id}>
                {date(run.created_at)} ·{' '}
                {run.status === 'complete'
                  ? 'Tamamlanıb'
                  : run.status === 'dead'
                    ? 'Uğursuz'
                    : run.status === 'running'
                      ? 'İşlənir'
                      : 'Növbədə'}
              </option>
            ))}
          </select>
        </label>
      )}
      {selected?.status === 'dead' && (
        <div role='alert' className='rounded-xl border bg-card p-4'>
          Təhlil tamamlanmadı. Yeni sorğudan əvvəl xidmət vəziyyətini yoxlayın.
        </div>
      )}
      {selected && ['pending', 'running'].includes(selected.status) && (
        <div role='status' className='rounded-xl border bg-card p-4'>
          Təhlil arxa planda işlənir. Mövcud monitorinq davam edir.
        </div>
      )}
      {selected?.status === 'complete' && selected.result && (
        <Result
          result={selected.result}
          periodStart={selected.period_start}
          periodEnd={selected.period_end}
        />
      )}
      {!runs.length && (
        <section className='rounded-xl border bg-card p-5'>
          <h2 className='font-semibold'>Bu seçim üçün təhlil yoxdur</h2>
          <p className='mt-2 text-sm text-muted-foreground'>
            Xidmət və plan imkan verdikdə monitor seçib sorğu yarada bilərsiniz.
            Nəticələr və tövsiyələr dəlil olmadığı halda uydurulmur.
          </p>
        </section>
      )}
    </div>
  )
}
