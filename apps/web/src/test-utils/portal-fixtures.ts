// Synthetic browser-test data only. Never used by the application entry point.
export const portalFixture = {
  role: 'customer',
  state: 'ready' as 'ready' | 'empty' | 'error' | 'loading',
}

const timestamp = '2026-10-11T08:00:00.000Z'
const profile = {
  user_id: 'fixture-user',
  email: 'responsive-test@example.invalid',
  role: 'customer',
  status: 'active',
  plan_id: 'fixture-plan',
  telegram_chat_id: null,
  created_at: timestamp,
  updated_at: timestamp,
}
const plan = {
  id: 'fixture-plan',
  code: 'free',
  name: 'Sınaq planı',
  description: 'Yalnız interfeys testi üçün',
  is_active: true,
  is_public: true,
  is_custom: false,
  minimum_interval_minutes: 10,
  history_days: 30,
  telegram_enabled: true,
  limits: {},
  features: ['Telegram bildirişləri'],
  price_amount: 0,
  currency: 'AZN',
  billing_interval: 'month',
  display_order: 10,
}
const monitor = {
  id: 'fixture-monitor',
  user_id: profile.user_id,
  name: 'Bakı Dövlət Universiteti',
  description: 'Sintetik monitor',
  status: 'active',
  notify_telegram: true,
  telegram_chat_id: null,
  created_at: timestamp,
  updated_at: timestamp,
}
const items = [1, 2, 3].map((n) => ({
  id: `fixture-item-${n}`,
  source_id: `fixture-source-${n}`,
  title:
    'Bakı Dövlət Universitetində tələbələr üçün yeni tədris proqramı haqqında məlumat',
  url: `https://publisher-${n}.example.invalid/articles/azerbaycan-universitetleri-haqqinda-uzun-basliq`,
  published_at: timestamp,
  detected_at: timestamp,
  created_at: timestamp,
  status: 'new',
}))
const sources = items.map((item, i) => ({
  id: item.source_id,
  name: `Sınaq media mənbəsi ${i + 1}`,
  base_url: new URL(item.url).origin,
  rss_url: `${new URL(item.url).origin}/rss`,
  selector: null,
  article_pattern: null,
  status: 'active',
  monitor_method: 'rss',
  last_checked_at: timestamp,
  last_success_at: timestamp,
  last_article_found_at: timestamp,
  last_result: 'ok',
  last_error: null,
  consecutive_fail_count: 0,
}))
const matches = items.map((item, i) => ({
  id: `fixture-match-${i}`,
  monitor_id: monitor.id,
  item_id: item.id,
  matched_keyword: 'Bakı Dövlət Universiteti',
  created_at: timestamp,
  user_monitors: monitor,
  monitored_items: item,
}))
const competitors = [
  {
    id: 'fixture-competitor-1',
    name: 'Azərbaycan Texniki Universiteti',
    keywords: ['Texniki Universitet', 'AzTU'],
    created_at: timestamp,
  },
  {
    id: 'fixture-competitor-2',
    name: 'ADA Universiteti',
    keywords: ['ADA Universiteti'],
    created_at: timestamp,
  },
]
const competitorStats = [
  {
    kind: 'own',
    competitor_id: null,
    name: null,
    mentions: 24,
    positive: 9,
    neutral: 10,
    negative: 3,
  },
  {
    kind: 'competitor',
    competitor_id: competitors[0].id,
    name: competitors[0].name,
    mentions: 31,
    positive: 6,
    neutral: 14,
    negative: 8,
  },
  {
    kind: 'competitor',
    competitor_id: competitors[1].id,
    name: competitors[1].name,
    mentions: 12,
    positive: 7,
    neutral: 4,
    negative: 0,
  },
]
const tables: Record<string, Record<string, unknown>[]> = {
  user_profiles: [profile],
  admin_users: [{ ...profile, role: 'admin' }],
  subscription_plans: [plan],
  user_subscriptions: [
    {
      id: 'fixture-subscription',
      user_id: profile.user_id,
      plan_id: plan.id,
      status: 'active',
      started_at: timestamp,
      current_period_end: null,
      subscription_plans: plan,
      created_at: timestamp,
    },
  ],
  user_monitors: [monitor],
  monitor_keywords: [
    {
      id: 'fixture-keyword',
      monitor_id: monitor.id,
      keyword: 'Bakı Dövlət Universiteti',
      match_type: 'contains',
      status: 'active',
      social_enabled: true,
      created_at: timestamp,
    },
  ],
  monitored_items: items,
  competitors,
  competitor_matches: items.map((item, i) => ({
    competitor_id: competitors[i % 2].id,
    created_at: timestamp,
    monitored_items: {
      ...item,
      ai_sentiment: ['positive', 'negative', null][i],
    },
  })),
  competitor_insights: [
    {
      insight_date: '2026-10-11',
      summary:
        'Son 7 gündə Azərbaycan Texniki Universiteti xəbərlərdə sizdən çox keçib, amma mənfi xəbərlərinin payı daha yüksəkdir. ADA Universiteti az xəbərdə görünsə də, xəbərlərinin çoxu müsbətdir.',
    },
  ],
  sources,
  monitor_matches: matches,
  monitor_alerts: matches.map((match, i) => ({
    id: `fixture-alert-${i}`,
    match_id: match.id,
    channel: 'telegram',
    status: 'sent',
    sent_at: timestamp,
    created_at: timestamp,
    monitor_matches: match,
  })),
  news: [
    {
      id: 123,
      title: 'İnterfeys üçün sınaq xəbəri',
      slug: 'fixture-news',
      content: 'Sintetik mətn',
      status: 'draft',
      created_at: timestamp,
      updated_at: timestamp,
      image_url: null,
    },
  ],
}

