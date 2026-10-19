import { z } from 'zod'
import { pathToFileURL } from 'node:url'
import {
  azQualityCases,
  datasetMetadata,
} from '../../tests/ai/az-quality-fixtures.mjs'
import {
  scorePredictions,
  labelFingerprint,
} from '../../tests/ai/quality-evaluator.mjs'
import {
  selectEvidence,
  validateClassifications,
  PROMPT_VERSION,
  classifyDeterministically,
} from './pipeline.mjs'
import { createProvider, readConfig } from './provider.mjs'

const limitsSchema = z
  .object({
    authorized: z.boolean(),
    maxRequests: z.number().int().min(1).max(56),
    budgetUsd: z.number().positive().max(5),
    intervalMs: z.number().int().min(500).max(60000),
  })
  .strict()
export async function runControlledEvaluation(
  cases,
  config,
  rawLimits,
  {
    providerFactory = createProvider,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    signal,
  } = {}
) {
  const limits = limitsSchema.parse(rawLimits)
  if (
    !limits.authorized ||
    !config.enabled ||
    config.provider !== 'structured-http' ||
    !config.paidAuthorized
  )
    throw new Error('evaluation_not_authorized')
  const known = new Map(azQualityCases.map((c) => [c.id, c]))
  if (
    !datasetMetadata.synthetic ||
    new Set(cases.map((c) => c.id)).size !== cases.length ||
    cases.some(
      (c) =>
        !known.has(c.id) ||
        c.text !== known.get(c.id).text ||
        JSON.stringify(c.entity) !== JSON.stringify(known.get(c.id).entity) ||
        JSON.stringify(c.expected) !==
          JSON.stringify(known.get(c.id).expected) ||
        c.split !== known.get(c.id).split
    )
  )
    throw new Error('synthetic_fixtures_required')
  if (config.maxCostUsd > limits.budgetUsd)
    throw new Error('evaluation_budget_exhausted')
  let httpRequests = 0,
    successfulResponses = 0
  const provider = providerFactory(
    { ...config, retries: 0 },
    {
      signal,
      fetchImpl: async (...args) => {
        httpRequests++
        return globalThis.fetch(...args)
      },
    }
  )
  const predictions = [],
    baselinePredictions = [],
    failures = []
  let requests = 0,
    reserved = 0,
    inputTokens = 0,
    outputTokens = 0
  for (const item of cases) {
    if (signal?.aborted) throw new Error('evaluation_cancelled')
    const original = {
      id: item.id,
      title: 'Synthetic evaluation',
      url: `https://evaluation.example.invalid/${item.id}`,
      source_id: item.id,
      publisher: null,
      detected_at: '2026-10-13T10:00:00Z',
      published_at: null,
      metadata: { excerpt: item.text },
    }
    const evidence = selectEvidence({
      entity: item.entity,
      start: '2026-10-13T00:00:00Z',
      end: '2026-10-14T00:00:00Z',
      items: [original],
    })
    const baseline = classifyDeterministically(evidence, item.entity)[0]
    if (!evidence.length) {
      baselinePredictions.push({
        id: item.id,
        relevant: false,
        sentiment: null,
        stance: null,
        evidence_kind: null,
      })
      predictions.push({
        id: item.id,
        relevant: false,
        sentiment: null,
        stance: null,
        evidence_kind: null,
      })
      continue
    }
    if (
      requests >= limits.maxRequests ||
      reserved + config.maxCostUsd > limits.budgetUsd
    )
      break
    if (requests) await sleep(limits.intervalMs)
    if (signal?.aborted) throw new Error('evaluation_cancelled')
    baselinePredictions.push({
      id: item.id,
      relevant: true,
      sentiment: baseline.sentiment,
      stance: baseline.stance,
      evidence_kind: baseline.evidence_kind || null,
    })
    requests++
    reserved += config.maxCostUsd
    try {
      const output = await provider.classify({
        entity: item.entity,
        evidence,
        promptVersion: PROMPT_VERSION,
      })
      const parsed = validateClassifications(
        output.classifications,
        evidence
      )[0]
      successfulResponses++
      inputTokens += output.usage.input_tokens || 0
      outputTokens += output.usage.output_tokens || 0
      predictions.push({
        id: item.id,
        relevant: true,
        sentiment: parsed.sentiment,
        stance: parsed.stance,
        evidence_kind: parsed.evidence_kind || null,
      })
    } catch {
      failures.push(item.id)
      predictions.push({
        id: item.id,
        relevant: true,
        sentiment: null,
        stance: null,
        evidence_kind: null,
      })
    }
  }
  const evaluated = cases.filter((c) => predictions.some((p) => p.id === c.id))
  return {
    synthetic: true,
    live_model: httpRequests > 0 && successfulResponses > 0,
    live_model_attempted: httpRequests > 0,
    http_requests: httpRequests,
    validated_responses: successfulResponses,
    semantic_unit_only: true,
    provider: config.provider,
    model: config.model,
    prompt_version: PROMPT_VERSION,
    dataset_version: datasetMetadata.version,
    label_fingerprint: labelFingerprint(cases),
    requested_cases: cases.length,
    evaluated_cases: evaluated.length,
    requests,
    failures,
    reserved_upper_bound_usd: reserved,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    metrics: scorePredictions(evaluated, predictions),
    rules_baseline: scorePredictions(evaluated, baselinePredictions),
    internal_retries: 0,
    limitations: [
      'Configured model identifier is not a verified immutable vendor revision.',
      'Synthetic semantic classification is not production content or deployment validation.',
      'Unused/failed call reservations are not refunded; estimates are not provider invoices.',
    ],
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (!process.argv.includes('--execute'))
    console.log(
      JSON.stringify({
        status: 'NOT_RUN',
        synthetic: true,
        heldout_cases: azQualityCases.filter((c) => c.split === 'heldout')
          .length,
        required_flags: [
          '--execute',
          'AI_EVAL_PAID_CALLS_AUTHORIZED=true',
          'AI_INTELLIGENCE_ENABLED=true',
          'AI_PAID_CALLS_AUTHORIZED=true',
        ],
        required_limits: [
          'AI_EVAL_MAX_REQUESTS',
          'AI_EVAL_BUDGET_USD',
          'AI_EVAL_INTERVAL_MS',
        ],
        provider_contract: 'structured-http',
        private_production_content: false,
      })
    )
  else {
    try {
      const config = readConfig(process.env)
      const limits = {
        authorized: process.env.AI_EVAL_PAID_CALLS_AUTHORIZED === 'true',
        maxRequests: Number(process.env.AI_EVAL_MAX_REQUESTS || 0),
        budgetUsd: Number(process.env.AI_EVAL_BUDGET_USD || 0),
        intervalMs: Number(process.env.AI_EVAL_INTERVAL_MS || 1000),
      }
      const controller = new AbortController()
      process.once('SIGINT', () => controller.abort())
      process.once('SIGTERM', () => controller.abort())
      console.log(
        JSON.stringify(
          await runControlledEvaluation(
            azQualityCases.filter((c) => c.split === 'heldout'),
            config,
            limits,
            { signal: controller.signal }
          )
        )
      )
    } catch {
      console.error('evaluation_not_run_or_failed')
      process.exitCode = 1
    }
  }
}
