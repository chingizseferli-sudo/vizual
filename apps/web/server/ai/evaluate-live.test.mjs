import assert from 'node:assert/strict'
import { test } from 'node:test'
import { azQualityCases } from '../../tests/ai/az-quality-fixtures.mjs'
import { runControlledEvaluation } from './evaluate-live.mjs'
import { readConfig } from './provider.mjs'

const cases = azQualityCases.filter((x) => x.split === 'dev').slice(0, 3)
const config = {
  ...readConfig({ AI_INTELLIGENCE_ENABLED: 'true' }),
  provider: 'structured-http',
  paidAuthorized: true,
  maxCostUsd: 0.01,
}
const limits = {
  authorized: true,
  maxRequests: 1,
  budgetUsd: 0.01,
  intervalMs: 500,
}
const providerFactory = () => ({
  async classify({ evidence }) {
    return {
      classifications: evidence.map((x) => ({
        evidence_id: x.id,
        sentiment: 'neutral',
        stance: 'fact_report',
        topic: 'Müzakirə',
        action: null,
      })),
      usage: { input_tokens: 1, output_tokens: 1, cost_usd: 0.01 },
    }
  },
})
test('live evaluation authorization, budget and immutable synthetic source checks fail closed', async () => {
  await assert.rejects(
    runControlledEvaluation(
      cases,
      config,
      { ...limits, authorized: false },
      { providerFactory }
    ),
    /evaluation_not_authorized/
  )
  await assert.rejects(
    runControlledEvaluation(
      cases,
      config,
      { ...limits, budgetUsd: 0.001 },
      { providerFactory }
    ),
    /evaluation_budget_exhausted/
  )
  await assert.rejects(
    runControlledEvaluation(
      [{ ...cases[0], text: 'private production data' }],
      config,
      limits,
      { providerFactory }
    ),
    /synthetic_fixtures_required/
  )
})
test('live evaluation caps requests and reserved budget; calls are mocked', async () => {
  let called = 0
  const report = await runControlledEvaluation(cases, config, limits, {
    providerFactory: () => ({
      async classify(args) {
        called++
        return providerFactory().classify(args)
      },
    }),
    sleep: async () => {},
  })
  assert.equal(report.live_model, false)
  assert.equal(report.http_requests, 0)
  assert.ok(called <= 1)
  assert.ok(report.reserved_upper_bound_usd <= 0.01)
  assert.ok(report.evaluated_cases <= 3)
})
test('provider malformed attribution yields conservative failure without raw response', async () => {
  const report = await runControlledEvaluation(cases, config, limits, {
    providerFactory: () => ({
      async classify() {
        throw Error('SECRET SENTINEL RAW RESPONSE')
      },
    }),
    sleep: async () => {},
  })
  assert.equal(JSON.stringify(report).includes('SECRET'), false)
  assert.equal(report.failures.length, 1)
})
test('evaluation rejects relabeled or duplicate cases before spending and failures are not scored as gold uncertain', async () => {
  await assert.rejects(
    runControlledEvaluation([cases[0], cases[0]], config, limits, {
      providerFactory,
    }),
    /synthetic_fixtures_required/
  )
  await assert.rejects(
    runControlledEvaluation(
      [
        {
          ...cases[0],
          expected: { ...cases[0].expected, sentiment: 'neutral' },
        },
      ],
      config,
      limits,
      { providerFactory }
    ),
    /synthetic_fixtures_required/
  )
  let retries
  const report = await runControlledEvaluation(
    cases,
    { ...config, retries: 3 },
    limits,
    {
      providerFactory: (cfg) => {
        retries = cfg.retries
        return {
          async classify() {
            throw Error('timeout')
          },
        }
      },
      sleep: async () => {},
    }
  )
  assert.equal(retries, 0)
  assert.equal(report.failures.length, 1)
  assert.equal(report.metrics.overall.accuracy, 0)
})
