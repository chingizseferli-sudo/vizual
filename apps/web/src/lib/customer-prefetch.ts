import { type QueryClient } from '@tanstack/react-query'
import {
  fetchAllMonitorIds,
  fetchDashboardData,
} from '@/features/keywords/dashboard'
import { fetchCompetitorsData } from '@/features/competitors/data'
import { fetchCustomerAlerts } from '@/features/keywords/alerts'
import { fetchKeywordsData } from '@/features/keywords/data'
import { customerQueryKeys } from '@/lib/query-keys'
import { supabase } from '@/lib/supabase'

async function getCurrentUserId() {
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return user?.id || ''
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

  const monitorIds = await fetchAllMonitorIds(userId)
  if (monitorIds.length === 0) return { rows: [], errorMessage: '' }

  const retentionStart = new Date()
  retentionStart.setDate(retentionStart.getDate() - 31)

  const { data, error } = await supabase
    .from('monitor_matches')
    .select(
      'id,monitor_id,item_id,matched_keyword,created_at,monitored_items(title,url,published_at,detected_at,status)'
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

  const [profileResult, keywordsResult, planResult, socialResult] =
    await Promise.all([
      supabase
        .from('user_profiles')
        .select('user_id,email,role,status,telegram_chat_id')
        .eq('user_id', user.id)
        .maybeSingle(),
      fetchKeywordsData().catch(() => null),
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
          .select('name,history_days,telegram_enabled')
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
      keywordCount: keywordsResult?.activeCount ?? 0,
      keywordLimit: keywordsResult?.maxKeywords ?? null,
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
      queryFn: fetchDashboardData,
      staleTime: 30 * 1000,
    })
    return
  }

  if (url === '/monitor/keywords') {
    void queryClient.prefetchQuery({
      queryKey: customerQueryKeys.keywords(),
      queryFn: fetchKeywordsData,
      staleTime: 60 * 1000,
    })
    return
  }

  if (url === '/monitor/competitors') {
    void queryClient.prefetchQuery({
      queryKey: customerQueryKeys.competitors(),
      queryFn: fetchCompetitorsData,
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
      queryFn: fetchCustomerAlerts,
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