export function fixtureProfile() {
  return {
    user: { id: profile.user_id, email: profile.email },
    profile: { ...profile, role: portalFixture.role },
    isAuthenticated: true,
    isAdmin: portalFixture.role === 'admin',
    isBlocked: false,
    error: null,
  }
}

export const fixtureSupabase = {
  auth: {
    getUser: async () => ({
      data: { user: { id: profile.user_id, email: profile.email } },
      error: null,
    }),
    getSession: async () => ({
      data: {
        session: { user: { id: profile.user_id, email: profile.email } },
      },
      error: null,
    }),
    signOut: async () => ({ error: null }),
    mfa: {
      getAuthenticatorAssuranceLevel: async () => ({
        data: { currentLevel: 'aal2', nextLevel: 'aal2' },
        error: null,
      }),
    },
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
  },
  rpc(name: string) {
    if (name === 'current_user_plan_limits') {
      const result = {
        data: { max_keywords: 300, max_social_keywords: 10 },
        error: null,
      }
      return { maybeSingle: async () => result }
    }
    if (name === 'current_user_competitor_limit') {
      return Promise.resolve({ data: 3, error: null })
    }
    if (name === 'my_competitor_stats') {
      return Promise.resolve({
        data: portalFixture.state === 'empty' ? [] : competitorStats,
        error: null,
      })
    }
    if (name === 'current_user_account_state') {
      return Promise.resolve({ data: [{ status: 'active' }], error: null })
    }
    throw new Error(`Unexpected fixture RPC: ${name}`)
  },
  functions: {
    invoke: async () => ({
      data: { users: [{ ...profile, id: profile.user_id }] },
      error: null,
    }),
  },
  from(table: string) {
    let single = false
    let head = false
    let offset = 0
    const query = {
      select(_fields?: string, options?: { head?: boolean }) {
        head = !!options?.head
        return query
      },
      eq() {
        return query
      },
      in() {
        return query
      },
      gte() {
        return query
      },
      lte() {
        return query
      },
      lt() {
        return query
      },
      gt() {
        return query
      },
      neq() {
        return query
      },
      is() {
        return query
      },
      not() {
        return query
      },
      or() {
        return query
      },
      order() {
        return query
      },
      limit() {
        return query
      },
      range(start: number) {
        offset = start
        return query
      },
      single() {
        single = true
        return query
      },
      maybeSingle() {
        single = true
        return query
      },
      then(resolve: (result: unknown) => unknown) {
        if (portalFixture.state === 'loading') return new Promise(() => {})
        const rows =
          portalFixture.state === 'empty' || offset > 0
            ? []
            : tables[table] || []
        return Promise.resolve({
          data:
            portalFixture.state === 'error'
              ? null
              : head
                ? null
                : single
                  ? rows[0] || null
                  : rows,
          count: rows.length,
          error:
            portalFixture.state === 'error'
              ? { message: 'Sintetik yükləmə xətası' }
              : null,
        }).then(resolve)
      },
    }
    return query
  },
}
