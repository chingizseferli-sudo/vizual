import { t } from '@/lib/i18n'
import { supabase } from '@/lib/supabase'
import { friendlyError } from '@/lib/friendly-error'

// Rəqiblər: competitors a customer tracks on news sites (migration
// 20261022000003). Writes go through add_competitor / update_competitor /
// delete_competitor; the rss worker records matches and an AI tone label per
// headline, and writes one summary per customer per day.

export type Sentiment = 'positive' | 'neutral' | 'negative'

export type Competitor = {
  id: string
  name: string
  keywords: string[]
  created_at: string
}

export type EntityStats = {
  kind: 'own' | 'competitor'
  competitor_id: string | null
  name: string | null
  mentions: number
  positive: number
  neutral: number
  negative: number
}

export type CompetitorHeadline = {
  competitorId: string
  title: string
  url: string
  sentiment: Sentiment | null
  at: string | null
}

export type CompetitorInsight = {
  insight_date: string
  summary: string
}

export type CompetitorsData = {
  competitors: Competitor[]
  // null = unlimited (admins); 0 = the plan has no competitor tracking.
  limit: number | null
  stats: Record<7 | 30, EntityStats[]>
  headlines: CompetitorHeadline[]
  insight: CompetitorInsight | null
}

type RpcError = { code?: string; message: string } | null

type MatchRow = {
  competitor_id: string
  created_at: string
  monitored_items: {
    title: string | null
    url: string | null
    ai_sentiment: Sentiment | null
    published_at: string | null
    detected_at: string | null
  } | null
}

const HEADLINE_ROWS = 100

function failed(error: { message: string }) {
  return new Error(t('Rəqiblər oxunmadı: {0}', [friendlyError(error)]))
}

export async function fetchCompetitorsData(): Promise<CompetitorsData> {
  const [competitorsRes, limitRes, week, month, matchesRes, insightRes] =
    await Promise.all([
      supabase
        .from('competitors')
        .select('id,name,keywords,created_at')
        .order('created_at', { ascending: true }),
      supabase.rpc('current_user_competitor_limit'),
      supabase.rpc('my_competitor_stats', { p_days: 7 }),
      supabase.rpc('my_competitor_stats', { p_days: 30 }),
      supabase
        .from('competitor_matches')
        .select(
          'competitor_id,created_at,monitored_items(title,url,ai_sentiment,published_at,detected_at)'
        )
        .order('created_at', { ascending: false })
        .limit(HEADLINE_ROWS),
      supabase
        .from('competitor_insights')
        .select('insight_date,summary')
        .not('summary', 'is', null)
        .order('insight_date', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

  for (const result of [competitorsRes, limitRes, week, month, matchesRes]) {
    if (result.error) throw failed(result.error)
  }

  const headlines = ((matchesRes.data || []) as unknown as MatchRow[])
    .filter((row) => row.monitored_items?.title && row.monitored_items.url)
    .map((row) => ({
      competitorId: row.competitor_id,
      title: row.monitored_items!.title!,
      url: row.monitored_items!.url!,
      sentiment: row.monitored_items!.ai_sentiment,
      at:
        row.monitored_items!.published_at ||
        row.monitored_items!.detected_at ||
        row.created_at,
    }))

  return {
    competitors: (competitorsRes.data || []) as Competitor[],
    limit: (limitRes.data as number | null) ?? null,
    stats: {
      7: (week.data || []) as EntityStats[],
      30: (month.data || []) as EntityStats[],
    },
    headlines,
    insight: insightRes.error
      ? null
      : ((insightRes.data as CompetitorInsight | null) ?? null),
  }
}

// "Bakcell, Bakcell LLC" or one keyword per line -> up to 3 distinct keywords.
export function parseCompetitorKeywords(value: string) {
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

export async function addCompetitor(name: string, keywords: string[]) {
  const { error } = await supabase.rpc('add_competitor', {
    p_name: name,
    p_keywords: keywords,
  })
  return error as RpcError
}

export async function updateCompetitor(
  id: string,
  name: string,
  keywords: string[]
) {
  const { error } = await supabase.rpc('update_competitor', {
    p_competitor_id: id,
    p_name: name,
    p_keywords: keywords,
  })
  return error as RpcError
}

export async function deleteCompetitor(id: string) {
  const { error } = await supabase.rpc('delete_competitor', {
    p_competitor_id: id,
  })
  return error as RpcError
}

export function competitorErrorMessage(error: { message: string }) {
  const message = error.message || ''
  if (message.includes('PLAN_COMPETITOR_LIMIT_REACHED')) {
    return t(
      'Planınızda rəqib limiti dolub. Bir rəqibi silin və ya planınızı yüksəldin.'
    )
  }
  if (message.includes('COMPETITOR_EXISTS')) {
    return t('Bu adda rəqib artıq əlavə edilib.')
  }
  if (message.includes('COMPETITOR_KEYWORDS_TOO_MANY')) {
    return t('Hər rəqib üçün ən çox 3 açar söz yazmaq olar.')
  }
  if (message.includes('COMPETITOR_KEYWORD_INVALID')) {
    return t('Hər açar söz 2-100 simvol olmalıdır.')
  }
  if (message.includes('COMPETITOR_NAME_INVALID')) {
    return t('Rəqibin adı 1-80 simvol olmalıdır.')
  }
  if (message.includes('ACCOUNT_NOT_ACTIVE')) {
    return t(
      'Hesabınız aktiv deyil. Rəqib əlavə etmək üçün hesabın aktiv olması lazımdır.'
    )
  }
  return friendlyError(error)
}

// Share of each tone among labelled and unlabelled mentions, in percent.
export function toneShares(
  row: Pick<EntityStats, 'mentions' | 'positive' | 'neutral' | 'negative'>
) {
  const total = row.mentions || 0
  if (total === 0) return null
  const pct = (value: number) => (value / total) * 100
  const unlabelled = Math.max(
    0,
    total - row.positive - row.neutral - row.negative
  )
  return {
    positive: pct(row.positive),
    neutral: pct(row.neutral),
    negative: pct(row.negative),
    unlabelled: pct(unlabelled),
  }
}
