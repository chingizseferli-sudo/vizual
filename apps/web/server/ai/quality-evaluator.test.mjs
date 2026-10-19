import assert from 'node:assert/strict'
import test from 'node:test'
import { azQualityCases } from '../../tests/ai/az-quality-fixtures.mjs'
import {
  auditEvidence,
  labelFingerprint,
  scorePredictions,
} from '../../tests/ai/quality-evaluator.mjs'
import { safetyProbes } from '../../tests/ai/quality-safety-fixtures.mjs'
import { analyze } from './pipeline.mjs'
import { createProvider, readConfig } from './provider.mjs'

test('synthetic evaluation partitions are balanced and labels immutable', () => {
  assert.equal(azQualityCases.length, 56)
  assert.equal(
    azQualityCases.filter((item) => item.split === 'heldout').length,
    28
  )
  assert.equal(new Set(azQualityCases.map((item) => item.id)).size, 56)
  assert.equal(
    labelFingerprint(azQualityCases.filter((item) => item.split === 'heldout')),
    '17cea1aa23561b13203516d37d50ad23c227dd6d1ba2b00db3a905b745ef10b3'
  )
})
test('evaluation measures actual confusion and keeps rejected predictions incorrect', () => {
  const sample = azQualityCases.filter((item) =>
    ['heldout-01', 'heldout-02', 'heldout-07'].includes(item.id)
  )
  const scores = scorePredictions(sample, [
    {
      id: 'heldout-01',
      relevant: true,
      sentiment: 'positive',
      stance: 'opinion',
    },
    { id: 'heldout-02', relevant: false, sentiment: null, stance: null },
    {
      id: 'heldout-07',
      relevant: true,
      sentiment: 'neutral',
      stance: 'fact_report',
    },
  ])
  assert.equal(scores.overall.accuracy, 0.5)
  assert.equal(scores.overall.confusion.negative.rejected, 1)
  assert.equal(scores.overall.entity.precision, 0.5)
  assert.equal(scores.overall.entity.recall, 0.5)
  assert.equal(scores.overall.perClass.negative.f1, 0)
  assert.throws(
    () => scorePredictions(sample, [{ id: 'made-up' }]),
    /unknown_prediction_id/
  )
})
test('evaluation detects invented attribution and title-only unsupported recommendations', () => {
  const original = {
    id: 'one',
    source_id: 'source',
    title: 'Synthetic title',
    url: 'https://source.example.invalid/one',
  }
  const result = {
    evidence: [
      {
        ...original,
        excerpt: original.title,
        text_scope: 'title',
        sentiment: 'negative',
        stance: 'opinion',
        source_id: 'source',
      },
    ],
    recommendations: [{ evidence_ids: ['one', 'invented', 'one'] }],
  }
  const audit = auditEvidence(result, [original])
  assert.equal(audit.unsupportedRecommendations, 1)
  assert.equal(audit.unsupportedRecommendationRate, 1)
  assert.equal(audit.correctReferences, 3)
  assert.equal(audit.references, 4)
  assert.equal(audit.attributionCorrectness, 0.75)
})
test('substantive handwritten probes distinguish supported recommendations from permission, fact and duplicate failures', async () => {
  const provider = createProvider(
    readConfig({ AI_INTELLIGENCE_ENABLED: 'true' })
  )
  for (const probe of safetyProbes) {
    const { result } = await analyze(
      {
        entity: probe.entity,
        start: '2026-10-13T00:00:00Z',
        end: '2026-10-14T00:00:00Z',
        items: probe.items,
      },
      provider
    )
    const audit = auditEvidence(result, probe.items)
    assert.equal(audit.attributionCorrectness, 1, probe.id)
    assert.equal(audit.unsupportedRecommendations, 0, probe.id)
    if (probe.expectedMayRecommend)
      assert.ok(result.recommendations.length > 0, probe.id)
    else assert.equal(result.recommendations.length, 0, probe.id)
  }
})
