import { type QueryClient } from '@tanstack/react-query'
import {
  fetchAllMonitorIds,
  fetchDashboardData,
} from '@/features/keywords/dashboard'
import { fetchCompetitorsData } from '@/features/competitors/data'
import { fetchCustomerAlerts } from '@/features/keywords/alerts'
import { fetchKeywordsData } from '@/features/keywords/data'
import { fetchProfileData } from '@/features/profile/data'
import { customerQueryKeys } from '@/lib/query-keys'
import { supabase } from '@/lib/supabase'

async function getCurrentUserId() {
  const {
    data: { user },
  } = await supabase.auth.getUser()

  return user?.id || ''
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
      queryFn: fetchProfileData,
      staleTime: 5 * 60 * 1000,
    })
  }
}
