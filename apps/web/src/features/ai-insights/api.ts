import { z } from 'zod'
import { supabase } from '@/lib/supabase'
import {
  requestWindow,
  type AnalyticsFilters,
} from '@/features/analytics/model'
import { insightsSchema } from './model'

export async function fetchInsights(expectedUserId: string) {
  const { data, error } = await supabase.rpc('get_ai_insights')
  if (error) throw new Error('Analiz xidməti əlçatan deyil. Yenidən yoxlayın.')
  const parsed = insightsSchema.safeParse(data)
  if (!parsed.success)
    throw new Error('Analiz məlumatı etibarlı deyil. Yenidən yoxlayın.')
  if (parsed.data.owner_id !== expectedUserId)
    throw new Error('Sessiya dəyişib. Məlumatı yenidən yükləyin.')
  return parsed.data
}
export async function requestInsights(
  filters: AnalyticsFilters,
  requestKey: string,
  requestedAt = new Date()
) {
  if (!filters.monitor) throw new Error('Analiz üçün monitor seçin.')
  const window = requestWindow(filters, requestedAt)
  const { data, error } = await supabase.rpc('request_ai_insights', {
    p_start: window.start,
    p_end: window.end,
    p_monitor: filters.monitor,
    p_request_key: requestKey,
  })
  if (error)
    throw new Error(
      'Analiz sorğusu qəbul edilmədi. Plan, kvota və tarix aralığını yoxlayın.'
    )
  const parsed = z
    .object({
      id: z.string().min(1).max(200),
      status: z.enum(['pending', 'running', 'complete', 'dead']),
      reused: z.boolean(),
    })
    .safeParse(data)
  if (!parsed.success)
    throw new Error('Sorğunun təsdiqi etibarlı deyil. Yenidən yoxlayın.')
  return parsed.data
}
