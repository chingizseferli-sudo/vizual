import { z } from 'zod'

const time = z.iso.datetime({ offset: true })
const text = z.string().max(4000)
const ids = z.array(z.string().min(1).max(200)).max(200)
export const sentimentNames = [
  'positive',
  'negative',
  'neutral',
  'mixed',
  'uncertain',
] as const
const sentiment = z.enum(sentimentNames)
export const resultSchema = z
  .object({
    version: z.literal(1),
    method: z.enum(['deterministic', 'model']),
    analysis_at: time,
    entity: z.object({
      name: text,
      aliases: z
        .array(
          z.object({
            value: text,
            ambiguous: z.boolean(),
            context: z.array(text).max(20),
          })
        )
        .max(50),
    }),
    evidence_ids: ids,
    evidence: z
      .array(
        z.object({
          id: z.string().min(1),
          title: text,
          url: z.string().max(4000),
          publisher: text.nullable(),
          source_id: text.nullable(),
          detected_at: time,
          published_at: time.nullable(),
          text_scope: z.enum(['title', 'excerpt']),
          quality_label: z
            .enum([
              'full_text',
              'substantial_excerpt',
              'title_summary',
              'title_only',
              'extraction_failed',
              'source_inaccessible',
            ])
            .optional(),
          evidence_kind: z
            .enum([
              'complaint',
              'suggestion',
              'announcement',
              'journalist_summary',
              'event',
              'reported_opinion',
              'allegation',
              'uncertain',
              'feedback',
            ])
            .optional(),
          retrieved_at: time.nullable().optional(),
          recommendation_basis: z.boolean().optional(),
          sentiment,
          stance: z.enum([
            'opinion',
            'reported_quote',
            'allegation',
            'fact_report',
            'uncertain',
          ]),
          topic: text,
          excerpt: text,
        })
      )
      .max(200),
    topics: z
      .array(
        z.object({
          name: text,
          evidence_ids: ids,
          mentions: z.number().int().nonnegative(),
          distinct_sources: z.number().int().nonnegative(),
          positive: z.number().int().nonnegative(),
          negative: z.number().int().nonnegative(),
          neutral: z.number().int().nonnegative(),
          mixed: z.number().int().nonnegative(),
          uncertain: z.number().int().nonnegative(),
          change: z.object({
            previous: z.number().int().nonnegative(),
            current: z.number().int().nonnegative(),
            delta: z.number().int(),
          }),
        })
      )
      .max(100),
    recommendations: z
      .array(
        z.object({
          topic: text,
          issue: text,
          summary: text,
          evidence_ids: ids,
          mentions: z.number().int().nonnegative(),
          distinct_sources: z.number().int().nonnegative(),
          sentiment,
          confidence: z.enum(['low', 'moderate']),
          confidence_explanation: text,
          action: text,
          expected_benefit: text,
          period_start: time,
          period_end: time,
        })
      )
      .max(30),
    limitations: z.array(text).max(30),
    evidence_status: z.enum(['sufficient', 'insufficient_evidence']).optional(),
    insufficient_evidence_reasons: z.array(text).max(30).optional(),
    independent_author_count: z
      .number()
      .int()
      .nonnegative()
      .nullable()
      .optional(),
    independent_publisher_count: z
      .number()
      .int()
      .nonnegative()
      .nullable()
      .optional(),
  })
  .superRefine((result, context) => {
    const byId = new Map(result.evidence.map((item) => [item.id, item]))
    const sources = (references: string[]) =>
      new Set(references.map((id) => byId.get(id)?.source_id).filter(Boolean))
        .size
    const unique = (references: string[]) =>
      new Set(references).size === references.length
    const invalidTotals = result.topics.some(
      (topic) =>
        !unique(topic.evidence_ids) ||
        topic.mentions !== topic.evidence_ids.length ||
        topic.distinct_sources !== sources(topic.evidence_ids) ||
        sentimentNames.some(
          (name) =>
            topic[name] !==
            topic.evidence_ids.filter((id) => byId.get(id)?.sentiment === name)
              .length
        ) ||
        topic.evidence_ids.some((id) => byId.get(id)?.topic !== topic.name) ||
        topic.change.current + topic.change.previous !== topic.mentions ||
        topic.change.delta !== topic.change.current - topic.change.previous
    )
    const invalidRecommendations = result.recommendations.some(
      (rec) =>
        !unique(rec.evidence_ids) ||
        rec.mentions !== rec.evidence_ids.length ||
        rec.mentions < 3 ||
        rec.distinct_sources !== sources(rec.evidence_ids) ||
        rec.distinct_sources < 2 ||
        Date.parse(rec.period_start) >= Date.parse(rec.period_end) ||
        rec.evidence_ids.some((id) => {
          const item = byId.get(id)
          return (
            !item ||
            item.text_scope !== 'excerpt' ||
            item.sentiment !== 'negative' ||
            item.stance !== 'opinion'
          )
        })
    )
    if (
      invalidTotals ||
      invalidRecommendations ||
      !unique(result.evidence_ids) ||
      result.evidence_ids.length !== result.evidence.length
    )
      context.addIssue({
        code: 'custom',
        message: 'Unsupported evidence aggregates',
      })
    const available = new Set(result.evidence.map((item) => item.id))
    if (
      available.size !== result.evidence.length ||
      result.evidence_ids.some((id) => !available.has(id)) ||
      result.topics.some((topic) =>
        topic.evidence_ids.some((id) => !available.has(id))
      ) ||
      result.recommendations.some(
        (rec) =>
          !rec.evidence_ids.length ||
          rec.evidence_ids.some((id) => !available.has(id))
      )
    )
      context.addIssue({
        code: 'custom',
        message: 'Evidence references do not match available sources',
      })
  })
