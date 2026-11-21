import { supabase } from '@/lib/supabase'

export type DashboardPost = {
  item_id: string
  title: string | null
  url: string | null
  network: string | null
  author: string | null
  like_count: number | null
  comment_count: number | null
  share_count: number | null
  view_count: number | null
  engagement: number | null
}

export type DashboardStats = {
  news: number
  social: number
  engagement: number
  by_network: { network: string; count: number }[]
  daily: { day: string; news: number; social: number }[]
  top_keywords: { keyword: string; count: number }[]
  top_sources: { host: string; count: number }[]
  top_engagement: DashboardPost[]
}

export const EMPTY_DASHBOARD_STATS: DashboardStats = {
  news: 0,
  social: 0,
  engagement: 0,
  by_network: [],
  daily: [],
  top_keywords: [],
  top_sources: [],
  top_engagement: [],
}

// Counts and chart series for the last `days` days, computed in the database
// (my_dashboard_stats) from the caller's own matches.
export async function fetchDashboardStats(days: number): Promise<DashboardStats> {
  const { data, error } = await supabase.rpc('my_dashboard_stats', { p_days: days })
  if (error) throw error
  return { ...EMPTY_DASHBOARD_STATS, ...((data || {}) as Partial<DashboardStats>) }
}
