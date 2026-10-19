import { beforeEach, expect, it } from 'vitest'
import { aiFixture, syntheticInsights } from './fixtures'
import {
  insightsKey,
  insightsSchema,
  evidenceQuality,
  isRecommendationBasis,
} from './model'

beforeEach(() => {
  aiFixture.state = 'ready'
  aiFixture.requests = []
  aiFixture.quality = 'substantial_excerpt'
  aiFixture.kind = 'complaint'
})
it('accepts bounded evidence-backed completed analysis', () => {
  expect(insightsSchema.safeParse(syntheticInsights()).success).toBe(true)
})
it('rejects invented evidence references', () => {
  aiFixture.state = 'invalid'
  expect(insightsSchema.safeParse(syntheticInsights()).success).toBe(false)
})
it('partitions insight caches by authenticated tenant', () => {
  expect(insightsKey('tenant-a')).not.toEqual(insightsKey('tenant-b'))
})
it('preserves global disabled and quota exhausted states distinctly', () => {
  aiFixture.state = 'disabled'
  expect(insightsSchema.parse(syntheticInsights()).available).toBe(false)
  aiFixture.state = 'quota'
  expect(insightsSchema.parse(syntheticInsights()).quota.remaining).toBe(0)
})

it.each([
  'title_summary',
  'title_only',
  'extraction_failed',
  'source_inaccessible',
] as const)('does not treat %s as a recommendation basis', (quality) => {
  aiFixture.quality = quality
  const result = insightsSchema.parse(syntheticInsights()).runs[0].result!
  expect(result.evidence_status).toBe('insufficient_evidence')
  expect(result.evidence.every((item) => !isRecommendationBasis(item))).toBe(
    true
  )
  expect(result.independent_author_count).toBeNull()
})
it('reads legacy evidence conservatively without inventing full text access or authors', () => {
  const response = syntheticInsights()
  const result = response.runs[0].result!
  for (const item of result.evidence) {
    delete (item as Partial<typeof item>).quality_label
    delete (item as Partial<typeof item>).recommendation_basis
  }
  delete (result as Partial<typeof result>).evidence_status
  const parsed = insightsSchema.parse(response).runs[0].result!
  expect(evidenceQuality(parsed.evidence[0])).toBe('title_summary')
  expect(isRecommendationBasis(parsed.evidence[0])).toBe(false)
})
it('keeps direct feedback and publisher summaries distinct', () => {
  aiFixture.kind = 'feedback'
  expect(
    insightsSchema.parse(syntheticInsights()).runs[0].result!.evidence[0]
      .evidence_kind
  ).toBe('feedback')
  aiFixture.kind = 'journalist_summary'
  expect(
    insightsSchema.parse(syntheticInsights()).runs[0].result!.evidence[0]
      .evidence_kind
  ).toBe('journalist_summary')
})
