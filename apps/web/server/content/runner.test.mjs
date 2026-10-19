import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ContentError } from './http.mjs'
import { runContentBatch } from './runner.mjs'

const job = {
  id: 'fixture',
  token: 'token',
  source_id: 's1',
  item_url: 'https://publisher.example.invalid/a',
  item_title: 'Fictional headline',
  permission: {
    allowed_origin: 'https://publisher.example.invalid',
    basis: 'owned_source',
    reference: 'synthetic',
  },
}
const repository = () => ({
  async claim(limit) {
    assert.equal(limit, 1)
    return [job]
  },
  async complete(_job, payload) {
    assert.equal(payload.excerpt, null)
    return true
  },
  async fail() {
    return true
  },
})
test('batch default off and pre-abort never claim', async () => {
  const db = {
    claim() {
      throw Error('should not claim')
    },
  }
  await assert.rejects(runContentBatch(db), /collection_disabled/)
  await assert.rejects(
    runContentBatch(db, { enabled: true, signal: AbortSignal.abort() }),
    /cancelled/
  )
})
test('one protected claim processes inline RSS then fenced persistence', async () => {
  const result = await runContentBatch(repository(), {
    enabled: true,
    inlineAdapter: async () => ({
      feed: { content_encoded: '<p>Short synthetic text</p>' },
    }),
  })
  assert.equal(result.completed, 1)
})
test('retries and queue cancellation expose generic codes only; stale tokens not complete', async () => {
  const db = repository()
  let code
  db.fail = async (_job, error) => {
    code = error
    return true
  }
  const result = await runContentBatch(db, {
    enabled: true,
    collector: async () => {
      throw new ContentError('rate_limited', true)
    },
  })
  assert.equal(result.failed, 1)
  assert.equal(code, 'rate_limited')
  db.complete = async () => false
  const stale = await runContentBatch(db, {
    enabled: true,
    collector: async () => ({ excerpt: null }),
  })
  assert.equal(stale.stale, 1)
})
test('authorization is not replaced by adapter fields; invalid origin proof fails before network', async () => {
  const db = repository()
  db.claim = async () => [
    {
      ...job,
      permission: {
        ...job.permission,
        allowed_origin: 'https://other.example.invalid',
      },
    },
  ]
  db.complete = () => {
    throw Error('must not persist')
  }
  const result = await runContentBatch(db, {
    enabled: true,
    inlineAdapter: async () => ({ feed: { content_encoded: 'tiny' } }),
  })
  assert.equal(result.failed, 1)
})
test('cumulative processing deadline fits lease and prevents late completion', async () => {
  const db = repository()
  let failure
  db.complete = () => {
    throw Error('expired work must not finish')
  }
  db.fail = async (_job, code) => {
    failure = code
    return true
  }
  const stats = await runContentBatch(db, {
    enabled: true,
    maxJobMs: 5,
    collector: async () =>
      new Promise((resolve) =>
        setTimeout(() => resolve({ excerpt: null }), 30)
      ),
  })
  assert.equal(stats.failed, 1)
  assert.equal(failure, 'budget_exhausted')
})
