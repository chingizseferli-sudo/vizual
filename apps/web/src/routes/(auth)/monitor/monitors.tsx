import { useEffect, useMemo, useState } from 'react'
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { clientEnv } from '@/config/env'
import {
  Activity,
  Bell,
  CheckCircle2,
  Clock3,
  Hash,
  Loader2,
  Plus,
  Pencil,
  Search,
  Trash2,
} from 'lucide-react'
import { customerQueryKeys } from '@/lib/query-keys'
import { getStatusBadgeClass, getStatusLabel } from '@/lib/status-ui'
import { supabase } from '@/lib/supabase'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { dateLocale, t } from '@/lib/i18n'

type Monitor = {
  id: string
  name: string
  description: string | null
  status: string | null
  // Added by migration 20261020000002; read with select('*') so the page
  // works before it is applied.
  inactive_reason?: string | null
  telegram_chat_id: string | null
  created_at: string | null
}

type Keyword = {
  id: string
  monitor_id: string
  keyword: string
  match_type: string | null
  created_at: string | null
}

type Match = {
  id: string
  monitor_id: string
  created_at: string | null
}

type UserProfile = {
  user_id: string
  telegram_chat_id: string | null
}

type PlanLimitState = {
  available: boolean
  name: string | null
  maxWatches: number | null
  warning: string | null
}

