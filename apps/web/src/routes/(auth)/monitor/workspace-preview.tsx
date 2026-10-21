import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import {
  ArrowRight,
  Bell,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Newspaper,
  Radio,
  ShieldCheck,
} from 'lucide-react'
import { fetchAllMonitorIds } from '@/features/keywords/dashboard'
import { fetchKeywordsData } from '@/features/keywords/data'
import { customerQueryKeys } from '@/lib/query-keys'
import { supabase } from '@/lib/supabase'
import { dateLocale, t } from '@/lib/i18n'

type MatchRow = {
  id: string
  monitor_id: string
  matched_keyword: string | null
  created_at: string | null
  monitored_items: {
    title: string | null
    url: string | null
    published_at: string | null
    detected_at: string | null
  } | null
}

type AlertRow = {
  id: string
  status: string | null
  channel: string | null
  sent_at: string | null
  monitor_matches: {
    matched_keyword: string | null
    monitored_items: {
      title: string | null
      url: string | null
    } | null
  } | null
}

type ProfileRow = {
  telegram_chat_id: string | null
  plan_id?: string | null
}

type WorkspaceData = {
  activeKeywordCount: number
  keywordCount: number
  resultCount: number
  alertCount: number
  recentMatches: MatchRow[]
  recentAlerts: AlertRow[]
  telegramConnected: boolean
  planName: string | null
  maxKeywords: number | null
  errorMessage: string
}

const EMPTY_WORKSPACE: WorkspaceData = {
  activeKeywordCount: 0,
  keywordCount: 0,
  resultCount: 0,
  alertCount: 0,
  recentMatches: [],
  recentAlerts: [],
  telegramConnected: false,
  planName: null,
  maxKeywords: null,
  errorMessage: '',
}

function decodeHtml(text: string) {
  if (typeof document === 'undefined') return text
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
    hour: '2-digit',
    minute: '2-digit',
  })
}

function getHost(url: string | null | undefined) {
  if (!url) return t("Mənbə yoxdur")

  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

async function fetchWorkspaceData(): Promise<WorkspaceData> {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return {
      ...EMPTY_WORKSPACE,
      errorMessage: t("Sessiya tapılmadı. Zəhmət olmasa yenidən daxil olun."),
    }
  }

  let keywords: Awaited<ReturnType<typeof fetchKeywordsData>>
  let monitorIds: string[]
  try {
    ;[keywords, monitorIds] = await Promise.all([
      fetchKeywordsData(),
      fetchAllMonitorIds(user.id),
    ])
  } catch {
    return {
      ...EMPTY_WORKSPACE,
      errorMessage: t("Açar sözlər oxunmadı: {0}", [t("Naməlum xəta")]),
    }
  }

  const profileRes = await supabase
    .from('user_profiles')
    .select('telegram_chat_id,plan_id')
    .eq('user_id', user.id)
    .maybeSingle()
  const profile = (profileRes.data || null) as ProfileRow | null
  let planName: string | null = null

  if (profile?.plan_id) {
    const planRes = await supabase
      .from('subscription_plans')
      .select('name')
      .eq('id', profile.plan_id)
      .maybeSingle()
    planName = (planRes.data as { name?: string | null } | null)?.name || null
  }

  const keywordStats = {
    keywordCount: keywords.keywords.length,
    activeKeywordCount: keywords.activeCount,
    maxKeywords: keywords.maxKeywords,
    telegramConnected: Boolean(profile?.telegram_chat_id),
    planName,
  }

  if (monitorIds.length === 0) {
    return { ...EMPTY_WORKSPACE, ...keywordStats }
  }

  const [resultCountRes, matchesRes] = await Promise.all([
    supabase
      .from('monitor_matches')
      .select('id', { count: 'exact', head: true })
      .in('monitor_id', monitorIds),
    supabase
      .from('monitor_matches')
      .select(
        'id,monitor_id,matched_keyword,created_at,monitored_items(title,url,published_at,detected_at)'
      )
      .in('monitor_id', monitorIds)
      .order('created_at', { ascending: false })
      .limit(40),
  ])

  const recentMatches = uniqueByArticle(
    (matchesRes.data || []) as unknown as MatchRow[]
  ).slice(0, 8)
  const matchIds = recentMatches.map((match) => match.id)
  let alertCount = 0
  let recentAlerts: AlertRow[] = []

  if (matchIds.length > 0) {
    const [alertCountRes, alertsRes] = await Promise.all([
      supabase
        .from('monitor_alerts')
        .select('id', { count: 'exact', head: true })
        .in('match_id', matchIds),
      supabase
        .from('monitor_alerts')
        .select(
          'id,status,channel,sent_at,monitor_matches(matched_keyword,monitored_items(title,url))'
        )
        .in('match_id', matchIds)
        .order('sent_at', { ascending: false })
        .limit(5),
    ])

    alertCount = alertCountRes.count || 0
    recentAlerts = (alertsRes.data || []) as unknown as AlertRow[]
  }

  return {
    ...keywordStats,
    resultCount: resultCountRes.count || recentMatches.length,
    alertCount,
    recentMatches,
    recentAlerts,
    errorMessage: matchesRes.error
      ? t("Son nəticələri yükləmək mümkün olmadı.")
      : '',
  }
}

