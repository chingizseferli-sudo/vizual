// Actual PostgreSQL engine, synthetic contract only; never contacts a live DB.
import { PGlite } from '@electric-sql/pglite'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { analyze } from '../server/ai/pipeline.mjs'
import { createProvider, readConfig } from '../server/ai/provider.mjs'
import { collectContent } from '../server/content/collector.mjs'

const db = new PGlite()
let checks = 0
const ids = {
  a: '00000000-0000-4000-8000-000000000001',
  b: '00000000-0000-4000-8000-000000000002',
  blocked: '00000000-0000-4000-8000-000000000003',
  absent: '00000000-0000-4000-8000-000000000004',
}
const period = {
  start: new Date(Date.now() - 86400000).toISOString(),
  end: new Date().toISOString(),
}
let nextRequest = 10
const key = () =>
  `00000000-0000-4000-8000-${String(nextRequest++).padStart(12, '0')}`
async function test(name, operation) {
  await operation()
  checks++
  console.log(`PASS ${name}`)
}
async function role(name, uid = '') {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [uid])
  await db.exec(`set role ${name}`)
}
async function denied(operation, code = '42501') {
  await assert.rejects(operation, (e) => e.code === code)
}
async function insights() {
  return (await db.query('select get_ai_insights() as data')).rows[0].data
}
async function request(requestKey = key(), monitor = '11', window = period) {
  return (
    await db.query('select request_ai_insights($1,$2,$3,$4) as data', [
      window.start,
      window.end,
      monitor,
      requestKey,
    ])
  ).rows[0].data
}
async function claim(limit = 1) {
  return (
    await db.query('select claim_ai_insight_jobs($1) as data', [limit])
  ).rows.map((r) => r.data)
}
async function finish(job, result, cost = 0) {
  return (
    await db.query(
      'select complete_ai_insight_job($1,$2,$3,$4,$5,$6,$7) as done',
      [
        job.id,
        job.token,
        JSON.stringify(result),
        'deterministic',
        'rule-baseline',
        'test-v1',
        cost,
      ]
    )
  ).rows[0].done
}
async function resultFor(job) {
  const input = {
    entity: job.evidence.entity,
    start: job.evidence.start,
    end: job.evidence.end,
    items: job.evidence.items,
  }
  return (
    await analyze(
      input,
      createProvider(readConfig({ AI_INTELLIGENCE_ENABLED: 'true' })),
      { maxInputChars: job.limits.max_input_chars }
    )
  ).result
}

