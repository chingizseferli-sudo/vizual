// Synthetic test fixtures only; never imported by application entry points.
import { fixtureSupabase } from '@/test-utils/portal-fixtures'

export const aiFixture = {
  state: 'ready' as
    | 'ready'
    | 'disabled'
    | 'quota'
    | 'empty'
    | 'loading'
    | 'error'
    | 'invalid'
    | 'foreign'
    | 'pending',
  requests: [] as Record<string, unknown>[],
  calls: 0,
  quality: 'substantial_excerpt' as
    | 'full_text'
    | 'substantial_excerpt'
    | 'title_summary'
    | 'title_only'
    | 'extraction_failed'
    | 'source_inaccessible'
    | undefined,
  kind: 'complaint' as
    | 'complaint'
    | 'suggestion'
    | 'announcement'
    | 'journalist_summary'
    | 'event'
    | 'reported_opinion'
    | 'allegation'
    | 'uncertain'
    | 'feedback',
}
export function syntheticInsights() {
  const evidence = [1, 2, 3].map((n) => ({
    id: `synthetic-evidence-${n}`,
    title: `Sintetik BDU cədvəl rəyi ${n}`,
    url: `https://publisher-${n}.example.invalid/synthetic-evidence`,
    publisher: `Sintetik mənbə ${n}`,
    source_id: `synthetic-source-${n}`,
    detected_at: '2026-10-13T08:00:00.000Z',
    published_at: null,
    text_scope:
      aiFixture.quality === 'title_only'
        ? ('title' as const)
        : ('excerpt' as const),
    quality_label: aiFixture.quality,
    evidence_kind: aiFixture.kind,
    retrieved_at:
      aiFixture.quality === 'extraction_failed' ||
      aiFixture.quality === 'source_inaccessible'
        ? null
        : '2026-10-13T11:00:00.000Z',
    recommendation_basis: ['full_text', 'substantial_excerpt'].includes(
      aiFixture.quality || ''
    ),
    sentiment: 'negative' as const,
    stance: 'opinion' as const,
    topic: 'Dərs cədvəli',
    excerpt: `Bakı Dövlət Universitetində cədvəl ilə bağlı çətinlik ${n}; yalnız sınaq mətni.`,
  }))
  const result = {
    version: 1,
    method: 'deterministic',
    evidence_status: ['full_text', 'substantial_excerpt'].includes(
      aiFixture.quality || ''
    )
      ? 'sufficient'
      : 'insufficient_evidence',
    insufficient_evidence_reasons: [
      'full_text',
      'substantial_excerpt',
    ].includes(aiFixture.quality || '')
      ? []
      : ['Mənbə mətni tövsiyə üçün kifayət qədər əlçatan deyil.'],
    independent_author_count: null,
    independent_publisher_count: null,
    analysis_at: '2026-10-13T12:00:00.000Z',
    entity: {
      name: 'Bakı Dövlət Universiteti',
      aliases: [{ value: 'BDU', ambiguous: true, context: ['universitet'] }],
    },
    evidence_ids: evidence.map((e) => e.id),
    evidence,
    topics: [
      {
        name: 'Dərs cədvəli',
        evidence_ids: evidence.map((e) => e.id),
        mentions: 3,
        distinct_sources: 3,
        positive: 0,
        negative: 3,
        neutral: 0,
        mixed: 0,
        uncertain: 0,
        change: { previous: 1, current: 2, delta: 1 },
      },
    ],
    recommendations: [
      {
        topic: 'Dərs cədvəli',
        issue: 'Təkrarlanan rəy namizədi',
        summary:
          'Sintetik məlumatda cədvəl barədə narazı fikirlər var; təsdiqlənmiş ümumi problem deyil.',
        evidence_ids: evidence.map((e) => e.id),
        mentions: 3,
        distinct_sources: 3,
        sentiment: 'negative',
        confidence: 'moderate',
        confidence_explanation:
          'Üç sintetik mətn və mənbə; ümumi ictimai rəy deyil.',
        action:
          'Müraciətləri insan baxışı ilə yoxlayın və cədvəl ehtiyaclarını araşdırın.',
        expected_benefit: 'Rəylərdə qeyd edilən ehtiyacları müəyyənləşdirmək.',
        period_start: '2026-10-13T00:00:00.000Z',
        period_end: '2026-10-13T12:00:00.000Z',
      },
    ],
    limitations: [
      'Yalnız sintetik UI sınağı; real ictimai rəy deyil.',
      'Söz qaydaları semantik AI ölçüsü deyil.',
    ],
  }
  if (!['full_text', 'substantial_excerpt'].includes(aiFixture.quality || ''))
    result.recommendations = []
  if (aiFixture.state === 'invalid')
    result.recommendations[0].evidence_ids = ['invented-id']
  return {
    version: 1,
    owner_id:
      aiFixture.state === 'foreign' ? 'different-tenant' : 'fixture-user',
    available: aiFixture.state !== 'disabled',
    reason: aiFixture.state === 'disabled' ? 'disabled' : null,
    quota: {
      limit: 10,
      used: aiFixture.state === 'quota' ? 10 : 1,
      remaining: aiFixture.state === 'quota' ? 0 : 9,
    },
    monitors: [{ id: 'fixture-monitor', name: 'Bakı Dövlət Universiteti' }],
    runs: ['disabled', 'empty'].includes(aiFixture.state)
      ? []
      : [
          {
            id: 'synthetic-run',
            monitor_id: 'fixture-monitor',
            period_start: '2026-10-13T00:00:00.000Z',
            period_end: '2026-10-13T12:00:00.000Z',
            status:
              aiFixture.state === 'pending' || aiFixture.requests.length
                ? 'pending'
                : 'complete',
            created_at: '2026-10-13T12:00:00.000Z',
            result:
              aiFixture.state === 'pending' || aiFixture.requests.length
                ? null
                : result,
            error_code: null,
          },
        ],
  }
}
export const aiSupabase = {
  ...fixtureSupabase,
  rpc: async (name: string, args?: Record<string, unknown>) => {
    if (name === 'get_ai_insights') {
      aiFixture.calls++
      if (aiFixture.state === 'loading') return new Promise(() => {})
      if (aiFixture.state === 'error')
        return { data: null, error: { code: '42501' } }
      return { data: syntheticInsights(), error: null }
    }
    if (name === 'request_ai_insights') {
      aiFixture.requests.push(args || {})
      return {
        data: { id: 'synthetic-run', status: 'pending', reused: false },
        error: null,
      }
    }
    return fixtureSupabase.rpc(name, args || {})
  },
}
