import { t } from '@/lib/i18n'
import { supabase } from '@/lib/supabase'

export type CustomerAlertRow = {
  id: string
  match_id: string | null
  channel: string | null
  recipient: string | null
  status: string | null
  sent_at: string | null
  monitor_matches: {
    id: string
    matched_keyword: string | null
    monitored_items: {
      title: string | null
      url: string | null
    } | null
  } | null
}

export type CustomerAlertsData = {
  alerts: CustomerAlertRow[]
  errorMessage: string
}

// One customer's alerts, newest first, in a single request. The owner filter
// goes through inner joins: listing every match id first built an `in (...)`
// URL that grew with each match and failed once it held a few hundred ids.
export function customerAlertsQuery(userId: string, limit: number) {
  return supabase
    .from('monitor_alerts')
    .select(
      'id,match_id,channel,recipient,status,sent_at,monitor_matches!inner(id,matched_keyword,monitored_items(title,url),user_monitors!inner(user_id))'
    )
    .eq('monitor_matches.user_monitors.user_id', userId)
    .order('sent_at', { ascending: false })
    .limit(limit)
}

export async function fetchCustomerAlerts(): Promise<CustomerAlertsData> {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return {
      alerts: [],
      errorMessage: t("Sessiya tapılmadı. Zəhmət olmasa yenidən daxil olun."),
    }
  }

  const { data, error } = await customerAlertsQuery(user.id, 300)
  if (error) {
    console.error('User alerts error:', error)
    return { alerts: [], errorMessage: t("Bildirişləri yükləmək mümkün olmadı.") }
  }

  return { alerts: (data || []) as unknown as CustomerAlertRow[], errorMessage: '' }
}
