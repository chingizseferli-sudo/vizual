import { supabase } from '@/lib/supabase'
import { fetchKeywordsData } from './data'

export type DashboardMatch = {
  id: string
  monitor_id: string
  matched_keyword: string | null
  created_at: string | null
  monitored_items: {
    title: string
    url: string
  } | null
}

export type DashboardData = {
  keywordCount: number
  activeKeywordCount: number
  resultCount: number
  alertCount: number
  recentMatches: DashboardMatch[]
}

export const EMPTY_DASHBOARD: DashboardData = {
  keywordCount: 0,
  activeKeywordCount: 0,
  resultCount: 0,
  alertCount: 0,
  recentMatches: [],
}

// Every monitor of the user, archived ones included: their results stay visible.
export async function fetchAllMonitorIds(userId: string) {
  const { data, error } = await supabase
    .from('user_monitors')
    .select('id')
    .eq('user_id', userId)
  if (error) throw error
  return (data || []).map((item) => item.id as string)
}

export async function fetchDashboardData(): Promise<DashboardData> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return EMPTY_DASHBOARD

  const [keywords, monitorIds] = await Promise.all([
    fetchKeywordsData(),
    fetchAllMonitorIds(user.id),
  ])
  if (monitorIds.length === 0) return EMPTY_DASHBOARD

  const matchesRes = await supabase
    .from('monitor_matches')
    .select('id,monitor_id,matched_keyword,created_at,monitored_items(title,url)')
    .in('monitor_id', monitorIds)
    .order('created_at', { ascending: false })
    .limit(10)
  if (matchesRes.error) throw matchesRes.error

  const matches = (matchesRes.data || []) as unknown as DashboardMatch[]
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
    keywordCount: keywords.keywords.length,
    activeKeywordCount: keywords.activeCount,
    resultCount: matchIds.length,
    alertCount,
    recentMatches: matches,
  }
}
