// Offline only: synthetic content, deterministic provider, no env/database/network.
import {
  analyze,
  selectEvidence,
  validateClassifications,
  PROMPT_VERSION,
} from '../server/ai/pipeline.mjs'
import { createProvider, readConfig } from '../server/ai/provider.mjs'
import {
  azQualityCases,
  datasetMetadata,
} from '../tests/ai/az-quality-fixtures.mjs'
import {
  labelFingerprint,
  scorePredictions,
} from '../tests/ai/quality-evaluator.mjs'
import { safetyProbes } from '../tests/ai/quality-safety-fixtures.mjs'

const split = process.argv[2] || 'all'
if (!['dev', 'heldout', 'all'].includes(split))
  throw new Error('Use dev, heldout or all')
const cases = azQualityCases.filter(
  (item) => split === 'all' || item.split === split
)
const config = readConfig({
  AI_INTELLIGENCE_ENABLED: 'true',
  AI_PROVIDER: 'deterministic',
})
const provider = createProvider(config)
const predictions = [],
  semanticPredictions = [],
  runs = [],
  safetyRuns = []
for (const item of cases) {
  const original = {
    id: item.id,
    title: `Sintetik sınaq ${item.id}`,
    url: `https://evaluation.example.invalid/${item.id}`,
    source_id: item.id,
    publisher: 'Sintetik qiymətləndirmə mənbəyi',
    detected_at: '2026-10-13T10:00:00Z',
    published_at: '2026-10-13T09:00:00Z',
    metadata: { excerpt: item.text },
  }
  const input = {
    entity: item.entity,
    start: '2026-10-13T00:00:00Z',
    end: '2026-10-14T00:00:00Z',
    items: [original],
  }
  const selected = selectEvidence(input)
  const classified = selected.length
    ? validateClassifications(
        (
          await provider.classify({
            entity: item.entity,
            evidence: selected,
            promptVersion: PROMPT_VERSION,
          })
        ).classifications,
        selected
      )[0]
    : null
  semanticPredictions.push({
    id: item.id,
    relevant: !!classified,
    sentiment: classified?.sentiment || null,
    stance: classified?.stance || null,
    evidence_kind: classified?.evidence_kind || null,
  })
  const { result } = await analyze(input, provider, {
    now: new Date('2026-10-13T12:00:00Z'),
  })
  const evidence = result.evidence[0]
  predictions.push({
    id: item.id,
    relevant: !!evidence,
    sentiment: evidence?.sentiment || null,
    stance: evidence?.stance || null,
    evidence_kind: evidence?.evidence_kind || null,
  })
  runs.push({ result, originals: [original] })
}
for (const probe of safetyProbes) {
  const { result } = await analyze(
    {
      entity: probe.entity,
      start: '2026-10-13T00:00:00Z',
      end: '2026-10-14T00:00:00Z',
      items: probe.items,
    },
    provider,
    { now: new Date('2026-10-13T12:00:00Z') }
  )
  safetyRuns.push({
    result,
    originals: probe.items,
    probe: probe.id,
    expectedMayRecommend: probe.expectedMayRecommend,
  })
}
console.log(
  JSON.stringify(
    {
      metadata: datasetMetadata,
      method: 'deterministic',
      algorithm_version: provider.model,
      prompt_version: PROMPT_VERSION,
      split,
      heldoutFingerprint: labelFingerprint(
        azQualityCases.filter((item) => item.split === 'heldout')
      ),
      semanticUnit: scorePredictions(cases, semanticPredictions),
      productPipeline: scorePredictions(cases, predictions, runs),
      substantiveSafety: {
        ...scorePredictions([], [], safetyRuns).safety,
        probes: safetyRuns.map(({ result, probe, expectedMayRecommend }) => ({
          id: probe,
          expectedMayRecommend,
          recommendations: result.recommendations.length,
          unexpectedRecommendation:
            !expectedMayRecommend && result.recommendations.length > 0,
        })),
      },
      devDisagreements: cases
        .filter((item) => item.split === 'dev')
        .filter((item) => {
          const actual = semanticPredictions.find(
            (value) => value.id === item.id
          )
          return (
            actual.relevant !== item.expected.relevant ||
            actual.sentiment !== item.expected.sentiment ||
            actual.stance !== item.expected.stance ||
            actual.evidence_kind !== item.expected.evidence_kind
          )
        })
        .map((item) => ({
          id: item.id,
          expected: item.expected,
          actual: semanticPredictions.find((value) => value.id === item.id),
        })),
      limitations: [
        'Single agent synthetic annotation; not independently validated real-world performance.',
        'Single-item cases cannot establish recommendation recall; unsupported rate null when no recommendations are emitted.',
        'Heldout aggregate is an evaluation only; never tune rules or labels from heldout outputs.',
        'Semantic unit scores classify short synthetic text; product pipeline separately applies real length and quality gates without fabricated completeness metadata.',
      ],
    },
    null,
    2
  )
)
