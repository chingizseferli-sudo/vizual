// Extra actual-SQL checks against the disposable fixture created by test-ai-db.
// No deployed schema or real credentials are used.
import assert from 'node:assert/strict'

export async function runContentDbChecks({ db, ids, key, role, denied }) {
  let checks = 0
  const test = async (name, operation) => {
    await operation()
    checks++
    console.log(`PASS CONTENT ${name}`)
  }
  const enqueue = async (owner = ids.a, item = '1', request = key()) =>
    (
      await db.query('select enqueue_content_intake($1,$2,$3) as data', [
        owner,
        item,
        request,
      ])
    ).rows[0].data
  const claim = async () =>
    (await db.query('select claim_content_intake(1) as data')).rows.map(
      (r) => r.data
    )
  const finish = async (job, payload) =>
    (
      await db.query('select complete_content_intake($1,$2,$3) as done', [
        job.id,
        job.token,
        JSON.stringify(payload),
      ])
    ).rows[0].done
  const cancel = async (job, owner = ids.a) =>
    (
      await db.query('select cancel_content_intake($1,$2) as done', [
        job.id,
        owner,
      ])
    ).rows[0].done
  const fresh = async () => {
    await role('postgres')
    await db.exec(
      "update private.content_source_permissions set enabled=true,public_excerpt_approved=true,allowed_origin='https://publisher.invalid',next_fetch_at=now()-interval '1 second';update private.content_intake_config set enabled=true,queue_limit=1000,monthly_per_owner=1000"
    )
    await role('service_role')
  }
  await role('postgres')
  const baseline = (
    await db.query(
      'select id,content_metadata from monitored_items order by id'
    )
  ).rows
  const baselineIds = (
    await db.query('select id from private.content_intake_jobs')
  ).rows.map((r) => r.id)
  const stored = baseline.find((i) => i.id === 1).content_metadata
  const payload = {
    ...structuredClone(stored.provenance.content_quality),
    excerpt: stored.excerpt,
    collected_at: new Date().toISOString(),
  }
  try {
    await db.exec('update private.content_intake_config set enabled=false')
    await role('service_role')
    await test('collection remains disabled without explicit activation', async () => {
      await denied(() => enqueue())
      assert.equal((await claim()).length, 0)
    })
    await role('authenticated', ids.a)
    await test('browser cannot enqueue, claim, complete or inspect private intake', async () => {
      await denied(() => enqueue())
      await denied(() => claim())
      await denied(() => db.query('select * from private.content_intake_jobs'))
      await denied(() => db.query('select prune_content_intake(100)'))
    })
    await role('anon')
    await test('anonymous intake access denied by grants', () =>
      denied(() => enqueue()))
    await fresh()
    await test('foreign item ownership denied despite trusted service identity', () =>
      denied(() => enqueue(ids.b, '1')))
    await role('postgres')
    await db.exec(
      'update private.content_source_permissions set public_excerpt_approved=false'
    )
    await role('service_role')
    await test('fetch permission alone does not authorize public excerpt reuse', () =>
      denied(() => enqueue()))
    await fresh()
    await role('postgres')
    await db.query(
      "update user_profiles set status='blocked' where user_id=$1",
      [ids.a]
    )
    await role('service_role')
    await test('blocked owner cannot collect even with a matched publication', () =>
      denied(() => enqueue()))
    await role('postgres')
    await db.query(
      "update user_profiles set status='active' where user_id=$1",
      [ids.a]
    )
    await role('service_role')
    const request = key()
    let first
    await test('idempotent UUID retries reuse one request and quota reservation', async () => {
      first = await enqueue(ids.a, '1', request)
      assert.equal((await enqueue(ids.a, '1', request)).id, first.id)
    })
    const alias = key()
    await test('different UUIDs for one active owner/item reuse a fenced job', async () => {
      assert.equal((await enqueue(ids.a, '1', alias)).id, first.id)
    })
    await enqueue(ids.a, '3')
    const running = (await claim())[0]
    await test('global single-live-lease capacity survives repeated claims', async () => {
      assert.ok(running)
      assert.equal((await claim()).length, 0)
    })
    await test('stale tokens cannot persist content metadata', async () =>
      assert.equal(await finish({ ...running, token: ids.b }, payload), false))
    // Tests operate on separate queue records; all are restored/retired below.
    await cancel(running)
    await role('postgres')
    await db.exec(
      "update private.content_source_permissions set next_fetch_at=now()+interval '1 hour'"
    )
    await role('service_role')
    await test('shared source pacing prevents another replica immediately fetching', async () =>
      assert.equal((await claim()).length, 0))
    await fresh()
    const second = (await claim())[0]
    await cancel(second)
    await test('request aliases retain idempotency after terminal cancellation', async () =>
      assert.equal((await enqueue(ids.a, '1', alias)).id, first.id))
    await fresh()
    await enqueue()
    const checked = (await claim())[0]
    const good = {
      ...payload,
      source_id: checked.source_id,
      item_url: checked.item_url,
      provenance: { ...payload.provenance, original_url: checked.item_url },
    }
    await test('rights declaration does not replace an explicit verified grant', async () => {
      const bad = structuredClone(good)
      bad.provenance.rights.verified = false
      await denied(() => finish(checked, bad))
    })
    await test('robots unknown cannot authorize body persistence', async () => {
      const bad = structuredClone(good)
      bad.provenance.robots = { state: 'unknown', checked_at: null }
      await denied(() => finish(checked, bad))
    })
    await test('robots refusal and authentication/paywall body access fail closed', async () => {
      const bad = structuredClone(good)
      bad.provenance.robots = {
        state: 'denied',
        checked_at: new Date().toISOString(),
      }
      await denied(() => finish(checked, bad))
      const wall = structuredClone(good)
      wall.provenance.access.paywall = true
      await denied(() => finish(checked, wall))
      const auth = structuredClone(good)
      auth.provenance.access.authentication_required = true
      await denied(() => finish(checked, auth))
    })
    await test('stale robots permissions do not become fresh evidence', async () => {
      const bad = structuredClone(good)
      bad.provenance.robots = {
        state: 'allowed',
        checked_at: new Date(Date.now() - 172800000).toISOString(),
      }
      await denied(() => finish(checked, bad))
    })
    await test('summary length cannot be declared substantive body quality', async () => {
      const bad = structuredClone(good)
      bad.excerpt = 'Only a title'
      bad.quality.extracted_chars = 12
      bad.quality.retained_chars = 12
      await denied(() => finish(checked, bad), '22023')
    })
    await test('unknown payload fields and full-text archives are rejected', async () => {
      await denied(
        () => finish(checked, { ...good, full_text: 'must remain in memory' }),
        '22023'
      )
      const bad = structuredClone(good)
      bad.excerpt = 'x'.repeat(4001)
      bad.quality.retained_chars = 4001
      bad.quality.extracted_chars = 4001
      await denied(() => finish(checked, bad), '22023')
    })
    await test('safe failure quality is persisted without restricted text', async () => {
      const failed = structuredClone(good)
      failed.excerpt = null
      failed.quality = {
        label: 'source_inaccessible',
        extracted_chars: 0,
        retained_chars: 0,
        main_content_detected: false,
        reasons: ['paywall_detected'],
      }
      failed.provenance.access.paywall = true
      failed.provenance.robots = { state: 'unknown', checked_at: null }
      assert.equal(await finish(checked, failed), true)
    })
    await role('postgres')
    await test('publication text has a single retained storage location', async () => {
      const metadata = (
        await db.query(
          'select content_metadata from monitored_items where id::text=$1',
          [checked.item_id]
        )
      ).rows[0].content_metadata
      assert.equal(metadata.excerpt, null)
      assert.equal('excerpt' in metadata.provenance.content_quality, false)
    })
    for (const item of baseline)
      await db.query(
        'update monitored_items set content_metadata=$2::jsonb where id=$1',
        [
          item.id,
          item.content_metadata == null
            ? null
            : JSON.stringify(item.content_metadata),
        ]
      )
    await fresh()
    await enqueue()
    const revoked = (await claim())[0]
    await role('postgres')
    await db.query(
      'update private.content_source_permissions set enabled=false where source_id=$1',
      [revoked.source_id]
    )
    await role('service_role')
    await test('source grant revoked during processing cannot persist stale text', () =>
      denied(() =>
        finish(revoked, {
          ...good,
          source_id: revoked.source_id,
          item_url: revoked.item_url,
        })
      ))
    await cancel(revoked)
    await role('authenticated', ids.a)
    await test('source permission revocation immediately prevents AI serving and reuse', async () => {
      const data = (await db.query('select get_ai_insights() as data')).rows[0]
        .data
      assert.ok(
        data.runs.every(
          (run) =>
            !run.result?.evidence.some(
              (e) => e.quality_label === 'substantial_excerpt'
            )
        )
      )
    })
    await role('service_role')
    await test('bounded physical cleanup removes reusable revoked excerpts', async () => {
      const removed = (await db.query('select prune_content_intake(100) as n'))
        .rows[0].n
      assert.ok(removed >= 1 && removed <= 100)
    })
    await fresh()
    await enqueue()
    const origin = (await claim())[0]
    await role('postgres')
    await db.query(
      "update private.content_source_permissions set allowed_origin='https://narrowed.invalid' where source_id=$1",
      [origin.source_id]
    )
    await role('service_role')
    await test('origin narrowing revalidates permission independently of rights reference', () =>
      denied(() => finish(origin, good)))
    await cancel(origin)
    await fresh()
    await enqueue()
    const retry = (await claim())[0]
    await test('rate limits retry with bounded exponential backoff', async () => {
      assert.equal(
        (
          await db.query('select fail_content_intake($1,$2,$3) as done', [
            retry.id,
            retry.token,
            'rate_limited',
          ])
        ).rows[0].done,
        true
      )
      assert.equal((await claim()).length, 0)
    })
    await role('postgres')
    await db.query(
      "update private.content_intake_jobs set available_at=now()-interval '1 second' where id=$1",
      [retry.id]
    )
    await fresh()
    const again = (await claim())[0]
    await test('retry tokens fence earlier extraction attempts', async () =>
      assert.equal(await finish(retry, good), false))
    await test('request budget exhaustion is terminal and cancellation is owner-scoped', async () => {
      assert.equal(await cancel(again, ids.b), false)
      assert.equal(
        (
          await db.query('select fail_content_intake($1,$2,$3) as done', [
            again.id,
            again.token,
            'budget_exhausted',
          ])
        ).rows[0].done,
        true
      )
    })
    await fresh()
    await enqueue()
    await role('postgres')
    await db.exec('update private.content_intake_config set queue_limit=1')
    await role('service_role')
    await test('bounded queue applies backpressure across owner publications', () =>
      denied(() => enqueue(ids.a, '3'), '54000'))
    await role('postgres')
    await db.exec(
      'update private.content_intake_config set queue_limit=1000,monthly_per_owner=1'
    )
    await role('service_role')
    await test('monthly intake quota applies independently of queue capacity', () =>
      denied(() => enqueue(ids.a, '4'), '54000'))
  } finally {
    await role('postgres')
    await db.query(
      "update user_profiles set status='active' where user_id=$1",
      [ids.a]
    )
    await db.exec(
      "update private.content_intake_config set enabled=true,queue_limit=1000,monthly_per_owner=1000;update private.content_source_permissions set enabled=true,public_excerpt_approved=true,allowed_origin='https://publisher.invalid',next_fetch_at=now()-interval '1 second'"
    )
    for (const item of baseline)
      await db.query(
        'update monitored_items set content_metadata=$2::jsonb where id=$1',
        [
          item.id,
          item.content_metadata == null
            ? null
            : JSON.stringify(item.content_metadata),
        ]
      )
    await db.query(
      "update private.content_intake_jobs set status='dead',token=null,lease_until=null,finished_at=now() where id<>all($1::uuid[])",
      [baselineIds]
    )
  }
  return checks
}
