import { supabase } from '@/lib/supabase'
import { friendlyError } from '@/lib/friendly-error'
import { t } from '@/lib/i18n'

// Alert rules (migration 20261121000001): instant email for marked alerts,
// the social engagement threshold, and up to 20 priority news sites.

export const MAX_PRIORITY_SOURCES = 20

export type AlertSource = {
  id: string
  name: string
  host: string
  is_priority: boolean
}

export type AlertRules = {
  alertEmail: boolean
  engagementThreshold: number | null
  sources: AlertSource[]
}

export async function fetchAlertRules(): Promise<AlertRules | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  const [profile, sources] = await Promise.all([
    supabase
      .from('user_profiles')
      .select('alert_email,engagement_alert_threshold')
      .eq('user_id', user.id)
      .maybeSingle(),
    supabase.rpc('customer_sources'),
  ])
  // Before the migration the columns and the function are missing: hide the section.
  if (profile.error || sources.error) return null
  const row = (profile.data || {}) as {
    alert_email?: boolean | null
    engagement_alert_threshold?: number | null
  }
  return {
    alertEmail: row.alert_email === true,
    engagementThreshold: row.engagement_alert_threshold ?? null,
    sources: (sources.data || []) as AlertSource[],
  }
}

function rulesError(error: { message: string }) {
  const message = error.message || ''
  if (message.includes('PRIORITY_SOURCE_LIMIT')) {
    return t("Ən çox {0} prioritet mənbə seçmək olar.", [MAX_PRIORITY_SOURCES])
  }
  if (message.includes('ENGAGEMENT_THRESHOLD_INVALID')) {
    return t("Engagement həddi 10 və ya daha çox olmalıdır.")
  }
  return friendlyError(error)
}

export async function saveAlertSettings(alertEmail: boolean, engagementThreshold: number | null) {
  const { error } = await supabase.rpc('set_alert_settings', {
    p_alert_email: alertEmail,
    p_engagement_threshold: engagementThreshold,
  })
  return error ? rulesError(error) : null
}

export async function setPrioritySource(sourceId: string, priority: boolean) {
  const { error } = await supabase.rpc('set_priority_source', {
    p_source_id: sourceId,
    p_priority: priority,
  })
  return error ? rulesError(error) : null
}