type MonitorsData = {
  userId: string
  profile: UserProfile | null
  planLimits: PlanLimitState
  monitors: Monitor[]
  keywords: Keyword[]
  matches: Match[]
  message: string
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

function parseKeywordInput(value: string) {
  return value
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function uniqueKeywords(items: string[]) {
  const seen = new Set<string>()
  const result: string[] = []

  for (const item of items) {
    const key = item.toLocaleLowerCase('az-AZ')
    if (seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }

  return result
}

async function loadMonitorPlanLimits(userId: string): Promise<PlanLimitState> {
  const unavailable = {
    available: false,
    name: null,
    maxWatches: null,
    warning: t("Plan məlumatı hələ aktiv deyil."),
  }

  const profilePlan = await supabase
    .from('user_profiles')
    .select('plan_id')
    .eq('user_id', userId)
    .maybeSingle()

  const planId = (profilePlan.data as { plan_id?: string | null } | null)
    ?.plan_id

  if (profilePlan.error || !planId) {
    return unavailable
  }

  const planResult = await supabase
    .from('subscription_plans')
    .select('name,max_watches')
    .eq('id', planId)
    .maybeSingle()

  if (planResult.error || !planResult.data) {
    return unavailable
  }

  const plan = planResult.data as {
    name?: string | null
    max_watches?: number | null
  }

  return {
    available: true,
    name: plan.name || null,
    maxWatches: plan.max_watches ?? null,
    warning: null,
  }
}

function StatBox({
  label,
  value,
  icon: Icon,
}: {
  label: string
  value: string | number
  icon: typeof Activity
}) {
  return (
    <div className='rounded-2xl border border-border bg-card p-3 shadow-sm'>
      <div className='flex items-center justify-between gap-3'>
        <div>
          <div className='text-sm text-muted-foreground'>{label}</div>
          <div className='mt-1 text-lg font-semibold'>{value}</div>
        </div>
        <Icon className='h-5 w-5 text-muted-foreground' />
      </div>
    </div>
  )
}

async function fetchMonitorsData(): Promise<MonitorsData> {
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) throw new Error(t("İstifadəçi sessiyası tapılmadı."))

  const [profileRes, monitorRes, planRes] = await Promise.all([
    supabase
      .from('user_profiles')
      .select('user_id,telegram_chat_id')
      .eq('user_id', user.id)
      .maybeSingle(),

    supabase
      .from('user_monitors')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false }),

    loadMonitorPlanLimits(user.id),
  ])

  const profile = profileRes.error
    ? null
    : ((profileRes.data || null) as UserProfile | null)

  if (profileRes.error) {
    console.error('Profil oxuma xətası:', profileRes.error)
  }

  if (monitorRes.error) {
    console.error('Monitor oxuma xətası:', monitorRes.error)
    throw new Error(t("Monitorlar oxunmadı: {0}", [monitorRes.error.message]))
  }

  const monitors = (monitorRes.data || []) as Monitor[]
  const monitorIds = monitors.map((item) => item.id)

  if (monitorIds.length === 0) {
    return {
      userId: user.id,
      profile,
      planLimits: planRes,
      monitors,
      keywords: [],
      matches: [],
      message: '',
    }
  }

  const [keywordsRes, matchesRes] = await Promise.all([
    supabase
      .from('monitor_keywords')
      .select('id,monitor_id,keyword,match_type,created_at')
      .in('monitor_id', monitorIds)
      .order('created_at', { ascending: false }),

    supabase
      .from('monitor_matches')
      .select('id,monitor_id,created_at')
      .in('monitor_id', monitorIds)
      .order('created_at', { ascending: false }),
  ])

  let message = ''

  if (keywordsRes.error) {
    console.error('Keyword oxuma xətası:', keywordsRes.error)
    message = t("Açar sözlər oxunmadı: {0}", [keywordsRes.error.message])
  }

  if (matchesRes.error) {
    console.error('Nəticə oxuma xətası:', matchesRes.error)
  }

  return {
    userId: user.id,
    profile,
    planLimits: planRes,
    monitors,
    keywords: keywordsRes.error ? [] : ((keywordsRes.data || []) as Keyword[]),
    matches: matchesRes.error ? [] : ((matchesRes.data || []) as Match[]),
    message,
  }
}
function MonitorsPage() {
  const [monitors, setMonitors] = useState<Monitor[]>([])
  const [keywords, setKeywords] = useState<Keyword[]>([])
  const [matches, setMatches] = useState<Match[]>([])
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [planLimits, setPlanLimits] = useState<PlanLimitState>({
    available: false,
    name: null,
    maxWatches: null,
    warning: t("Plan məlumatı hələ aktiv deyil."),
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [currentUserId, setCurrentUserId] = useState('')
  const [message, setMessage] = useState('')
  const [newMonitorName, setNewMonitorName] = useState('')
  const [newMonitorDescription, setNewMonitorDescription] = useState('')
  const [newMonitorKeywords, setNewMonitorKeywords] = useState('')
  const [keywordDrafts, setKeywordDrafts] = useState<Record<string, string>>({})
  const [editingMonitorId, setEditingMonitorId] = useState<string | null>(null)
  const [editMonitorName, setEditMonitorName] = useState('')
  const [editMonitorDescription, setEditMonitorDescription] = useState('')
  const [actionMonitorId, setActionMonitorId] = useState<string | null>(null)
  const [deleteCandidate, setDeleteCandidate] = useState<Monitor | null>(null)
  const telegramBotUsername = clientEnv.telegramBotUsername
    .replace(/^@/, '')
    .trim()
  const queryClient = useQueryClient()
  const monitorsQuery = useQuery({
    queryKey: customerQueryKeys.monitors(),
    queryFn: fetchMonitorsData,
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
  })

  function invalidateCustomerMonitorCaches() {
    void queryClient.invalidateQueries({
      queryKey: customerQueryKeys.monitors(),
    })
    void queryClient.invalidateQueries({
      queryKey: customerQueryKeys.dashboard(),
    })
  }

  useEffect(() => {
    setLoading(monitorsQuery.isLoading && !monitorsQuery.data)

    if (monitorsQuery.error) {
      setMessage(
        monitorsQuery.error instanceof Error
          ? monitorsQuery.error.message
          : t("Monitorlar yüklənmədi.")
      )
    }

    if (!monitorsQuery.data) return

    setCurrentUserId(monitorsQuery.data.userId)
    setProfile(monitorsQuery.data.profile)
    setPlanLimits(monitorsQuery.data.planLimits)
    setMonitors(monitorsQuery.data.monitors)
    setKeywords(monitorsQuery.data.keywords)
    setMatches(monitorsQuery.data.matches)
    if (monitorsQuery.data.message) setMessage(monitorsQuery.data.message)
  }, [monitorsQuery.data, monitorsQuery.error, monitorsQuery.isLoading])

  const rows = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('az-AZ')

    return monitors
      .filter((monitor) => {
        if (!q) return true
        return [monitor.name, monitor.description || '', monitor.status || '']
          .join(' ')
          .toLocaleLowerCase('az-AZ')
          .includes(q)
      })
      .map((monitor) => {
        const monitorKeywords = keywords.filter(
          (item) => item.monitor_id === monitor.id
        )
        const monitorMatches = matches.filter(
          (item) => item.monitor_id === monitor.id
        )

        return {
          ...monitor,
          keywordCount: monitorKeywords.length,
          resultCount: monitorMatches.length,
          keywords: monitorKeywords,
          lastMatch: monitorMatches[0]?.created_at || null,
        }
      })
  }, [monitors, keywords, matches, search])

  const stats = useMemo(
    () => ({
      monitors: monitors.length,
      active: monitors.filter((item) => item.status === 'active').length,
      keywords: keywords.length,
      matches: matches.length,
    }),
    [monitors, keywords, matches]
  )

  async function addKeywordsToMonitor(monitorId: string, value: string) {
    const incoming = uniqueKeywords(parseKeywordInput(value))

    if (incoming.length === 0) {
      setMessage(t("Açar söz yazılmalıdır."))
      return false
    }

    const existing = new Set(
      keywords
        .filter((item) => item.monitor_id === monitorId)
        .map((item) => item.keyword.trim().toLocaleLowerCase('az-AZ'))
    )

    const fresh = incoming.filter(
      (item) => !existing.has(item.toLocaleLowerCase('az-AZ'))
    )

    if (fresh.length === 0) {
      setMessage(t("Bu açar sözlər artıq əlavə edilib."))
      return false
    }

    const { data, error } = await supabase
      .from('monitor_keywords')
      .insert(
        fresh.map((keyword) => ({
          monitor_id: monitorId,
          keyword,
          match_type: 'contains',
        }))
      )
      .select('id,monitor_id,keyword,match_type,created_at')

    if (error) {
      console.error('Açar söz əlavə xətası:', error)
      setMessage(t("Açar söz əlavə olunmadı: {0}", [error.message]))
      return false
    }

    setKeywords((prev) => [...((data || []) as Keyword[]), ...prev])
    setMessage(
      t("{0} açar söz əlavə olundu. Sistem mənbələri mütəmadi yoxlayacaq.", [fresh.length])
    )
    return true
  }

  async function createMonitor() {
    const name = newMonitorName.trim()

    if (!name) {
      setMessage(t("Monitor adı yazılmalıdır."))
      return
    }

    setSaving(true)

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      setSaving(false)
      setMessage(t("İstifadəçi sessiyası tapılmadı."))
      return
    }

    if (
      planLimits.available &&
      planLimits.maxWatches !== null &&
      monitors.length >= planLimits.maxWatches
    ) {
      setSaving(false)
      setMessage(
        planLimits.name
          ? t('{0} planı üzrə monitor limiti dolub: {1}/{2}.', [
              planLimits.name,
              monitors.length,
              planLimits.maxWatches,
            ])
          : t('Monitor limiti dolub: {0}/{1}.', [
              monitors.length,
              planLimits.maxWatches,
            ])
      )
      return
    }

    const { data, error } = await supabase.rpc(
      'create_user_monitor_with_limit',
      {
        p_name: name,
        p_description: newMonitorDescription.trim() || null,
        p_notify_telegram: true,
      }
    )

    const created = (Array.isArray(data) ? data[0] : data) as Monitor | null

    if (error || !created) {
      setSaving(false)
      console.error('Monitor yaratma xətası:', error)
      const isLimitError = error?.message?.includes('PLAN_WATCH_LIMIT_REACHED')
      setMessage(
        isLimitError
          ? t("Plan limitiniz dolub. Yeni monitor yaratmaq üçün mövcud monitorlardan birini silin və ya planınızı yüksəldin.")
          : t("Monitor yaradılmadı: {0}", [error?.message || t("Naməlum xəta")])
      )
      return
    }

    setMonitors((prev) => [created, ...prev])
    invalidateCustomerMonitorCaches()

    if (newMonitorKeywords.trim()) {
      await addKeywordsToMonitor(created.id, newMonitorKeywords)
      setMessage(
        t("Monitor yaradıldı və açar sözlər əlavə olundu. Sistem mənbələri mütəmadi yoxlayacaq.")
      )
    } else {
      setMessage(t("Monitor yaradıldı. Növbəti addım: Açar söz əlavə edin."))
    }

    setNewMonitorName('')
    setNewMonitorDescription('')
    setNewMonitorKeywords('')
    setSaving(false)
  }

  async function addKeyword(monitorId: string) {
    const value = keywordDrafts[monitorId] || ''
    const ok = await addKeywordsToMonitor(monitorId, value)

    if (ok) {
      setKeywordDrafts((prev) => ({
        ...prev,
        [monitorId]: '',
      }))
    }
  }

  async function deleteKeyword(keywordId: string, keyword: string) {
    const confirmed = window.confirm(t("\"{0}\" açar sözü silinsin?", [keyword]))

    if (!confirmed) return

    const { error } = await supabase
      .from('monitor_keywords')
      .delete()
      .eq('id', keywordId)

    if (error) {
      console.error('Açar söz silmə xətası:', error)
      setMessage(t("Açar söz silinmədi: {0}", [error.message]))
      return
    }

    setKeywords((prev) => prev.filter((item) => item.id !== keywordId))
    invalidateCustomerMonitorCaches()
    setMessage(t("Açar söz silindi: {0}", [keyword]))
  }

  function startEditMonitor(monitor: Monitor) {
    setEditingMonitorId(monitor.id)
    setEditMonitorName(monitor.name)
    setEditMonitorDescription(monitor.description || '')
    setMessage('')
  }

  function cancelEditMonitor() {
    setEditingMonitorId(null)
    setEditMonitorName('')
    setEditMonitorDescription('')
  }

  async function updateMonitor(monitor: Monitor) {
    const name = editMonitorName.trim()

    if (!name) {
      setMessage(t("Monitor adı yazılmalıdır."))
      return
    }

    setActionMonitorId(monitor.id)

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      setActionMonitorId(null)
      setMessage(t("İstifadəçi sessiyası tapılmadı."))
      return
    }

    const payload = {
      name,
      description: editMonitorDescription.trim() || null,
    }

    const { data, error } = await supabase
      .from('user_monitors')
      .update(payload)
      .eq('id', monitor.id)
      .eq('user_id', user.id)
      .select('*')
      .maybeSingle()

    setActionMonitorId(null)

    if (error || !data) {
      console.error('Monitor yeniləmə xətası:', error)
      setMessage(t("Monitor yenilənmədi: {0}", [error?.message || t("İcazə verilmədi")]))
      return
    }

    setMonitors((prev) =>
      prev.map((item) => (item.id === monitor.id ? (data as Monitor) : item))
    )
    invalidateCustomerMonitorCaches()
    cancelEditMonitor()
    setMessage(t("Monitor yeniləndi."))
  }

  async function deleteMonitor(monitor: Monitor) {
    setActionMonitorId(monitor.id)

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      setActionMonitorId(null)
      setMessage(t("İstifadəçi sessiyası tapılmadı."))
      return
    }

    const { error } = await supabase
      .from('user_monitors')
      .delete()
      .eq('id', monitor.id)
      .eq('user_id', user.id)

    setActionMonitorId(null)

    if (error) {
      console.error('Monitor silmə xətası:', error)
      setMessage(t("Monitor silinmədi: {0}", [error.message]))
      return
    }

    setMonitors((prev) => prev.filter((item) => item.id !== monitor.id))
    setKeywords((prev) => prev.filter((item) => item.monitor_id !== monitor.id))
    setMatches((prev) => prev.filter((item) => item.monitor_id !== monitor.id))
    invalidateCustomerMonitorCaches()
    setDeleteCandidate(null)
    setMessage(t("Monitor silindi."))
  }

  async function toggleMonitorStatus(monitor: Monitor) {
    const nextStatus = monitor.status === 'active' ? 'inactive' : 'active'
    setActionMonitorId(monitor.id)

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      setActionMonitorId(null)
      setMessage(t("İstifadəçi sessiyası tapılmadı."))
      return
    }

    const { error } = await supabase
      .from('user_monitors')
      .update({ status: nextStatus })
      .eq('id', monitor.id)
      .eq('user_id', user.id)

    setActionMonitorId(null)

    if (error) {
      console.error('Monitor status xətası:', error)
      setMessage(
        error.message.includes('PLAN_WATCH_LIMIT_REACHED')
          ? t("Planınızda aktiv monitor limiti dolub. Əvvəlcə başqa monitoru passiv edin və ya planı genişləndirin.")
          : t("Monitor statusu dəyişmədi: {0}", [error.message])
      )
      return
    }

    setMonitors((prev) =>
      prev.map((item) =>
        item.id === monitor.id
          ? {
              ...item,
              status: nextStatus,
              inactive_reason:
                nextStatus === 'active' ? null : item.inactive_reason,
            }
          : item
      )
    )
    invalidateCustomerMonitorCaches()
    setMessage(
      nextStatus === 'active'
        ? t("Monitor aktiv edildi.")
        : t("Monitor passiv edildi.")
    )
  }

  if (loading) {
    return (
      <div className='flex min-h-[360px] items-center justify-center p-6'>
        <Loader2 className='mr-2 h-5 w-5 animate-spin' />
        <span>{t("Monitorlar yüklənir...")}</span>
      </div>
    )
  }

  const telegramConnected = Boolean(profile?.telegram_chat_id)
  const monitorLimitReached =
    planLimits.available &&
    planLimits.maxWatches !== null &&
    monitors.length >= planLimits.maxWatches
  const telegramConfigured = Boolean(telegramBotUsername && currentUserId)

  return (
    <>
      <div className='grid gap-4 p-4 md:p-6'>
        <div>
          <h1 className='text-2xl font-bold tracking-tight'>Monitorlar</h1>
          <p className='text-muted-foreground'>{t("Monitorlar sistemin izlədiyi mövzu, təşkilat, şəxs və ya brend üzrə açar söz qaydalarıdır.")}</p>
        </div>

        {message ? (
          <div className='rounded-2xl border border-border bg-card px-4 py-3 text-sm shadow-sm'>
            {message}
          </div>
        ) : null}

        <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-4'>
          <StatBox label={t("Monitor")} value={stats.monitors} icon={Activity} />
          <StatBox label={t("Aktiv")} value={stats.active} icon={CheckCircle2} />
          <StatBox label={t("Açar söz")} value={stats.keywords} icon={Hash} />
          <StatBox label={t("Nəticə")} value={stats.matches} icon={Bell} />
        </div>

        <div className='grid gap-3 lg:grid-cols-[0.85fr_1.15fr]'>
          <section className='rounded-2xl border border-border bg-card p-3 shadow-sm'>
            <div className='mb-3'>
              <h2 className='text-base font-semibold'>{t("Yeni monitor")}</h2>
              <p className='text-sm text-muted-foreground'>{t("Monitor yaradın, açar sözləri əlavə edin və sistem uyğun media materiallarını tapdıqca nəticələri izləyin.")}</p>
            </div>

            <div className='mb-4 rounded-2xl border border-border bg-muted/40 p-3 text-sm text-muted-foreground'>
              <div className='font-medium text-foreground'>{t("Necə işləyir?")}</div>
              <ol className='mt-2 grid gap-1'>
                <li>{t("1. Monitor üçün aydın ad yazın.")}</li>
                <li>{t("2. Bir və ya bir neçə açar söz əlavə edin.")}</li>
                <li>{t("3. Sistem mənbələri mütəmadi yoxlayacaq və uyğun nəticələri burada göstərəcək.")}</li>
              </ol>
            </div>

            <div
              className={
                monitorLimitReached
                  ? 'mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700'
                  : 'mb-4 rounded-xl border border-border bg-card p-3 text-sm text-muted-foreground'
              }
            >
              <div className='font-medium text-foreground'>{t("Plan istifadəsi")}</div>
              <div className='mt-1'>{t("Cari monitor sayı:")}{' '}{monitors.length}
                {planLimits.maxWatches !== null
                  ? ' / ' + planLimits.maxWatches
                  : ''}
              </div>
              <div className='mt-1'>
                {planLimits.available
                  ? t('Plan: {0}', [planLimits.name || '-'])
                  : planLimits.warning || t("Plan limiti aktiv deyil.")}
              </div>
              {monitorLimitReached ? (
                <div className='mt-1 font-medium'>{t("Yeni monitor yaratmaq üçün limit boşalmalıdır.")}</div>
              ) : null}
            </div>

            <div className='grid gap-3'>
              <input
                aria-label={t("Monitor adı")}
                value={newMonitorName}
                onChange={(event) => setNewMonitorName(event.target.value)}
                placeholder={t("Monitor adı, məsələn: ADA Universiteti")}
                className='rounded-xl border border-border bg-card px-3 py-2'
              />

              <input
                aria-label={t("Qısa təsvir")}
                value={newMonitorDescription}
                onChange={(event) =>
                  setNewMonitorDescription(event.target.value)
                }
                placeholder={t("Qısa təsvir, məsələn: universitetlə bağlı media izləmə")}
                className='rounded-xl border border-border bg-card px-3 py-2'
              />

              <textarea
                aria-label={t("Monitorun açar sözləri")}
                value={newMonitorKeywords}
                onChange={(event) => setNewMonitorKeywords(event.target.value)}
                placeholder={t("Açar sözləri vergül və ya yeni sətrlə yaz: universitet adı, şirkət, brend, şəxs, layihə, dəqiq ifadə")}
                className='min-h-20 rounded-xl border border-border bg-card px-3 py-2 text-sm'
              />
              <div className='rounded-xl border border-border bg-card p-3 text-xs text-muted-foreground'>{t("Nümunələr: “Bakı Dövlət Universiteti”, “Mərkəzi Bank”, “Azercell”, “rektor adı”, “yeni layihə”, “dəqiq sitat”. Bir neçə açar sözü vergül və ya ayrı sətirlə əlavə edə bilərsiniz.")}</div>

              <button
                type='button'
                onClick={createMonitor}
                disabled={saving || monitorLimitReached}
                className='inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-60'
              >
                {saving ? (
                  <Loader2 className='h-4 w-4 animate-spin' />
                ) : (
                  <Plus className='h-4 w-4' />
                )}{t("Monitor yarat")}</button>
            </div>
          </section>

          <section className='rounded-2xl border border-border bg-card p-3 shadow-sm'>
            <div className='mb-4 flex items-center justify-between gap-3'>
              <div>
                <h2 className='text-base font-semibold'>{t("Telegram bildirişləri")}</h2>
                <p className='text-sm text-muted-foreground'>{t("Qoşulma və bildiriş kanalları Profil səhifəsində idarə olunur.")}</p>
              </div>

              <span
                className={
                  telegramConnected
                    ? 'rounded-full border border-green-200 bg-green-50 px-3 py-1 text-sm text-green-700'
                    : 'rounded-full border px-3 py-1 text-sm text-muted-foreground'
                }
              >
                {telegramConnected ? t("Aktiv") : t("Aktiv deyil")}
              </span>
            </div>

            <div className='grid gap-3'>
              <div className='rounded-xl border border-border bg-muted/40 p-4 text-sm text-muted-foreground'>
                {telegramConnected ? (
                  <p>{t("Telegram bildirişləri aktivdir. Bot yeni uyğun nəticələr tapıldıqda sizi xəbərdar edə bilər.")}</p>
                ) : (
                  <p>{t("Telegram bildirişlərini aktivləşdirmək üçün Profil səhifəsində Telegram kanalını qoşun.")}</p>
                )}
              </div>

              {telegramConfigured ? (
                <a
                  href='/monitor/profile'
                  className='inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted'
                >{t("Profilə keç")}</a>
              ) : (
                <div className='rounded-lg border p-3 text-sm text-muted-foreground'>{t("Telegram botu hələ konfiqurasiya edilməyib.")}</div>
              )}
            </div>
          </section>
        </div>

        <div className='rounded-2xl border border-border bg-card p-3 shadow-sm'>
          <div className='relative'>
            <Search className='pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground' />
            <input
              aria-label={t("Monitor adı, təsvir və ya status üzrə axtar...")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("Monitor adı, təsvir və ya status üzrə axtar...")}
              className='w-full rounded-xl border border-border bg-card py-2 pr-3 pl-9'
            />
          </div>
        </div>

        <div className='grid gap-4'>
          {rows.map((monitor) => (
            <section
              key={monitor.id}
              className='rounded-2xl border border-border bg-card shadow-sm'
            >
              <div className='grid gap-3 border-b p-3 lg:grid-cols-[1.2fr_0.45fr_0.45fr_0.65fr_auto]'>
                <div>
                  {editingMonitorId === monitor.id ? (
                    <div className='grid gap-2'>
                      <input
                        aria-label={t("Monitor adı")}
                        value={editMonitorName}
                        onChange={(event) =>
                          setEditMonitorName(event.target.value)
                        }
                        className='rounded-xl border border-border bg-card px-3 py-2 text-sm'
                        placeholder={t("Monitor adı")}
                      />
                      <input
                        aria-label={t("Qısa təsvir")}
                        value={editMonitorDescription}
                        onChange={(event) =>
                          setEditMonitorDescription(event.target.value)
                        }
                        className='rounded-xl border border-border bg-card px-3 py-2 text-sm'
                        placeholder={t("Qısa təsvir")}
                      />
                    </div>
                  ) : (
                    <>
                      <h2 className='text-base font-semibold'>
                        {monitor.name}
                      </h2>
                      <p className='text-sm text-muted-foreground'>
                        {monitor.description || t("Təsvir yoxdur")}
                      </p>
                    </>
                  )}
                </div>

                <div>
                  <div className='text-xs text-muted-foreground'>{t("Status")}</div>
                  <span
                    className={`mt-1 inline-flex rounded-full border px-2 py-1 text-xs ${getStatusBadgeClass(monitor.status)}`}
                  >
                    {getStatusLabel(monitor.status)}
                  </span>
                  {monitor.status !== 'active' &&
                  monitor.inactive_reason === 'plan_limit' ? (
                    <p className='mt-1 text-xs text-muted-foreground'>{t("Plan limitini aşdığı üçün deaktiv edilib.")}</p>
                  ) : null}
                </div>

                <div>
                  <div className='text-xs text-muted-foreground'>{t("Nəticə")}</div>
                  <div className='mt-1 text-lg font-semibold'>
                    {monitor.resultCount}
                  </div>
                </div>

                <div>
                  <div className='flex items-center gap-1 text-xs text-muted-foreground'>
                    <Clock3 className='h-3.5 w-3.5' />{t("Son uyğunluq")}</div>
                  <div className='mt-1 text-sm'>
                    {formatDate(monitor.lastMatch)}
                  </div>
                </div>

                <div className='flex flex-wrap items-start gap-1.5 lg:justify-end'>
                  {editingMonitorId === monitor.id ? (
                    <>
                      <button
                        type='button'
                        onClick={() => updateMonitor(monitor)}
                        disabled={actionMonitorId === monitor.id}
                        className='rounded-lg bg-primary px-2.5 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-60'
                      >{t("Yadda saxla")}</button>
                      <button
                        type='button'
                        onClick={cancelEditMonitor}
                        disabled={actionMonitorId === monitor.id}
                        className='rounded-lg border px-2.5 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-60'
                      >{t("Ləğv et")}</button>
                    </>
                  ) : (
                    <>
                      <button
                        type='button'
                        onClick={() => startEditMonitor(monitor)}
                        className='inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm font-medium hover:bg-muted'
                      >
                        <Pencil className='h-4 w-4' />{t("Redaktə et")}</button>
                      <button
                        type='button'
                        onClick={() => toggleMonitorStatus(monitor)}
                        disabled={actionMonitorId === monitor.id}
                        className='rounded-lg border px-2.5 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-60'
                      >
                        {monitor.status === 'active' ? t("Passiv et") : t("Aktiv et")}
                      </button>
                      <button
                        type='button'
                        onClick={() => setDeleteCandidate(monitor)}
                        disabled={actionMonitorId === monitor.id}
                        className='rounded-lg border border-destructive/40 px-2.5 py-1.5 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-60'
                      >{t("Sil")}</button>
                    </>
                  )}
                </div>
              </div>

              <div className='grid gap-3 p-3'>
                <div className='grid gap-3 md:grid-cols-[1fr_auto]'>
                  <textarea
                    aria-label={t("Yeni açar sözlər")}
                    value={keywordDrafts[monitor.id] || ''}
                    onChange={(event) =>
                      setKeywordDrafts((prev) => ({
                        ...prev,
                        [monitor.id]: event.target.value,
                      }))
                    }
                    placeholder={t("Yeni açar sözlər: təşkilat, brend, şəxs, layihə və ya dəqiq ifadə")}
                    className='min-h-14 rounded-xl border border-border bg-card px-3 py-2 text-sm'
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && event.ctrlKey)
                        addKeyword(monitor.id)
                    }}
                  />

                  <button
                    type='button'
                    onClick={() => addKeyword(monitor.id)}
                    className='inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted'
                  >
                    <Plus className='h-4 w-4' />{t("Əlavə et")}</button>
                </div>

                {monitor.keywords.length === 0 ? (
                  <div className='rounded-2xl border border-border bg-muted/40 p-4 text-sm text-muted-foreground'>
                    <div className='font-medium text-foreground'>{t("Bu monitorda hələ açar söz yoxdur.")}</div>
                    <p className='mt-1'>{t("Nəticələrin gəlməsi üçün ən azı bir açar söz əlavə edin. Sistem mənbələri mütəmadi yoxlayır; uyğun nəticələr aşkar olunduqca burada görünəcək.")}</p>
                    <p className='mt-2 text-xs'>{t("Nümunə: universitet adı, şirkət adı, brend, şəxs, layihə və ya dəqiq ifadə.")}</p>
                  </div>
                ) : (
                  <div className='flex flex-wrap gap-2'>
                    {monitor.keywords.map((item) => (
                      <div
                        key={item.id}
                        className='inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1 text-sm'
                      >
                        <span>{item.keyword}</span>
                        <button
                          type='button'
                          onClick={() => deleteKeyword(item.id, item.keyword)}
                          className='rounded-full p-0.5 text-muted-foreground hover:text-destructive'
                          title={t("Sil")}
                        >
                          <Trash2 className='h-3.5 w-3.5' />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          ))}

          {rows.length === 0 && (
            <div className='rounded-2xl border border-border bg-card p-8 text-center shadow-sm'>
              <div className='font-medium'>{t("Seçilmiş axtarışa uyğun monitor tapılmadı")}</div>
              <p className='mx-auto mt-1 max-w-md text-sm text-muted-foreground'>{t("İlk monitorunuzu yaradın, açar sözləri əlavə edin və nəticələri bu paneldən izləyin. Sistem mənbələri mütəmadi yoxladığı üçün nəticələr bir qədər sonra görünə bilər.")}</p>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={!!deleteCandidate}
        onOpenChange={(open) => {
          if (!open) setDeleteCandidate(null)
        }}
        title='Monitoru sil'
        desc={
          deleteCandidate
            ? t('"{0}" monitoru silinsin? Bu əməliyyat geri qaytarılmır.', [
                deleteCandidate.name,
              ])
            : t("Monitor silinsin?")
        }
        cancelBtnText={t("Ləğv et")}
        confirmText={t("Sil")}
        destructive
        isLoading={
          deleteCandidate ? actionMonitorId === deleteCandidate.id : false
        }
        handleConfirm={() => {
          if (deleteCandidate) void deleteMonitor(deleteCandidate)
        }}
        className='sm:max-w-md'
      />
    </>
  )
}

export const Route = createFileRoute('/(auth)/monitor/monitors')({
  component: MonitorsPage,
})
