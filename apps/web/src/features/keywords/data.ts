import { supabase } from '@/lib/supabase'
import { t } from '@/lib/i18n'
import { friendlyError } from '@/lib/friendly-error'

// Customers manage a flat list of keywords. user_monitors stays as a hidden
// container (one non-archived monitor per customer since migration
// 20261020000008); archived monitors only keep old results.

export type KeywordStatus = 'active' | 'paused'

export type CustomerKeyword = {
  id: string
  monitor_id: string
  keyword: string
  status: KeywordStatus
  // Also searched on Facebook and Instagram (set_keyword_social()).
  social: boolean
  // Social posts only with an Azerbaijani signal, and none containing an
  // exclude word (set_keyword_filters(), migration 20261023000007).
  azOnly: boolean
  excludeWords: string[]
  created_at: string | null
}

export type KeywordsData = {
  keywords: CustomerKeyword[]
  activeCount: number
  maxKeywords: number | null
  // Active keywords searched on FB/IG, and how many the plan allows
  // (null: unlimited, 0: not in the plan).
  socialCount: number
  maxSocialKeywords: number | null
  // False until migration 20261022000006: the FB/IG choice is hidden.
  socialSupported: boolean
  // False until the migration adds monitor_keywords.status: pausing is hidden.
  statusSupported: boolean
  // False until migration 20261023000007: the social filter is hidden.
  filtersSupported: boolean
}

type MonitorRow = { id: string; status: string | null; created_at: string | null }
type KeywordRow = {
  id: string
  monitor_id: string
  keyword: string
  status?: string | null
  social_enabled?: boolean | null
  az_only?: boolean | null
  exclude_words?: string[] | null
  created_at: string | null
}
type PlanLimitsRow = {
  max_keywords?: number | null
  max_social_keywords?: number | null
}

async function currentUserId() {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error(t("İstifadəçi sessiyası tapılmadı."))
  return user.id
}

async function loadMonitors(userId: string) {
  const { data, error } = await supabase
    .from('user_monitors')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
  if (error) throw new Error(t("Açar sözlər oxunmadı: {0}", [friendlyError(error)]))
  return ((data || []) as MonitorRow[]).filter(
    (monitor) => monitor.status !== 'archived'
  )
}

export async function fetchKeywordsData(): Promise<KeywordsData> {
  const userId = await currentUserId()
  const [monitors, limitsRes] = await Promise.all([
    loadMonitors(userId),
    supabase.rpc('current_user_plan_limits').maybeSingle(),
  ])
  const limits = limitsRes.data as PlanLimitsRow | null
  const maxKeywords = limits?.max_keywords ?? null
  const socialSupported = !!limits && 'max_social_keywords' in limits
  const maxSocialKeywords = limits?.max_social_keywords ?? null

  if (monitors.length === 0) {
    return {
      keywords: [],
      activeCount: 0,
      maxKeywords,
      socialCount: 0,
      maxSocialKeywords,
      socialSupported,
      statusSupported: true,
      filtersSupported: false,
    }
  }

  const monitorStatus = new Map(monitors.map((item) => [item.id, item.status]))
  const { data, error } = await supabase
    .from('monitor_keywords')
    .select('*')
    .in('monitor_id', [...monitorStatus.keys()])
    .order('created_at', { ascending: true })
  if (error) throw new Error(t("Açar sözlər oxunmadı: {0}", [friendlyError(error)]))

  const rows = (data || []) as KeywordRow[]
  const statusSupported = rows.length === 0 || 'status' in rows[0]
  const filtersSupported = rows.length > 0 && 'az_only' in rows[0]
  const keywords = rows.map((row) => ({
    id: row.id,
    monitor_id: row.monitor_id,
    keyword: row.keyword,
    created_at: row.created_at,
    social: row.social_enabled === true,
    azOnly: row.az_only !== false,
    excludeWords: row.exclude_words || [],
    status:
      monitorStatus.get(row.monitor_id) === 'active' && row.status !== 'paused'
        ? ('active' as const)
        : ('paused' as const),
  }))

  return {
    keywords,
    activeCount: keywords.filter((item) => item.status === 'active').length,
    maxKeywords,
    socialCount: keywords.filter(
      (item) => item.status === 'active' && item.social
    ).length,
    maxSocialKeywords,
    socialSupported,
    statusSupported,
    filtersSupported,
  }
}

export function keywordErrorMessage(error: { message: string }) {
  const message = error.message || ''
  if (message.includes('PLAN_KEYWORD_LIMIT_REACHED')) {
    return t("Planınızda açar söz limiti dolub. Bir açar sözü silin, dayandırın və ya planınızı yüksəldin.")
  }
  if (message.includes('PLAN_SOCIAL_KEYWORD_LIMIT_REACHED')) {
    return t("Facebook və Instagram üçün açar söz limiti dolub. Başqa bir sözdən FB/IG-ni söndürün və ya planınızı yüksəldin.")
  }
  if (message.includes('PLAN_SOCIAL_NOT_INCLUDED')) {
    return t("Planınıza Facebook və Instagram monitorinqi daxil deyil.")
  }
  if (message.includes('KEYWORD_EXISTS')) {
    return t("Bu açar söz artıq əlavə edilib.")
  }
  if (message.includes('ACCOUNT_NOT_ACTIVE')) {
    return t("Hesabınız aktiv deyil. Açar söz əlavə etmək üçün hesabın aktiv olması lazımdır.")
  }
  if (message.includes('EXCLUDE_WORDS_TOO_MANY')) {
    return t("İstisna sözlər ən çox 20 ola bilər.")
  }
  if (message.includes('EXCLUDE_WORD_TOO_LONG')) {
    return t("Hər istisna söz ən çox 60 simvol ola bilər.")
  }
  if (message.includes('KEYWORD_LENGTH_INVALID')) {
    return t("Açar söz 1-200 simvol olmalıdır.")
  }
  return friendlyError(error)
}

export async function addKeyword(keyword: string) {
  const { error } = await supabase.rpc('add_keyword', {
    p_keyword: keyword,
    p_match_type: 'contains',
  })
  return error
}

export async function setKeywordStatus(id: string, status: KeywordStatus) {
  const { error } = await supabase.rpc('set_keyword_status', {
    p_keyword_id: id,
    p_status: status,
  })
  return error
}

export async function setKeywordSocial(id: string, enabled: boolean) {
  const { error } = await supabase.rpc('set_keyword_social', {
    p_keyword_id: id,
    p_enabled: enabled,
  })
  return error
}

// Comma or new line separated; trimmed, without empties or repeats.
export function parseExcludeWords(value: string) {
  const seen = new Set<string>()
  return value
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter((item) => {
      const key = item.toLocaleLowerCase('az-AZ')
      if (!item || seen.has(key)) return false
      seen.add(key)
      return true
    })
}

export async function setKeywordFilters(
  id: string,
  azOnly: boolean,
  excludeWords: string[]
) {
  const { error } = await supabase.rpc('set_keyword_filters', {
    p_keyword_id: id,
    p_az_only: azOnly,
    p_exclude_words: excludeWords,
  })
  return error
}

export async function deleteKeyword(id: string) {
  const { error } = await supabase.from('monitor_keywords').delete().eq('id', id)
  return error
}
