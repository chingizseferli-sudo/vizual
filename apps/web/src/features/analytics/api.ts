import { supabase } from '@/lib/supabase'
import { analyticsSchema, requestWindow, type AnalyticsFilters } from './model'

export async function fetchAnalytics(
  filters: AnalyticsFilters,
  expectedUserId: string
) {
  const window = requestWindow(filters)
  const { data, error } = await supabase.rpc('get_content_analytics', {
    p_start: window.start,
    p_end: window.end,
    p_monitor: filters.monitor || null,
    p_source: filters.source || null,
    p_limit: 500,
  })
  if (error)
    throw new Error(
      'Analitika məlumatı əlçatan deyil. Xidmətin aktivliyini və planın tarixçə limitini yoxlayın.'
    )
  const parsed = analyticsSchema.safeParse(data)
  if (!parsed.success)
    throw new Error('Analitika məlumatı etibarlı deyil. Yenidən yükləyin.')
  const result = parsed.data
  if (result.owner_id !== expectedUserId)
    throw new Error('Sessiya dəyişib. Məlumatı yenidən yükləyin.')
  return result
}
