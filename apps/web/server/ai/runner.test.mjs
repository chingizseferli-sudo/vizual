import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readConfig, createProvider } from './provider.mjs'
import { ResultCache, runBatch } from './runner.mjs'

const config = readConfig({ AI_INTELLIGENCE_ENABLED: 'true' })
const job = {
  id: 'job1',
  token: 'lease1',
  owner_id: 'tenant1',
  period_start: '2026-10-01T00:00:00Z',
  period_end: '2026-10-10T00:00:00Z',
  evidence: {
    entity: { name: 'Bakı Dövlət Universiteti', aliases: [] },
    items: [],
  },
  limits: {
    max_input_chars: 12000,
    per_attempt_cost_usd: 0.01,
    max_attempts: 3,
  },
}
function repo() {
  const result = {
    calls: [],
    async claim() {
      result.calls.push('claim')
      return [job]
    },
    async complete(_job, _result, meta) {
      result.calls.push('complete')
      assert.equal(meta.costUsd, 0)
      return true
    },
    async fail(_job, code) {
      result.calls.push(code)
      return true
    },
  }
  return result
}
test('default disabled makes no job or provider operation', async () => {
  const db = repo()
  await assert.rejects(runBatch(db, readConfig()), /feature_disabled/)
  assert.deepEqual(db.calls, [])
})
test('idempotent cache tenant partition and expiry', () => {
  const cache = new ResultCache(20, 1)
  cache.set('tenant1:a', { x: 1 }, 100)
  assert.equal(cache.get('tenant2:a', 101), null)
  assert.deepEqual(cache.get('tenant1:a', 101), { x: 1 })
  assert.equal(cache.get('tenant1:a', 121), null)
  cache.set('a', {}, 100)
  cache.set('b', {}, 101)
  assert.equal(cache.get('a', 102), null)
})
test('batch persists bounded verified output and caches without duplicate cost', async () => {
  const db = repo(),
    cache = new ResultCache()
  const first = await runBatch(db, config, { cache })
  const second = await runBatch(db, config, { cache })
  assert.equal(first.completed, 1)
  assert.equal(second.cached, 1)
})
test('cancellation before claiming no operation', async () => {
  const db = repo()
  await assert.rejects(
    runBatch(db, config, { signal: AbortSignal.abort() }),
    /cancelled/
  )
  assert.deepEqual(db.calls, [])
})
test('lost lease cannot mark completion', async () => {
  const db = repo()
  db.complete = async () => false
  assert.equal((await runBatch(db, config)).stale, 1)
})
test('malformed provider output fails with generic code', async () => {
  const db = repo()
  const filled = {
    ...job,
    evidence: {
      ...job.evidence,
      items: [
        {
          id: 'a',
          title: 'Bakı Dövlət Universiteti xəbər',
          url: 'https://example.invalid/a',
          source_id: 's1',
          publisher: null,
          published_at: null,
          detected_at: '2026-10-05T00:00:00Z',
        },
      ],
    },
  }
  db.claim = async () => [filled]
  const result = await runBatch(db, config, {
    providerFactory: () => ({
      name: 'fixture',
      model: 'fixture',
      method: 'model',
      async classify() {
        return {
          classifications: [{ evidence_id: 'invented' }],
          usage: { cost_usd: 0 },
        }
      },
    }),
  })
  assert.equal(result.failed, 1)
  assert.deepEqual(db.calls, ['invalid_output'])
})
const paid = () =>
  readConfig({
    AI_INTELLIGENCE_ENABLED: 'true',
    AI_PROVIDER: 'structured-http',
    AI_MODEL: 'test-model',
    AI_PAID_CALLS_AUTHORIZED: 'true',
    AI_PROVIDER_API_KEY: 'SYNTHETIC-NOT-A-KEY',
    AI_PROVIDER_ENDPOINT: 'https://provider.example.invalid/classify',
    AI_INPUT_USD_PER_MILLION: '1',
    AI_OUTPUT_USD_PER_MILLION: '1',
    AI_MAX_JOB_COST_USD: '0.1',
  })
test('paid adapter validates usage, abort, redirects and response size', async () => {
  let calls = 0
  const provider = createProvider(paid(), {
    fetchImpl: async (_url, options) => {
      calls++
      assert.equal(options.redirect, 'error')
      return new Response(
        JSON.stringify({
          classifications: [],
          usage: { input_tokens: 20, output_tokens: 10 },
        }),
        { status: 200 }
      )
    },
  })
  const result = await provider.classify({
    entity: { name: 'Test' },
    evidence: [],
    promptVersion: 'v1',
  })
  assert.ok(result.usage.cost_usd > 0)
  assert.equal(calls, 1)
  const aborted = createProvider(paid(), {
    signal: AbortSignal.abort(),
    fetchImpl: () => {
      throw Error('should not call')
    },
  })
  await assert.rejects(
    aborted.classify({ entity: {}, evidence: [], promptVersion: 'v1' }),
    /cancelled/
  )
  const oversized = createProvider(paid(), {
    fetchImpl: async () => new Response('a'.repeat(262145)),
  })
  await assert.rejects(
    oversized.classify({ entity: {}, evidence: [], promptVersion: 'v1' }),
    /output_limit/
  )
})
test('rate limit retries bounded and reserve worst-case costs', async () => {
  let count = 0
  const p = createProvider(
    { ...paid(), retries: 1 },
    {
      fetchImpl: async () => {
        count++
        return new Response('', { status: 429 })
      },
    }
  )
  await assert.rejects(
    p.classify({ entity: {}, evidence: [], promptVersion: 'v1' }),
    /rate_limited/
  )
  assert.equal(count, 2)
  const budget = createProvider(
    { ...paid(), maxCostUsd: 0.00001 },
    {
      fetchImpl: () => {
        throw Error('must not call')
      },
    }
  )
  await assert.rejects(
    budget.classify({ entity: {}, evidence: [], promptVersion: 'v1' }),
    /budget_exceeded/
  )
})
