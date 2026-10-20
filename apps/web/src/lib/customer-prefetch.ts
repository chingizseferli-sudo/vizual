import { type QueryClient } from '@tanstack/react-query'
import { customerQueryKeys } from '@/lib/query-keys'
import { supabase } from '@/lib/supabase'

const EMPTY_DASHBOARD = {
  monitorCount: 0,
  keywordCount: 0,
  resultCount: 0,
  alertCount: 0,
  recentMatches: [],
}

async function getCurrentUserId() {
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return user?.id || ''
}

async function fetchMonitorIds(userId: string) {
  const { data, error } = await supabase
    .from('user_monitors')
    .select('id')
    .eq('user_id', userId)

  if (error) throw new Error(error.message)
  return (data || []).map((item) => item.id)
}

async function prefetchDashboardData() {
  const userId = await getCurrentUserId()
  if (!userId) return EMPTY_DASHBOARD

  const monitorIds = await fetchMonitorIds(userId)
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

  const matches = matchesRes.data || []
  const matchIds = matches.map((item) => item.id)
  let alertCount = 0

  if (matchIds.length > 0) {
    const { count } = await supabase
      .from('monitor_alerts')
      .select('id', { count: 'exact', head: true })
      .in('match_id', matchIds)
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

async function loadMonitorPlanLimits(userId: string) {
  const unavailable = {
    available: false,
    name: null,
    maxWatches: null,
    warning: 'Plan məlumatı hələ aktiv deyil.',
  }

  const profilePlan = await supabase
    .from('user_profiles')
    .select('plan_id')
    .eq('user_id', userId)
    .maybeSingle()

  const planId = (profilePlan.data as { plan_id?: string | null } | null)
    ?.plan_id
  if (profilePlan.error || !planId) return unavailable

  const planResult = await supabase
    .from('subscription_plans')
    .select('name,max_watches')
    .eq('id', planId)
    .maybeSingle()

  if (planResult.error || !planResult.data) return unavailable

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

async function prefetchMonitorsData() {
  const userId = await getCurrentUserId()
  if (!userId) throw new Error('İstifadəçi sessiyası tapılmadı.')

  const [profileRes, monitorRes, planRes] = await Promise.all([
    supabase
      .from('user_profiles')
      .select('user_id,telegram_chat_id')
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('user_monitors')
      .select('id,name,description,status,telegram_chat_id,created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false }),
    loadMonitorPlanLimits(userId),
  ])

  if (monitorRes.error)
    throw new Error(`Monitorlar oxunmadı: ${monitorRes.error.message}`)

  const monitors = monitorRes.data || []
  const monitorIds = monitors.map((item) => item.id)

  if (monitorIds.length === 0) {
    return {
      userId,
      profile: profileRes.error ? null : profileRes.data || null,
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

  return {
    userId,
    profile: profileRes.error ? null : profileRes.data || null,
    planLimits: planRes,
    monitors,
    keywords: keywordsRes.error ? [] : keywordsRes.data || [],
    matches: matchesRes.error ? [] : matchesRes.data || [],
    message: keywordsRes.error
      ? `Açar sözlər oxunmadı: ${keywordsRes.error.message}`
      : '',
  }
}

async function prefetchWatchMonitorData() {
  const userId = await getCurrentUserId()
  if (!userId) return { userId: '', watches: [], events: [] }

  const { data: watches, error: watchesError } = await supabase
    .from('change_sources')
    .select(
      'id,user_id,name,url,domain,selector,status,interval_minutes,last_checked_at,last_changed_at,last_success_at,last_error,consecutive_fail_count,created_at'
    )
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (watchesError) throw new Error(watchesError.message)

  const watchRows = watches || []
  const watchIds = watchRows.map((watch) => watch.id)
  if (watchIds.length === 0) return { userId, watches: watchRows, events: [] }

  const { data: events, error: eventsError } = await supabase
    .from('change_events')
    .select('id,source_id,diff_summary,created_at')
    .in('source_id', watchIds)
    .order('created_at', { ascending: false })
    .limit(150)

  if (eventsError) throw new Error(eventsError.message)

  return { userId, watches: watchRows, events: events || [] }
}
async function prefetchResultsData() {
  const userId = await getCurrentUserId()
  if (!userId) {
    return {
      rows: [],
      errorMessage: 'Sessiya tapılmadı. Zəhmət olmasa yenidən daxil olun.',
    }
  }

  const monitorIds = await fetchMonitorIds(userId)
  if (monitorIds.length === 0) return { rows: [], errorMessage: '' }

  const retentionStart = new Date()
  retentionStart.setDate(retentionStart.getDate() - 31)

  const { data, error } = await supabase
    .from('monitor_matches')
    .select(
      'id,monitor_id,item_id,matched_keyword,created_at,user_monitors(name),monitored_items(title,url,published_at,detected_at,status)'
    )
    .in('monitor_id', monitorIds)
    .gte('created_at', retentionStart.toISOString())
    .order('created_at', { ascending: false })
    .limit(1000)

  if (error) {
    return { rows: [], errorMessage: 'Nəticələri yükləmək mümkün olmadı.' }
  }

  return { rows: data || [], errorMessage: '' }
}

async function prefetchAlertsData() {
  const userId = await getCurrentUserId()
  if (!userId) {
    return {
      alerts: [],
      errorMessage: 'Sessiya tapılmadı. Zəhmət olmasa yenidən daxil olun.',
    }
  }

  const monitorIds = await fetchMonitorIds(userId)
  if (monitorIds.length === 0) return { alerts: [], errorMessage: '' }

  const { data: matches, error: matchesError } = await supabase
    .from('monitor_matches')
    .select('id')
    .in('monitor_id', monitorIds)

  if (matchesError)
    return { alerts: [], errorMessage: 'Bildiriş məlumatları yüklənmədi.' }

  const matchIds = (matches || []).map((item) => item.id)
  if (matchIds.length === 0) return { alerts: [], errorMessage: '' }

  const { data, error } = await supabase
    .from('monitor_alerts')
    .select(
      'id,match_id,channel,recipient,status,sent_at,monitor_matches(id,matched_keyword,user_monitors(name),monitored_items(title,url))'
    )
    .in('match_id', matchIds)
    .order('sent_at', { ascending: false })
    .limit(300)

  if (error) {
    return { alerts: [], errorMessage: 'Bildirişləri yükləmək mümkün olmadı.' }
  }

  return { alerts: data || [], errorMessage: '' }
}

async function prefetchProfileData() {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return {
      profileState: null,
      errorMessage: 'Sessiya tapılmadı. Zəhmət olmasa yenidən daxil olun.',
    }
  }

  const [profileResult, monitorCountResult, planResult, socialResult] =
    await Promise.all([
      supabase
        .from('user_profiles')
        .select('user_id,email,role,status,telegram_chat_id')
        .eq('user_id', user.id)
        .maybeSingle(),
      supabase
        .from('user_monitors')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id),
      (async () => {
        const profilePlan = await supabase
          .from('user_profiles')
          .select('plan_id')
          .eq('user_id', user.id)
          .maybeSingle()
        const planId = (profilePlan.data as { plan_id?: string | null } | null)
          ?.plan_id
        if (profilePlan.error || !planId)
          return { plan: null, available: false }
        const planResult = await supabase
          .from('subscription_plans')
          .select('name,max_watches,history_days,telegram_enabled')
          .eq('id', planId)
          .maybeSingle()
        if (planResult.error || !planResult.data)
          return { plan: null, available: false }
        return { plan: planResult.data, available: true }
      })(),
      supabase.rpc('current_user_social_access').maybeSingle(),
    ])

  const profile = profileResult.data || null

  const getRoleLabel = (role: string | null) => {
    if (role === 'superadmin') return 'Superadmin'
    if (role === 'admin') return 'Admin'
    return 'İstifadəçi'
  }
  const getStatusLabel = (status: string | null) => {
    if (status === 'active') return 'Aktiv'
    if (status === 'blocked') return 'Bloklanıb'
    return status || '-'
  }

  return {
    profileState: {
      email: profile?.email || user.email || '-',
      role: getRoleLabel(profile?.role || null),
      status: getStatusLabel(profile?.status || null),
      createdAt: user.created_at || null,
      telegramChatId: profile?.telegram_chat_id || null,
      monitorCount: monitorCountResult.count || 0,
      plan: planResult.plan,
      planAvailable: planResult.available,
      social: socialResult.error ? null : socialResult.data,
    },
    errorMessage: profileResult.error
      ? 'Profil məlumatları tam yüklənmədi. Əsas hesab məlumatları göstərilir.'
      : '',
  }
}

export function prefetchCustomerRoute(queryClient: QueryClient, url: string) {
  if (url === '/monitor') {
    void queryClient.prefetchQuery({
      queryKey: customerQueryKeys.dashboard(),
      queryFn: prefetchDashboardData,
      staleTime: 30 * 1000,
    })
    return
  }

  if (url === '/monitor/monitors') {
    void queryClient.prefetchQuery({
      queryKey: customerQueryKeys.monitors(),
      queryFn: prefetchMonitorsData,
      staleTime: 60 * 1000,
    })
    return
  }

  if (url === '/monitor/watch-monitor') {
    void queryClient.prefetchQuery({
      queryKey: customerQueryKeys.watchMonitor(),
      queryFn: prefetchWatchMonitorData,
      staleTime: 30 * 1000,
    })
    return
  }
  if (url === '/monitor/results') {
    void queryClient.prefetchQuery({
      queryKey: customerQueryKeys.results(),
      queryFn: prefetchResultsData,
      staleTime: 30 * 1000,
    })
    return
  }

  if (url === '/monitor/alerts') {
    void queryClient.prefetchQuery({
      queryKey: customerQueryKeys.alerts(),
      queryFn: prefetchAlertsData,
      staleTime: 30 * 1000,
    })
    return
  }

  if (url === '/monitor/profile') {
    void queryClient.prefetchQuery({
      queryKey: customerQueryKeys.profile(),
      queryFn: prefetchProfileData,
      staleTime: 5 * 60 * 1000,
    })
  }
}
