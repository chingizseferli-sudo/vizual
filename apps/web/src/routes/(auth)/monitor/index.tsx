import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import {
  Bell,
  CheckCircle2,
  ExternalLink,
  Hash,
  Radio,
  Send,
} from 'lucide-react'
import { customerQueryKeys } from '@/lib/query-keys'
import { supabase } from '@/lib/supabase'
import { PortalLoading, PortalError } from '@/components/layout/portal-state'
import { dateLocale, t } from '@/lib/i18n'

type MatchRow = {
  id: string
  monitor_id: string
  matched_keyword: string | null
  created_at: string | null
  user_monitors: {
    name: string
  } | null
  monitored_items: {
    title: string
    url: string
  } | null
}

type DashboardData = {
  monitorCount: number
  keywordCount: number
  resultCount: number
  alertCount: number
  recentMatches: MatchRow[]
}

const EMPTY_DASHBOARD: DashboardData = {
  monitorCount: 0,
  keywordCount: 0,
  resultCount: 0,
  alertCount: 0,
  recentMatches: [],
}

function decodeHtml(text: string) {
  const textarea = document.createElement('textarea')
  textarea.innerHTML = text
  return textarea.value
}

function formatDate(value: string | null) {
  if (!value) return '-'

  return new Date(value).toLocaleString(dateLocale(), {
    timeZone: 'Asia/Baku',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

async function fetchDashboardData(): Promise<DashboardData> {
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return EMPTY_DASHBOARD

  const { data: monitors, error: monitorsError } = await supabase
    .from('user_monitors')
    .select('id')
    .eq('user_id', user.id)

  if (monitorsError) throw monitorsError

  const monitorIds = (monitors || []).map((item) => item.id)

  if (monitorIds.length === 0) return EMPTY_DASHBOARD

  const [keywordsRes, matchesRes] = await Promise.all([
    supabase
      .from('monitor_keywords')
      .select('id', { count: 'exact', head: true })
      .in('monitor_id', monitorIds),

    supabase
      .from('monitor_matches')
      .select(
        'id,monitor_id,matched_keyword,created_at,user_monitors(name),monitored_items(title,url)'
      )
      .in('monitor_id', monitorIds)
      .order('created_at', { ascending: false })
      .limit(10),
  ])

  if (keywordsRes.error) throw keywordsRes.error
  if (matchesRes.error) throw matchesRes.error

  const matches = (matchesRes.data || []) as unknown as MatchRow[]
  const matchIds = matches.map((item) => item.id)
  let alertCount = 0

  if (matchIds.length > 0) {
    const { count, error } = await supabase
      .from('monitor_alerts')
      .select('id', { count: 'exact', head: true })
      .in('match_id', matchIds)
    if (error) throw error
    alertCount = count || 0
  }

  return {
    monitorCount: monitorIds.length,
    keywordCount: keywordsRes.count || 0,
    resultCount: matchIds.length,
    alertCount,
    recentMatches: matches,
  }
}

function MetricCard({
  label,
  description,
  value,
  to,
  icon: Icon,
}: {
  label: string
  description: string
  value: string | number
  to: '/monitor/monitors' | '/monitor/results' | '/monitor/alerts'
  icon: typeof Bell
}) {
  return (
    <Link
      to={to}
      className='rounded-xl border border-border bg-card p-4 transition hover:border-ring'
    >
      <div className='flex items-center justify-between gap-3'>
        <div>
          <div className='text-sm font-semibold text-muted-foreground'>
            {label}
          </div>
          <div className='mt-1 text-3xl font-semibold text-foreground'>
            {value}
          </div>
          <div className='mt-1 text-xs text-muted-foreground'>
            {description}
          </div>
        </div>
        <div className='grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary'>
          <Icon className='h-5 w-5' />
        </div>
      </div>
    </Link>
  )
}

function FirstRunGuide() {
  const steps = [
    t("Monitor yaradın"),
    t("Açar söz əlavə edin"),
    t("Nəticələri və bildirişləri izləyin"),
  ]

  return (
    <section className='rounded-2xl border border-primary/20 bg-card p-5 shadow-sm md:p-6'>
      <div className='grid gap-5 lg:grid-cols-[1.2fr_1fr] lg:items-center'>
        <div className='space-y-3'>
          <div>
            <p className='text-sm font-semibold tracking-wide text-primary uppercase'>{t("İlk addım")}</p>
            <h2 className='mt-2 text-2xl font-semibold tracking-tight text-foreground'>{t("Vizual.Az-a xoş gəlmisiniz")}</h2>
            <p className='mt-2 text-sm leading-6 text-muted-foreground'>{t("Vizual.Az seçdiyiniz açar sözləri media mənbələrində izləyir. Uyğun material tapıldıqda nəticələr paneldə görünür və bildiriş tarixçəsi yaranır.")}</p>
          </div>
          <p className='text-sm leading-6 text-muted-foreground'>{t("Başlamaq üçün ilk monitorunuzu yaradın, sonra izlənəcək açar sözləri əlavə edin. Sistem mənbələri yoxladıqca uyğun xəbərlər burada görünəcək.")}</p>
          <Link
            to='/monitor/monitors'
            className='inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:bg-primary/90'
          >
            <Send className='h-4 w-4' />{t("İlk monitoru yarat")}</Link>
        </div>

        <div className='grid gap-2'>
          {steps.map((step, index) => (
            <div
              key={step}
              className='flex items-center gap-3 rounded-2xl border border-border bg-muted/40 p-3'
            >
              <div className='flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground'>
                {index + 1}
              </div>
              <div className='text-sm font-semibold text-foreground'>
                {step}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function UserMonitorDashboard() {
  const {
    data = EMPTY_DASHBOARD,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: customerQueryKeys.dashboard(),
    queryFn: fetchDashboardData,
    staleTime: 30 * 1000,
  })

  const { monitorCount, keywordCount, resultCount, alertCount, recentMatches } =
    data
  const hasNoMonitors = monitorCount === 0

  if (isLoading) return <PortalLoading label={t("Monitorinq paneli yüklənir...")} />
  if (isError)
    return (
      <PortalError
        message={t("Paneli yükləmək mümkün olmadı.")}
        onRetry={() => void refetch()}
      />
    )

  return (
    <div className='portal-page grid gap-5'>
      <div className='flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 shadow-sm md:p-6 lg:flex-row lg:items-end lg:justify-between'>
        <div>
          <p className='text-sm font-semibold tracking-wide text-primary uppercase'>{t("İş masası")}</p>
          <h1 className='mt-2 text-3xl font-semibold tracking-tight text-foreground'>
            Monitorinq panelim
          </h1>
          <p className='mt-2 max-w-2xl text-sm leading-6 text-muted-foreground'>{t("Cari vəziyyəti görün, növbəti addımı seçin və monitorinq nəticələrinə tez keçin.")}</p>
        </div>

        <Link
          to='/monitor/monitors'
          className='inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:bg-primary/90'
        >
          <Send className='h-4 w-4' />{t("Monitorları idarə et")}</Link>
      </div>

      <nav aria-label={t("Tez keçidlər")} className='flex flex-wrap gap-2'>
        <Link
          to='/monitor/results'
          className='rounded-lg border bg-card px-3 py-2 text-sm font-medium hover:bg-muted'
        >{t("Nəticələrə bax")}</Link>
        <Link
          to='/monitor/profile'
          className='rounded-lg border bg-card px-3 py-2 text-sm font-medium hover:bg-muted'
        >{t("Bildiriş və abunə məlumatları")}</Link>
        <Link
          to='/monitor/story-intelligence'
          className='rounded-lg border bg-card px-3 py-2 text-sm font-medium hover:bg-muted'
        >{t("Xəbər xəritəsi")}</Link>
      </nav>
      {hasNoMonitors ? <FirstRunGuide /> : null}

      <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-4'>
        <MetricCard
          label='Monitorlar'
          description={t("İzlənən mövzular")}
          value={monitorCount}
          to='/monitor/monitors'
          icon={Radio}
        />
        <MetricCard
          label={t("Açar sözlər")}
          description={t("İzlənən ifadələr")}
          value={keywordCount}
          to='/monitor/monitors'
          icon={Hash}
        />
        <MetricCard
          label={t("Tapılan media materialı")}
          description={t("Ən yeni 10 nəticə daxilində")}
          value={resultCount}
          to='/monitor/results'
          icon={Bell}
        />
        <MetricCard
          label={t("Göndərilmiş bildiriş")}
          description={t("Son nəticələr üzrə bildirişlər")}
          value={alertCount}
          to='/monitor/alerts'
          icon={Send}
        />
      </div>

      {!hasNoMonitors ? (
        <section className='rounded-2xl border border-border bg-card p-4 shadow-sm'>
          <div className='flex flex-col gap-2 md:flex-row md:items-center md:justify-between'>
            <div>
              <h2 className='text-base font-bold text-foreground'>{t("Monitorinq necə işləyir?")}</h2>
              <p className='text-sm leading-6 text-muted-foreground'>{t("Sistem açar sözlərinizi media mənbələrində yoxlayır. Uyğun material tapıldıqda nəticələr və bildirişlər bölməsində görünür.")}</p>
            </div>
            <div className='flex flex-wrap gap-2 text-sm'>
              <span className='inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-emerald-700'>
                <CheckCircle2 className='h-4 w-4' />{t("Monitor aktivdir")}</span>
              <span className='rounded-full border border-border px-2 py-1 text-muted-foreground'>{t("Nəticələr avtomatik yenilənir")}</span>
            </div>
          </div>
        </section>
      ) : null}

      <section className='overflow-hidden rounded-2xl border border-border bg-card shadow-sm'>
        <div className='flex flex-col items-start justify-between gap-3 border-b border-border p-4 sm:flex-row sm:items-center'>
          <div>
            <h2 className='text-lg font-bold text-foreground'>{t("Son uyğunluqlar")}</h2>
            <p className='text-sm text-muted-foreground'>{t("Ən yeni monitor nəticələri")}</p>
          </div>

          <Link
            to='/monitor/results'
            className='rounded-lg border border-border px-3 py-2 text-sm font-semibold hover:bg-muted/50'
          >{t("Hamısı")}</Link>
        </div>

        {recentMatches.length === 0 ? (
          <div className='grid gap-2 p-8 text-center'>
            <div className='font-semibold text-foreground'>
              {hasNoMonitors
                ? t("Başlamaq üçün monitor yaradın")
                : t("Hələ nəticə yoxdur")}
            </div>
            <p className='mx-auto max-w-md text-sm leading-6 text-muted-foreground'>
              {hasNoMonitors
                ? t("İlk monitoru yaratdıqdan və açar söz əlavə etdikdən sonra sistem uyğun media materiallarını izləməyə başlayacaq.")
                : t("Monitorlarınız yeni uyğun media materialı tapdıqda son nəticələr burada görünəcək.")}
            </p>
            <Link
              to='/monitor/monitors'
              className='mx-auto mt-2 rounded-lg border border-border px-3 py-2 text-sm font-semibold hover:bg-muted/50'
            >
              {hasNoMonitors ? t("İlk monitoru yarat") : t("Monitorları yoxla")}
            </Link>
          </div>
        ) : (
          <div className='grid gap-0'>
            {recentMatches.map((match) => {
              const item = match.monitored_items

              return (
                <article
                  key={match.id}
                  className='border-t border-border p-4 first:border-t-0'
                >
                  <div className='grid gap-3 lg:grid-cols-[1fr_auto]'>
                    <div className='min-w-0'>
                      <div className='mb-2 flex flex-wrap items-center gap-2'>
                        <span className='rounded-full border border-border px-2 py-1 text-xs text-muted-foreground'>
                          {match.user_monitors?.name || t("Monitor")}
                        </span>
                        <span className='rounded-full border border-border px-2 py-1 text-xs text-muted-foreground'>
                          {match.matched_keyword || '-'}
                        </span>
                        <span className='text-xs text-muted-foreground'>
                          {formatDate(match.created_at)}
                        </span>
                      </div>

                      {item ? (
                        <a
                          href={item.url}
                          target='_blank'
                          rel='noreferrer'
                          className='line-clamp-2 font-bold text-foreground hover:underline'
                        >
                          {decodeHtml(item.title)}
                        </a>
                      ) : (
                        <div className='font-semibold text-muted-foreground'>{t("Xəbər tapılmadı")}</div>
                      )}
                    </div>

                    {item ? (
                      <a
                        href={item.url}
                        target='_blank'
                        rel='noreferrer'
                        className='inline-flex items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-muted/50'
                      >{t("Aç")}<ExternalLink className='h-4 w-4' />
                      </a>
                    ) : null}
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}

export const Route = createFileRoute('/(auth)/monitor/')({
  component: UserMonitorDashboard,
})