// One article can match several keywords and is stored once per match.
// Show it once and list every matched keyword.
function uniqueByArticle(rows: MatchRow[]): MatchRow[] {
  const byArticle = new Map<string, MatchRow>()
  for (const row of rows) {
    const item = row.monitored_items
    const key = (item?.url || item?.title || row.id).trim().toLowerCase()
    const seen = byArticle.get(key)
    if (!seen) {
      byArticle.set(key, { ...row })
      continue
    }
    const keywords = (seen.matched_keyword || '').split(', ').filter(Boolean)
    if (row.matched_keyword && !keywords.includes(row.matched_keyword)) {
      keywords.push(row.matched_keyword)
      seen.matched_keyword = keywords.join(', ')
    }
  }
  return [...byArticle.values()]
}

function SectionShell({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <section className='rounded-2xl border border-border bg-card p-4 shadow-sm'>
      <div className='mb-4 flex flex-col gap-1 border-b border-border pb-3'>
        <h2 className='text-base font-semibold text-foreground'>{title}</h2>
        {description ? (
          <p className='text-sm text-muted-foreground'>{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  )
}

function SummaryCard({
  label,
  value,
  note,
  icon: Icon,
}: {
  label: string
  value: string | number
  note: string
  icon: typeof Newspaper
}) {
  return (
    <div className='rounded-2xl border border-border bg-muted/50 p-4'>
      <div className='flex items-center justify-between gap-3'>
        <p className='text-sm font-semibold text-muted-foreground'>{label}</p>
        <Icon className='h-4 w-4 text-muted-foreground' />
      </div>
      <p className='mt-2 text-2xl font-semibold text-foreground'>{value}</p>
      <p className='mt-1 text-sm text-muted-foreground'>{note}</p>
    </div>
  )
}

function WorkspacePreviewPage() {
  const {
    data = EMPTY_WORKSPACE,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: customerQueryKeys.workspace(),
    queryFn: fetchWorkspaceData,
    staleTime: 30 * 1000,
  })

  const hasNoKeywords = data.keywordCount === 0
  const latestMatch = data.recentMatches[0]
  const latestMatchTime = latestMatch?.created_at
    ? formatDate(latestMatch.created_at)
    : '-'
  const planUsage =
    data.maxKeywords !== null
      ? `${data.activeKeywordCount} / ${data.maxKeywords}`
      : `${data.activeKeywordCount}`
  const signals = [
    data.resultCount > 0
      ? t("{0} uyğun media nəticəsi tapılıb.", [data.resultCount])
      : t("Hələ uyğun media nəticəsi yoxdur."),
    data.alertCount > 0
      ? t("{0} bildiriş qeydi mövcuddur.", [data.alertCount])
      : t("Bildiriş yaranması üçün əvvəlcə uyğun nəticə tapılmalıdır."),
    data.activeKeywordCount > 0
      ? t("{0} açar söz aktiv izləmədədir.", [data.activeKeywordCount])
      : t("Aktiv açar söz yoxdur. Açar söz əlavə edərək izləməyə başlayın."),
  ]

  if (isLoading) {
    return (
      <div className='flex min-h-[360px] items-center justify-center p-6 text-muted-foreground'>
        <Loader2 className='mr-2 h-5 w-5 animate-spin' />
        <span>{t("İş masası yüklənir...")}</span>
      </div>
    )
  }

  return (
    <section className='mx-auto grid w-full max-w-7xl gap-4 p-4 md:p-6'>
      <section className='rounded-2xl border border-border bg-card p-5 shadow-sm md:p-6'>
        <div className='grid gap-5 lg:grid-cols-[1.4fr_0.75fr] lg:items-end'>
          <div>
            <div className='inline-flex rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary'>{t("Dinamik iş masası")}</div>
            <p className='mt-4 text-sm font-semibold text-muted-foreground'>{t("Sabahınız xeyir.")}</p>
            <h1 className='mt-2 max-w-3xl text-3xl font-semibold tracking-tight text-foreground md:text-5xl'>{t("Bu gün təşkilatınız haqqında nə baş verir?")}</h1>
            <p className='mt-4 max-w-2xl text-base leading-7 text-muted-foreground'>{t("Açar sözlərinizin son vəziyyəti, tapılan nəticələr və bildirişlər burada bir səhifədə toplanır.")}</p>
          </div>
          <div className='rounded-2xl border border-emerald-200 bg-emerald-50 p-4'>
            <div className='flex items-center gap-2 text-sm font-semibold text-emerald-700'>
              <CheckCircle2 className='h-4 w-4' />{t("Günün statusu")}</div>
            <p className='mt-3 text-2xl font-semibold text-foreground'>
              {data.activeKeywordCount > 0
                ? t("Monitorinq aktivdir")
                : t("Başlamağa hazırdır")}
            </p>
            <p className='mt-2 text-sm text-muted-foreground'>{t("Son yoxlama:")}{' '}{latestMatchTime}
            </p>
          </div>
        </div>
      </section>

      {isError || data.errorMessage ? (
        <div className='rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800'>
          <div className='font-semibold'>{t("İş masası tam yüklənmədi.")}</div>
          <p className='mt-1'>
            {data.errorMessage || t("Məlumatları yükləmək mümkün olmadı.")}
          </p>
          <button
            type='button'
            onClick={() => refetch()}
            className='mt-3 rounded-lg border border-amber-300 bg-card px-3 py-2 text-sm font-bold'
          >{t("Yenidən yoxla")}</button>
        </div>
      ) : null}

      <SectionShell
        title={t("Bugünkü xülasə")}
        description={t("İstifadəçi hesabınızdan oxunan real monitorinq göstəriciləri.")}
      >
        <div className='grid gap-3 md:grid-cols-2 xl:grid-cols-4'>
          <SummaryCard
            label={t("Yeni media materialı")}
            value={data.resultCount}
            note={t("Tapılan uyğun nəticələr")}
            icon={Newspaper}
          />
          <SummaryCard
            label={t("Bildiriş")}
            value={data.alertCount}
            note={t("Son nəticələr üzrə bildiriş qeydləri")}
            icon={Bell}
          />
          <SummaryCard
            label={t("Aktiv açar söz")}
            value={data.activeKeywordCount}
            note={t("{0} açar söz içindən", [data.keywordCount])}
            icon={Radio}
          />
          <SummaryCard
            label={t("Plan istifadəsi")}
            value={planUsage}
            note={data.planName || t("Plan məlumatı aktiv deyil")}
            icon={ShieldCheck}
          />
        </div>
      </SectionShell>

      <div className='grid gap-4 xl:grid-cols-[0.85fr_1.15fr]'>
        <SectionShell
          title='Vacib siqnallar'
          description={t("Cari hesab datasına görə qısa qərar siqnalları.")}
        >
          <div className='grid gap-2'>
            {signals.map((signal) => (
              <div
                key={signal}
                className='rounded-xl border border-border bg-muted/50 p-3 text-sm font-semibold text-foreground'
              >
                {signal}
              </div>
            ))}
          </div>
        </SectionShell>

        <SectionShell
          title={t("Media axını")}
          description={t("Açar sözlər üzrə tapılmış son media materialları.")}
        >
          {data.recentMatches.length === 0 ? (
            <div className='rounded-xl border border-dashed border-border p-6 text-center'>
              <div className='font-semibold text-foreground'>
                {hasNoKeywords ? t("Açar söz əlavə edin") : t("Hələ nəticə yoxdur")}
              </div>
              <p className='mx-auto mt-1 max-w-md text-sm text-muted-foreground'>
                {hasNoKeywords
                  ? t("Açar söz əlavə edin. Sistem uyğun materialları tapdıqca burada göstərəcək.")
                  : t("Sistem mənbələri yoxladıqca uyğun nəticələr bu axında görünəcək.")}
              </p>
              <Link
                to='/monitor/keywords'
                className='mt-3 inline-flex rounded-lg border border-border px-3 py-2 text-sm font-bold hover:bg-muted/50'
              >{t("Açar sözlərə keç")}</Link>
            </div>
          ) : (
            <div className='grid gap-2'>
              {data.recentMatches.map((match) => {
                const item = match.monitored_items
                const title = item?.title
                  ? decodeHtml(item.title)
                  : t("Başlıq yoxdur")

                return (
                  <article
                    key={match.id}
                    className='rounded-xl border border-border p-3 transition hover:bg-muted/50'
                  >
                    <div className='flex flex-col gap-3 md:flex-row md:items-center md:justify-between'>
                      <div className='min-w-0'>
                        <div className='flex flex-wrap gap-2 text-xs font-bold text-muted-foreground'>
                          <span>{getHost(item?.url)}</span>
                          <span>{match.matched_keyword || t("Açar söz")}</span>
                          <span>{formatDate(match.created_at)}</span>
                        </div>
                        <h3 className='mt-1 line-clamp-2 text-sm leading-5 font-semibold text-foreground'>
                          {title}
                        </h3>
                      </div>
                      {item?.url ? (
                        <a
                          href={item.url}
                          target='_blank'
                          rel='noreferrer'
                          className='inline-flex w-fit items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-bold hover:bg-card'
                        >{t("Mənbəyə bax")}<ExternalLink className='h-3.5 w-3.5' />
                        </a>
                      ) : null}
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </SectionShell>
      </div>

      <div className='grid gap-4 xl:grid-cols-[1.1fr_0.9fr]'>
        <SectionShell
          title={t("Növbəti ən yaxşı addım")}
          description={t("Cari vəziyyətə uyğun praktik keçidlər.")}
        >
          <div className='grid gap-3 md:grid-cols-3'>
            {[
              {
                label: hasNoKeywords
                  ? t("İlk açar sözü əlavə et")
                  : t("Açar sözləri idarə et"),
                description: t("İzlənən açar sözləri yeniləyin"),
                to: '/monitor/keywords' as const,
              },
              {
                label: t("Nəticələrə bax"),
                description: t("Tapılan media materiallarını açın"),
                to: '/monitor/results' as const,
              },
              {
                label: t("Bildirişləri yoxla"),
                description: t("Göndərilən bildiriş tarixçəsinə baxın"),
                to: '/monitor/alerts' as const,
              },
            ].map((action) => (
              <Link
                key={action.label}
                to={action.to}
                className='rounded-2xl border border-border p-4 transition hover:border-primary/20 hover:bg-primary/10'
              >
                <div className='flex items-center justify-between gap-2 font-semibold text-foreground'>
                  {action.label}
                  <ArrowRight className='h-4 w-4' />
                </div>
                <p className='mt-1 text-sm text-muted-foreground'>
                  {action.description}
                </p>
              </Link>
            ))}
          </div>
        </SectionShell>

        <SectionShell
          title={t("İş masası sağlamlığı")}
          description={t("Hesabın iş üçün hazır olub-olmadığını göstərən status bloku.")}
        >
          <div className='grid gap-2'>
            {[
              [
                t("Monitorinq"),
                data.activeKeywordCount > 0 ? t("Aktiv") : t("Açar söz lazımdır"),
              ],
              [t("Telegram"), data.telegramConnected ? t("Aktiv") : t("Aktiv deyil")],
              [t("Plan"), data.planName || t("Məlumat yoxdur")],
              [t("Son nəticə"), latestMatchTime],
            ].map(([label, value]) => (
              <div
                key={label}
                className='flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/50 px-3 py-2'
              >
                <span className='text-sm text-muted-foreground'>{label}</span>
                <span className='text-right text-sm font-semibold text-foreground'>
                  {value}
                </span>
              </div>
            ))}
          </div>
        </SectionShell>
      </div>
    </section>
  )
}

export const Route = createFileRoute('/(auth)/monitor/workspace-preview')({
  component: WorkspacePreviewPage,
})