export const insightsSchema = z.object({
  version: z.literal(1),
  owner_id: z.string().min(1),
  available: z.boolean(),
  reason: z
    .enum(['disabled', 'plan_disabled', 'subscription_required'])
    .nullable(),
  quota: z.object({
    limit: z.number().int().nonnegative(),
    used: z.number().int().nonnegative(),
    remaining: z.number().int().nonnegative(),
  }),
  monitors: z.array(z.object({ id: z.string(), name: text })).max(100),
  runs: z
    .array(
      z.object({
        id: z.string(),
        monitor_id: z.string(),
        period_start: time,
        period_end: time,
        status: z.enum(['pending', 'running', 'complete', 'dead']),
        created_at: time,
        result: resultSchema.nullable(),
        error_code: z.string().nullable(),
      })
    )
    .max(20),
})
export type Insights = z.infer<typeof insightsSchema>
export type AnalysisResult = z.infer<typeof resultSchema>
export const sentimentLabels: Record<(typeof sentimentNames)[number], string> =
  {
    positive: 'Müsbət',
    negative: 'Mənfi',
    neutral: 'Neytral',
    mixed: 'Qarışıq',
    uncertain: 'Qeyri-müəyyən',
  }
export function insightsKey(userId: string) {
  return ['customer', 'ai-insights', userId] as const
}

export type Evidence = AnalysisResult['evidence'][number]
export function evidenceQuality(item: Evidence) {
  return (
    item.quality_label ||
    (item.text_scope === 'title' ? 'title_only' : 'title_summary')
  )
}
export function isRecommendationBasis(item: Evidence) {
  return (
    item.recommendation_basis === true &&
    item.text_scope === 'excerpt' &&
    ['full_text', 'substantial_excerpt'].includes(evidenceQuality(item))
  )
}
export const qualityLabels: Record<
  ReturnType<typeof evidenceQuality>,
  string
> = {
  full_text: 'Tam mətn çıxarılıb',
  substantial_excerpt: 'Əsaslı mətn parçası',
  title_summary: 'Qısa xülasə / məhdud mətn',
  title_only: 'Yalnız başlıq',
  extraction_failed: 'Mətn çıxarıla bilmədi',
  source_inaccessible: 'Mənbə əlçatan deyil',
}
export const evidenceKindLabels: Record<
  NonNullable<Evidence['evidence_kind']>,
  string
> = {
  complaint: 'Şikayət',
  suggestion: 'Təklif',
  announcement: 'Elan',
  journalist_summary: 'Jurnalist xülasəsi',
  event: 'Hadisə barədə məlumat',
  reported_opinion: 'Nəql edilən rəy',
  allegation: 'İddia',
  uncertain: 'Qeyri-müəyyən mətn',
  feedback: 'Birbaşa rəy',
}