try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to anon,authenticated,service_role;
    create table subscription_plans(id bigint primary key,history_days integer,is_active boolean default true);
    create table user_profiles(user_id uuid primary key,status text,plan_id bigint);
    create table user_subscriptions(user_id uuid,plan_id bigint,status text,current_period_end timestamptz);
    create table user_monitors(id bigint primary key,user_id uuid,name text);
    create table sources(id bigint primary key,name text,rss_url text);
    create table monitored_items(id bigint primary key,source_id bigint,title text,url text,published_at timestamptz,detected_at timestamptz);
    create table monitor_matches(item_id bigint,monitor_id bigint,matched_keyword text);
    insert into subscription_plans values(1,30,true),(2,1,true);
    insert into user_profiles values('${ids.a}','active',1),('${ids.b}','active',1),('${ids.blocked}','blocked',1);
    insert into user_subscriptions values('${ids.a}',1,'active',null),('${ids.b}',1,'active',null);
    insert into user_monitors values(11,'${ids.a}','Bakı Dövlət Universiteti'),(12,'${ids.b}','Other institution'),(13,'${ids.blocked}','Blocked institution');
    insert into sources values(21,'Synthetic publisher A','https://a.invalid/rss'),(22,'Synthetic publisher B','https://b.invalid/rss');
    insert into monitored_items select n,case when n=3 then 22 else 21 end,
      case when n=2 then 'Other institution private B' else 'Bakı Dövlət Universiteti yeni proqram təqdim edir '||n end,
      'https://publisher.invalid/item/'||n,now()-interval '1 hour',now()-interval '1 hour' from generate_series(1,4) n;
    insert into monitor_matches values(1,11,'Bakı Dövlət Universiteti'),(2,12,'Other'),(3,11,'BDU'),(3,12,'shared'),(4,11,'BDU');
    alter table user_profiles enable row level security;alter table user_monitors enable row level security;
    alter table monitor_matches enable row level security;alter table monitored_items enable row level security;
  `)
  const sql = await readFile(
    new URL(
      '../supabase/migrations/202610130001_ai_insights.sql',
      import.meta.url
    ),
    'utf8'
  )
  await test('AI migration fails closed without analytics prerequisite', async () => {
    await assert.rejects(
      () => db.exec(sql),
      /AI_ANALYTICS_PREREQUISITE_REQUIRED/
    )
    await db.exec('rollback')
    assert.equal(
      (await db.query("select to_regclass('private.ai_jobs') as jobs")).rows[0]
        .jobs,
      null
    )
  })
  await db.exec(
    await readFile(
      new URL(
        '../supabase/migrations/202610120001_content_analytics.sql',
        import.meta.url
      ),
      'utf8'
    )
  )
  await test('additive AI migration executes on synthetic bigint content contract', () =>
    db.exec(sql))
  await db.exec(
    await readFile(
      new URL(
        '../supabase/migrations/202610130002_content_quality.sql',
        import.meta.url
      ),
      'utf8'
    )
  )
  await role('authenticated', ids.a)
  await test('default feature disabled and monitor options scoped to caller', async () => {
    const data = await insights()
    assert.equal(data.available, false)
    assert.equal(data.reason, 'disabled')
    assert.deepEqual(
      data.monitors.map((m) => m.id),
      ['11']
    )
    assert.deepEqual(data.runs, [])
    await denied(() => request())
    await denied(() => db.query('select * from private.ai_jobs'))
    await denied(() => claim())
  })
  await role('anon')
  await test('anonymous list, request and provider persistence denied by grants', async () => {
    await denied(() => insights())
    await denied(() => request())
    await denied(() => claim())
  })
  for (const name of ['blocked', 'absent']) {
    await role('authenticated', ids[name])
    await test(`${name} profile denied`, () => denied(() => insights()))
  }
  await role('postgres')
  await db.exec('update private.ai_system_config set enabled=true')
  await role('authenticated', ids.a)
  await test('global enable does not enable an unconfigured plan', async () => {
    assert.equal((await insights()).reason, 'plan_disabled')
    await denied(() => request())
  })
  await role('postgres')
  await db.exec(
    "insert into private.ai_plan_features(plan_id,enabled,monthly_jobs,reserved_cost_usd,max_input_chars) values('1',true,100,0.3,30000)"
  )
  await role('authenticated', ids.a)
  await test('other tenant monitor and invalid windows rejected server-side', async () => {
    await denied(() => request(key(), '12'))
    await denied(
      () => request(key(), '11', { start: period.end, end: period.start }),
      '22023'
    )
  })
  const requestKey = key()
  let first
  await test('enqueue reserves monthly quota once and duplicates reuse identical job', async () => {
    first = await request(requestKey)
    const reused = await request(requestKey)
    assert.equal(reused.id, first.id)
    assert.equal(reused.reused, true)
    assert.equal((await insights()).quota.used, 1)
    await denied(
      () =>
        request(requestKey, '11', {
          start: new Date(Date.parse(period.start) + 1000).toISOString(),
          end: period.end,
        }),
      '22023'
    )
  })
  await role('authenticated', ids.b)
  await test('tenant B cannot read or cancel tenant A job', async () => {
    assert.equal((await insights()).runs.length, 0)
    assert.equal(
      (await db.query('select cancel_ai_insight_job($1) as done', [first.id]))
        .rows[0].done,
      false
    )
  })
  await role('service_role')
  let job
  await test('trusted claim contains only tenant evidence and attempt budget', async () => {
    job = (await claim())[0]
    assert.deepEqual(job.evidence.items.map((x) => x.id).sort(), [
      '1',
      '3',
      '4',
    ])
    assert.equal(job.evidence.items.find((x) => x.id === '3').matches.length, 1)
    assert.equal(job.limits.max_attempts, 3)
    assert.equal(job.limits.per_attempt_cost_usd, 0.1)
    assert.equal((await claim()).length, 0)
  })
  const result = await resultFor(job)
  await role('authenticated', ids.a)
  await test('browser cannot persist provider results or purge private jobs', async () => {
    await denied(() => finish(job, result))
    await denied(() => db.query('select prune_ai_insight_jobs(100)'))
  })
  await role('service_role')
  await test('real deterministic pipeline supplies validated title-only result', async () => {
    assert.equal(result.evidence.length, 3)
    assert.equal(result.recommendations.length, 0)
  })
  await test('missing classification fields and fabricated evidence rejected', async () => {
    for (const path of ['version', 'text_scope', 'sentiment', 'stance']) {
      const invalid = structuredClone(result)
      if (path === 'version') delete invalid.version
      else delete invalid.evidence[0][path]
      await denied(() => finish(job, invalid), '22023')
    }
    const wrong = structuredClone(result)
    wrong.evidence[0].url = 'https://invented.invalid/'
    await denied(() => finish(job, wrong), '22023')
    const refs = structuredClone(result)
    refs.evidence_ids.push('2')
    await denied(() => finish(job, refs), '22023')
    const totals = structuredClone(result)
    totals.topics[0].mentions = 99
    await denied(() => finish(job, totals), '22023')
    const sources = structuredClone(result)
    sources.topics[0].distinct_sources = 99
    await denied(() => finish(job, sources), '22023')
  })
  await test('budget bounds and stale lease tokens prevent persistence', async () => {
    await denied(() => finish(job, result, 0.2), '22023')
    assert.equal(await finish({ ...job, token: ids.b }, result), false)
  })
  await test('validated persistence and repeated completion are idempotent', async () => {
    assert.equal(await finish(job, result), true)
    assert.equal(await finish(job, result), false)
  })
  await role('authenticated', ids.a)
  await test('customer can retrieve only own immutable result', async () => {
    const data = await insights()
    assert.equal(data.runs[0].result.evidence.length, 3)
    assert.equal(data.runs[0].status, 'complete')
    await denied(() => db.query('update private.ai_jobs set result=null'))
  })
  await role('postgres')
  await db.exec(`update monitored_items set content_metadata=jsonb_build_object('version',1,'excerpt',
    'Bakı Dövlət Universiteti dərs cədvəli problem yaradır, çətin saatlar '||id,'provenance','{}'::jsonb) where id in (1,3,4)`)
  await role('authenticated', ids.a)
  await request()
  await role('service_role')
  const unpermitted = (await claim())[0]
  await test('unconfirmed excerpt access never enters provider input', async () => {
    assert.ok(
      unpermitted.evidence.items.every((item) => !item.metadata?.excerpt)
    )
    const output = await resultFor(unpermitted)
    assert.equal(output.recommendations.length, 0)
    assert.equal(await finish(unpermitted, output), true)
  })
  await role('postgres')
  await db.exec(`update private.content_intake_config set enabled=true;
    insert into private.content_source_permissions(source_id,enabled,public_excerpt_approved,allowed_origin,rights_basis,rights_reference) values
      ('21',true,true,'https://publisher.invalid','licensed','synthetic-license-v1'),('22',true,true,'https://publisher.invalid','licensed','synthetic-license-v1');`)
  for (const itemId of ['1', '3', '4']) {
    await role('service_role')
    const intake = (
      await db.query('select enqueue_content_intake($1,$2,$3) as data', [
        ids.a,
        itemId,
        key(),
      ])
    ).rows[0].data
    await role('postgres')
    await db.exec(
      "update private.content_source_permissions set next_fetch_at=now()-interval '1 second'"
    )
    await role('service_role')
    const taken = (await db.query('select claim_content_intake(1) as data'))
      .rows[0].data
    assert.equal(taken.id, intake.id)
    const body = `Mən Bakı Dövlət Universiteti dərs cədvəli səbəbindən çətinlik çəkirəm, ${itemId} mənim təcrübəmdir. Bakı Dövlət Universiteti dərsləri arasında uzun boş saatlar qalır və evə qayıtmaq üçün vaxt tapa bilmirəm. Bakı Dövlət Universiteti cədvəli gündəlik vaxtımı planlaşdırmaqda problem yaradır və mən bunu şəxsi şikayətim kimi bildirirəm.`
    const payload = await collectContent(
      {
        source_id: taken.source_id,
        url: taken.item_url,
        title: taken.item_title,
        feed: { content_encoded: `<p>${body}</p>`, language: 'az' },
      },
      {
        enabled: true,
        sourceId: taken.source_id,
        origins: [taken.permission.allowed_origin],
        rights: {
          basis: taken.permission.basis,
          reference: taken.permission.reference,
          verified: true,
        },
      }
    )
    assert.equal(
      (
        await db.query('select complete_content_intake($1,$2,$3) as done', [
          taken.id,
          taken.token,
          JSON.stringify(payload),
        ])
      ).rows[0].done,
      true
    )
  }
  if (process.argv.includes('--with-content')) {
    const { runContentDbChecks } = await import('./content-db-checks.mjs')
    checks += await runContentDbChecks({ db, ids, key, role, denied })
  }
  await role('authenticated', ids.a)
  await request()
  await role('service_role')
  const permitted = (await claim())[0]
  const recommendations = await resultFor(permitted)
  await test('permitted synthetic excerpts produce evidence-based recommendations end to end', async () => {
    assert.equal(recommendations.recommendations.length, 1)
    assert.equal(recommendations.recommendations[0].mentions, 3)
    assert.equal(recommendations.recommendations[0].distinct_sources, 2)
    assert.equal(await finish(permitted, recommendations), true)
  })
  await role('authenticated', ids.a)
  await test('human review persists separately without rewriting model evidence', async () => {
    assert.equal(
      (
        await db.query('select review_ai_recommendation($1,0,$2) as done', [
          permitted.id,
          'accepted',
        ])
      ).rows[0].done,
      true
    )
    const saved = (await insights()).runs.find((run) => run.id === permitted.id)
    assert.equal(saved.reviews[0].verdict, 'accepted')
    assert.equal(saved.result.recommendations[0].mentions, 3)
  })
  await role('authenticated', ids.b)
  await test('another tenant cannot review recommendations', () =>
    denied(() =>
      db.query('select review_ai_recommendation($1,0,$2)', [
        permitted.id,
        'rejected',
      ])
    ))
  await role('authenticated', ids.a)
  await request()
  await role('postgres')
  await db.exec(
    "update monitored_items set content_metadata=jsonb_set(content_metadata,'{provenance,excerpt_access}','\"unavailable\"') where id=1"
  )
  await role('authenticated', ids.a)
  await test('revoked excerpt rights hide persisted results and reject human review', async () => {
    assert.equal(
      (await insights()).runs.some((run) => run.id === permitted.id),
      false
    )
    await denied(() =>
      db.query('select review_ai_recommendation($1,0,$2)', [
        permitted.id,
        'accepted',
      ])
    )
  })
  await role('service_role')
  await test('revoked excerpt rights prevent provider dispatch and purge terminal snapshots', async () => {
    assert.equal((await claim()).length, 0)
    assert.ok(
      (await db.query('select prune_ai_insight_jobs(100) as n')).rows[0].n >= 1
    )
  })
  await role('postgres')
  await db.exec(
    `update monitored_items set content_metadata=jsonb_set(content_metadata,'{provenance,excerpt_access}','"permitted"') where id=1`
  )
  await role('authenticated', ids.a)
  await request()
  await role('service_role')
  const invalidAggregate = (await claim())[0]
  await test('isolated complaints and fabricated sentiment totals rejected', async () => {
    const output = await resultFor(invalidAggregate)
    output.recommendations[0].evidence_ids = [output.evidence_ids[0]]
    output.recommendations[0].mentions = 1
    output.recommendations[0].distinct_sources = 1
    await denied(() => finish(invalidAggregate, output), '22023')
    const sentiment = await resultFor(invalidAggregate)
    sentiment.topics[0].negative = 99
    await denied(() => finish(invalidAggregate, sentiment), '22023')
    await db.query('select fail_ai_insight_job($1,$2,$3)', [
      invalidAggregate.id,
      invalidAggregate.token,
      'invalid_output',
    ])
    assert.equal((await claim()).length, 0)
  })
  await role('authenticated', ids.a)
  await request()
  await role('service_role')
  const runningRevoked = (await claim())[0]
  const runningOutput = await resultFor(runningRevoked)
  await role('postgres')
  await db.exec(
    "update monitored_items set content_metadata=jsonb_set(content_metadata,'{provenance,excerpt_access}','\"unavailable\"') where id=1"
  )
  await role('service_role')
  await test('rights revoked during a provider call cannot persist its stale output', () =>
    denied(() => finish(runningRevoked, runningOutput)))
  await db.query('select fail_ai_insight_job($1,$2,$3)', [
    runningRevoked.id,
    runningRevoked.token,
    'cancelled',
  ])
  await role('postgres')
  await db.exec(
    `update monitored_items set content_metadata=jsonb_set(content_metadata,'{provenance,excerpt_access}','"permitted"') where id=1`
  )
  await role('postgres')
  await db.exec(
    `update user_subscriptions set current_period_end=now()-interval '1 second' where user_id='${ids.a}'`
  )
  await role('authenticated', ids.a)
  await test('expired subscription prevents reads and new paid requests', async () => {
    assert.equal((await insights()).reason, 'subscription_required')
    assert.equal((await insights()).runs.length, 0)
    await denied(() => request())
  })
  await role('postgres')
  await db.exec(
    `update user_subscriptions set current_period_end=null where user_id='${ids.a}'`
  )
  await role('authenticated', ids.a)
  const transfer = await request()
  await role('postgres')
  await db.exec(`update user_monitors set user_id='${ids.b}' where id=11`)
  await role('service_role')
  await test('ownership revocation before claim prevents provider dispatch', async () => {
    assert.equal((await claim()).length, 0)
  })
  await role('postgres')
  await db.exec(`update user_monitors set user_id='${ids.a}' where id=11`)
  await test('ownership-revoked queue job becomes terminal', async () => {
    assert.equal(
      (
        await db.query('select status from private.ai_jobs where id=$1', [
          transfer.id,
        ])
      ).rows[0].status,
      'dead'
    )
  })
  await role('authenticated', ids.a)
  const cancelled = await request()
  await test('customer cancellation invalidates pending work', async () => {
    assert.equal(
      (
        await db.query('select cancel_ai_insight_job($1) as done', [
          cancelled.id,
        ])
      ).rows[0].done,
      true
    )
  })
  await role('service_role')
  await test('cancelled job is not claimable', async () =>
    assert.equal((await claim()).length, 0))
  await role('authenticated', ids.a)
  await request()
  await role('service_role')
  const retry = (await claim())[0]
  await test('provider failure retries with backoff and exhausted leases become terminal', async () => {
    assert.equal(
      (
        await db.query('select fail_ai_insight_job($1,$2,$3) as done', [
          retry.id,
          retry.token,
          'provider_unavailable',
        ])
      ).rows[0].done,
      true
    )
    assert.equal((await claim()).length, 0)
  })
  await role('postgres')
  await db.query(
    "update private.ai_jobs set available_at=now()-interval '1 second' where id=$1",
    [retry.id]
  )
  await role('service_role')
  const retry2 = (await claim())[0]
  await test('reclaimed lease fences original token', async () => {
    assert.notEqual(retry.token, retry2.token)
    assert.equal(await finish(retry, result), false)
  })
  await role('postgres')
  await db.query(
    "update private.ai_jobs set attempts=3,lease_until=now()-interval '1 second' where id=$1",
    [retry.id]
  )
  await role('service_role')
  await test('expired final attempt is dead, without a fourth provider call', async () => {
    assert.equal((await claim()).length, 0)
  })
  await role('authenticated', ids.a)
  const previousMonth = await request()
  await role('postgres')
  await db.query(
    "update private.ai_jobs set created_at=date_trunc('month',now())-interval '1 hour' where id=$1",
    [previousMonth.id]
  )
  await role('service_role')
  await test('previous-month reservations cannot dispatch into a new budget month', async () => {
    assert.equal((await claim()).length, 0)
  })
  await role('postgres')
  assert.equal(
    (
      await db.query('select error_code from private.ai_jobs where id=$1', [
        previousMonth.id,
      ])
    ).rows[0].error_code,
    'budget_window_expired'
  )
  await role('postgres')
  await db.exec('update private.ai_system_config set monthly_budget_usd=0')
  await role('authenticated', ids.a)
  await test('global conservative reservation budget enforced', () =>
    denied(() => request(), '54000'))
  await role('postgres')
  await db.exec(
    'update private.ai_system_config set monthly_budget_usd=10;update private.ai_plan_features set monthly_jobs=1'
  )
  await role('authenticated', ids.a)
  await test('tenant monthly quota enforced independently of UI', () =>
    denied(() => request(), '54000'))
  await role('postgres')
  await db.exec(
    'update private.ai_plan_features set monthly_jobs=100;update private.ai_system_config set queue_limit=1'
  )
  await role('authenticated', ids.a)
  await request()
  await test('bounded queue applies backpressure', () =>
    denied(() => request(), '54000'))
  await role('postgres')
  await db.query(
    "update private.ai_jobs set period_start=now()-interval '40 days' where id=$1",
    [first.id]
  )
  await db.query(
    `insert into private.ai_jobs(owner_id,request_key,monitor_id,monitor_name,plan_id,period_start,period_end,evidence,limits,status,attempts,token,lease_until)
    select owner_id,$2::uuid,monitor_id,monitor_name,plan_id,period_start,period_end,evidence,limits,'running',1,gen_random_uuid(),now()+interval '5 minutes'
    from private.ai_jobs where id=$1`,
    [first.id, key()]
  )
  await role('service_role')
  await test('physical retention cleanup removes terminal data and preserves pending leases', async () => {
    await denied(() => db.query('select prune_ai_insight_jobs(101)'), '22023')
    assert.equal(
      (await db.query('select prune_ai_insight_jobs(1) as n')).rows[0].n,
      1
    )
  })
  await role('postgres')
  await test('retention cleanup preserves pending job records', async () => {
    assert.equal(
      (
        await db.query(
          "select count(*) as n from private.ai_jobs where status='pending'"
        )
      ).rows[0].n,
      1
    )
    assert.equal(
      (
        await db.query(
          "select count(*) as n from private.ai_jobs where status='running'"
        )
      ).rows[0].n,
      1
    )
    assert.equal(
      (
        await db.query(
          'select count(*) as n from private.ai_jobs where id=$1',
          [first.id]
        )
      ).rows[0].n,
      0
    )
  })
  await role('postgres')
  await db.exec(
    "update private.ai_jobs set status='dead',token=null,lease_until=null where status in ('pending','running');update private.ai_system_config set queue_limit=1000"
  )
  await test('rollback removes AI additions and preserves analytics/legacy data', async () => {
    await db.exec(
      await readFile(
        new URL(
          '../supabase/rollback/202610130002_content_quality.sql',
          import.meta.url
        ),
        'utf8'
      )
    )
    await db.exec(
      await readFile(
        new URL(
          '../supabase/rollback/202610130001_ai_insights.sql',
          import.meta.url
        ),
        'utf8'
      )
    )
    assert.equal(
      (await db.query('select count(*) as n from monitored_items')).rows[0].n,
      4
    )
    assert.notEqual(
      (
        await db.query(
          "select to_regprocedure('get_content_analytics(timestamptz,timestamptz,text,text,integer)') as fn"
        )
      ).rows[0].fn,
      null
    )
    assert.equal(
      (await db.query("select to_regclass('private.ai_jobs') as jobs")).rows[0]
        .jobs,
      null
    )
  })
  console.log(
    `AI database integration: ${checks} checks passed. Synthetic contract; production and multi-connection concurrency unverified.`
  )
} catch (error) {
  console.error(
    'AI database integration failed:',
    error.message,
    error.code || '',
    error.position || ''
  )
  process.exitCode = 1
} finally {
  await db.close()
}
