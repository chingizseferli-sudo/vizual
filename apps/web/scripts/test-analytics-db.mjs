// Disposable actual PostgreSQL execution. This fixture is a synthetic minimum
// contract, NOT a reconstruction of the deployed Supabase schema or policies.
import { PGlite } from '@electric-sql/pglite'
import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'

if (process.argv.includes('--with-worker')) {
  try {
    await access(
      new URL(
        '../../tehsilbot/src/application/analytics-service.js',
        import.meta.url
      )
    )
  } catch {
    throw new Error(
      'Optional RSS analytics source tehsilbot is absent. vizual-bg-worker is the Python page-change service, not a replacement. Run pnpm test:analytics:db for the standalone SQL suite.'
    )
  }
}

const db = new PGlite()
let checks = 0
const users = {
  a: '00000000-0000-4000-8000-000000000001',
  b: '00000000-0000-4000-8000-000000000002',
  blocked: '00000000-0000-4000-8000-000000000003',
  absent: '00000000-0000-4000-8000-000000000004',
}
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
async function analytics(options = {}) {
  const { rows } = await db.query(
    `select public.get_content_analytics(now()-interval '2 days',now(),$1,$2,$3) as data`,
    [options.monitor ?? null, options.source ?? null, options.limit ?? 500]
  )
  return rows[0].data
}
async function denied(operation, code = '42501') {
  await assert.rejects(operation, (error) => error.code === code)
}

try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
    $$;
    grant usage on schema auth to anon,authenticated,service_role;
    grant execute on function auth.uid() to anon,authenticated,service_role;
    create table public.subscription_plans(id bigint primary key,history_days integer);
    create table public.user_profiles(user_id uuid primary key,status text,plan_id bigint);
    create table public.user_monitors(id bigint primary key,user_id uuid,name text);
    create table public.sources(id bigint primary key,name text,rss_url text);
    create table public.monitored_items(id bigint primary key,source_id bigint,title text,url text,
      published_at timestamptz,detected_at timestamptz);
    create table public.monitor_matches(id bigint generated always as identity primary key,
      item_id bigint,monitor_id bigint,matched_keyword text);
    insert into subscription_plans values(1,30),(2,1);
    insert into user_profiles values
      ('${users.a}','active',1),('${users.b}','active',1),('${users.blocked}','blocked',1);
    insert into user_monitors values
      (11,'${users.a}','BDU'),(12,'${users.b}','Other tenant'),
      (13,'${users.blocked}','Blocked'),(14,'${users.absent}','Missing profile'),
      (15,'${users.a}','Second monitor');
    insert into sources values(21,'Synthetic publisher A','https://publisher-a.invalid/rss'),
      (22,'Synthetic publisher B','https://publisher-b.invalid/rss');
    insert into monitored_items
      select n,case when n=2 then 22 else 21 end,'Synthetic article '||n,
        'https://publisher.invalid/article/'||n,now()-interval '1 hour',now()-interval '1 hour'
      from generate_series(1,5) n;
    insert into monitor_matches(item_id,monitor_id,matched_keyword) values
      (1,11,'BDU'),(2,12,'private B'),(3,11,'shared A'),(3,12,'shared B'),
      (1,15,'second alias'),(4,13,'blocked'),(5,14,'absent');
    alter table user_profiles enable row level security;
    alter table user_monitors enable row level security;
    alter table sources enable row level security;
    alter table monitored_items enable row level security;
    alter table monitor_matches enable row level security;
    create policy profile_owner on user_profiles for select to authenticated using(user_id=auth.uid());
    create policy monitor_owner on user_monitors for select to authenticated using(user_id=auth.uid());
    create policy matches_owner on monitor_matches for select to authenticated using(exists(
      select 1 from user_monitors m where m.id=monitor_matches.monitor_id and m.user_id=auth.uid()));
    create policy items_owner on monitored_items for select to authenticated using(exists(
      select 1 from monitor_matches x join user_monitors m on m.id=x.monitor_id
      where x.item_id=monitored_items.id and m.user_id=auth.uid()));
    -- Deliberately permissive UPDATE simulates legacy admin grants: the new
    -- metadata guard must still deny browser updates independently of that RLS.
    create policy legacy_update on monitored_items for update to authenticated using(true) with check(true);
    grant select on user_profiles,user_monitors,monitor_matches,monitored_items to authenticated;
    grant update on monitored_items to authenticated;
    grant select,insert,update,delete on all tables in schema public to service_role;
  `)
  const migration = await readFile(
    new URL(
      '../supabase/migrations/202610120001_content_analytics.sql',
      import.meta.url
    ),
    'utf8'
  )
  await test('disabled legacy RLS blocks migration without additive objects', async () => {
    await db.exec('alter table monitored_items disable row level security')
    await assert.rejects(
      () => db.exec(migration),
      /ANALYTICS_RLS_PREFLIGHT_FAILED/
    )
    await db.exec('rollback')
    assert.equal(
      (
        await db.query(
          "select count(*) as n from information_schema.columns where table_name='monitored_items' and column_name='content_metadata'"
        )
      ).rows[0].n,
      0
    )
    await db.exec('alter table monitored_items enable row level security')
  })
  await test('missing legacy contract column blocks migration atomically', async () => {
    await db.exec('alter table sources rename rss_url to fixture_missing_rss')
    await assert.rejects(
      () => db.exec(migration),
      /ANALYTICS_SCHEMA_PREFLIGHT_FAILED/
    )
    await db.exec('rollback')
    assert.equal(
      (
        await db.query(
          "select to_regclass('private.content_processing_jobs') as jobs"
        )
      ).rows[0].jobs,
      null
    )
    await db.exec('alter table sources rename fixture_missing_rss to rss_url')
  })
  await test('additive migration executes on bigint-ID synthetic contract', () =>
    db.exec(migration))
  await test('analytics grant contains authenticated only; private queue remains RLS enabled', async () => {
    const grants = (
      await db.query(
        "select has_function_privilege('anon','public.get_content_analytics(timestamptz,timestamptz,text,text,integer)','execute') as anon,has_function_privilege('authenticated','public.get_content_analytics(timestamptz,timestamptz,text,text,integer)','execute') as customer"
      )
    ).rows[0]
    assert.equal(grants.anon, false)
    assert.equal(grants.customer, true)
    assert.equal(
      (
        await db.query(
          "select relrowsecurity from pg_class where oid='private.content_processing_jobs'::regclass"
        )
      ).rows[0].relrowsecurity,
      true
    )
  })
  await role('authenticated', users.a)
  await test('tenant A receives unique publications and only owned aliases', async () => {
    const data = await analytics()
    assert.equal(data.owner_id, users.a)
    assert.deepEqual(data.items.map((i) => i.id).sort(), ['1', '3'])
    assert.equal(data.items.find((i) => i.id === '1').matches.length, 2)
    assert.equal(
      data.items.find((i) => i.id === '3').matches[0].keyword,
      'shared A'
    )
    assert.deepEqual(data.monitors.map((m) => m.id).sort(), ['11', '15'])
    assert.equal(data.truncated, false)
  })
  await test('sources remain RLS-private while authorized publisher projection works', async () => {
    await denied(() => db.query('select * from sources'))
    assert.equal(
      (await analytics()).items[0].publisher,
      'Synthetic publisher A'
    )
  })
  await test('existing item RLS hides unmatched tenant B publications', async () => {
    assert.deepEqual(
      (await db.query('select id from monitored_items order by id')).rows.map(
        (r) => r.id
      ),
      [1, 3]
    )
  })
  await test('other-tenant monitor filter is rejected', () =>
    denied(() => analytics({ monitor: '12' })))
  await test('owned monitor and source filters apply before aggregation', async () => {
    assert.equal((await analytics({ monitor: '15' })).items.length, 1)
    assert.equal((await analytics({ source: '22' })).items.length, 0)
  })
  await test('browser metadata update denied even with legacy whole-table grants', () =>
    denied(() =>
      db.query("update monitored_items set content_metadata='{}' where id=1")
    ))
  await test('browser insertion and private queue access denied', async () => {
    await denied(() => db.query('insert into monitored_items(id) values(9000)'))
    await denied(() =>
      db.query('select * from private.content_processing_jobs')
    )
  })
  await role('postgres')
  await db.exec(
    'grant insert on monitored_items to authenticated; create policy fixture_legacy_insert on monitored_items for insert to authenticated with check(true)'
  )
  await role('authenticated', users.a)
  await test('metadata INSERT guard protects permissive legacy insert while plain insert works', async () => {
    await denied(() =>
      db.query(
        "insert into monitored_items(id,content_metadata) values(9000,'{}')"
      )
    )
    await db.query('insert into monitored_items(id) values(9000)')
  })
  await role('postgres')
  await db.exec(
    'delete from monitored_items where id=9000; revoke insert on monitored_items from authenticated; drop policy fixture_legacy_insert on monitored_items'
  )
  await role('authenticated', users.b)
  await test('tenant B sees only B evidence and shared B alias', async () => {
    const data = await analytics()
    assert.equal(data.owner_id, users.b)
    assert.deepEqual(data.items.map((i) => i.id).sort(), ['2', '3'])
    assert.equal(
      data.items.find((i) => i.id === '3').matches[0].keyword,
      'shared B'
    )
  })
  await role('postgres')
  await db.exec(`alter table user_profiles add column role text default 'customer';
    update user_profiles set role='admin' where user_id='${users.a}'`)
  await role('authenticated', users.a)
  await test('administrator profile receives no global customer analytics bypass', async () => {
    assert.deepEqual((await analytics()).items.map((i) => i.id).sort(), [
      '1',
      '3',
    ])
    await denied(() => analytics({ monitor: '12' }))
  })
  for (const identity of ['blocked', 'absent']) {
    await role('authenticated', users[identity])
    await test(`${identity} profile rejected independently of legacy RLS`, () =>
      denied(() => analytics()))
  }
  await role('anon')
  await test('anonymous execution denied by grants', () =>
    denied(() => analytics()))
  await role('authenticated')
  await test('authenticated role without JWT identity denied', () =>
    denied(() => analytics()))
  await role('authenticated', users.a)
  await test('limit and oversized filters validated', async () => {
    await denied(() => analytics({ limit: 0 }), '22023')
    await denied(() => analytics({ limit: 501 }), '22023')
    await denied(() => analytics({ source: 'x'.repeat(201) }), '22023')
    await denied(
      () =>
        db.query(
          "select get_content_analytics(now()-interval '1 day',now(),null,null,null)"
        ),
      '22023'
    )
  })
  await test('invalid, future, null and oversized time windows denied', async () => {
    for (const window of [
      "now(),now()-interval '1 hour'",
      "now()-interval '32 days',now()",
      "now(),now()+interval '1 day'",
      'null,now()',
      "'-infinity'::timestamptz,now()",
    ])
      await denied(
        () => db.query(`select get_content_analytics(${window})`),
        '22023'
      )
  })
  await role('postgres')
  await test('metadata allowlist rejects unknown fields and unchecked relationship endpoints', async () => {
    await denied(
      () =>
        db.query(
          `update monitored_items set content_metadata='{"private_future_field":"excluded"}' where id=1`
        ),
      '23514'
    )
    await denied(
      () =>
        db.query(
          `update monitored_items set content_metadata='{"relationships":[{"target_item_id":"2"}]}' where id=1`
        ),
      '23514'
    )
  })
  await db.exec(
    `update monitored_items set content_metadata='{"version":1,"platform":"rss","metrics":[],"original_metadata":{"title":"Synthetic source title"},"relationships":[]}' where id=1`
  )
  await role('authenticated', users.a)
  await test('RPC projection excludes raw original metadata and reserved relationships', async () => {
    const metadata = (await analytics()).items.find(
      (i) => i.id === '1'
    ).metadata
    assert.equal(metadata.version, 1)
    assert.deepEqual(metadata.metrics, [])
    assert.equal('relationships' in metadata, false)
    assert.equal('original_metadata' in metadata, false)
    assert.equal('private_future_field' in metadata, false)
  })
  await role('postgres')
  await db.exec('update monitored_items set content_metadata=null where id=1')
  await db.exec(`update user_profiles set plan_id=2 where user_id='${users.a}'`)
  await role('authenticated', users.a)
  await test('server-side plan retention rejects older window', () =>
    denied(() => analytics(), '22023'))
  await role('postgres')
  await db.exec(`update user_profiles set plan_id=1 where user_id='${users.a}';
    insert into monitored_items select n,21,'Synthetic article '||n,
      'https://publisher.invalid/article/'||n,now()-interval '1 hour',now()-interval '1 hour'
      from generate_series(100,700) n;
    insert into monitor_matches(item_id,monitor_id,matched_keyword) select n,11,'BDU' from generate_series(100,700) n;`)
  await role('authenticated', users.a)
  await test('bounded 500 sample explicitly marks truncation', async () => {
    const data = await analytics()
    assert.equal(data.items.length, 500)
    assert.equal(data.truncated, true)
    assert.equal((await analytics({ limit: 1 })).items.length, 1)
  })
  await role('postgres')
  // Standalone frontend CI verifies SQL without requiring a sibling repository.
  // Workspace verification additionally runs the real worker SQL when requested.
  if (process.argv.includes('--with-worker')) {
    const { AnalyticsRepository } =
      await import('../../tehsilbot/src/infrastructure/postgres/analytics-repository.js')
    const { processAnalyticsBatch } =
      await import('../../tehsilbot/src/application/analytics-service.js')
    await role('service_role')
    const pool = {
      query: async (sql, params) => {
        const result = await db.query(sql, params)
        return {
          rows: result.rows,
          rowCount: result.affectedRows ?? result.rows.length,
        }
      },
      connect: async () => ({ query: pool.query, release() {} }),
    }
    const repository = new AnalyticsRepository(pool)
    await test('real worker SQL enqueues bounded idempotent jobs', async () => {
      assert.equal(await repository.enqueue(10), 10)
      assert.equal(await repository.enqueue(10), 10)
      assert.equal(
        (
          await db.query(
            'select count(distinct item_id) as n from private.content_processing_jobs'
          )
        ).rows[0].n,
        20
      )
    })
    await test('claim exclusion, stale token denial and atomic metadata persistence', async () => {
      const first = (await repository.claim(1))[0]
      const second = (await repository.claim(1))[0]
      assert.notEqual(first.id, second.id)
      assert.equal(
        await repository.finish({ ...first, token: users.b }, { version: 1 }),
        false
      )
      assert.equal(
        await repository.finish(first, { version: 1, platform: 'rss' }),
        true
      )
      assert.equal(await repository.finish(first, { version: 1 }), false)
      assert.equal(
        (
          await db.query(
            'select content_metadata from monitored_items where id::text=$1',
            [first.item_id]
          )
        ).rows[0].content_metadata.platform,
        'rss'
      )
      await repository.fail(second)
      const retried = (
        await db.query(
          'select * from private.content_processing_jobs where id=$1',
          [second.id]
        )
      ).rows[0]
      assert.equal(retried.status, 'pending')
      assert.equal(retried.token, null)
      assert.ok(new Date(retried.available_at) > new Date())
    })
    await test('expired lease fencing and terminal fifth-attempt recovery', async () => {
      const job = (await repository.claim(1))[0]
      await db.query(
        "update private.content_processing_jobs set lease_until=now()-interval '1 second' where id=$1",
        [job.id]
      )
      assert.equal(await repository.finish(job, { version: 1 }), false)
      const recovered = (await repository.claim(20)).find(
        (j) => j.id === job.id
      )
      assert.ok(recovered)
      assert.notEqual(recovered.token, job.token)
      await db.query(
        "update private.content_processing_jobs set attempts=5,lease_until=now()-interval '1 second' where id=$1",
        [job.id]
      )
      await repository.claim(1)
      assert.equal(
        (
          await db.query(
            'select status from private.content_processing_jobs where id=$1',
            [job.id]
          )
        ).rows[0].status,
        'dead'
      )
    })
    await test('real normalization service completes persisted items without external effects', async () => {
      const result = await processAnalyticsBatch(repository, { batch: 2 })
      assert.equal(result.claimed, 2)
      assert.equal(result.complete, 2)
      assert.equal(result.failed, 0)
    })
    await test('queue backpressure refuses further jobs at hard bound', async () => {
      await db.exec(`insert into private.content_processing_jobs(item_id)
      select 'backpressure-'||n from generate_series(1,10000-(select count(*)::integer from private.content_processing_jobs where status in ('pending','running'))) n`)
      assert.equal(await repository.enqueue(100), 0)
    })
  } else {
    console.log(
      'Worker integration not selected; run --with-worker from the full workspace to exercise the real worker repository.'
    )
  }
  await role('postgres')
  await test('metadata size and object validation enforced by PostgreSQL', async () => {
    await denied(
      () =>
        db.query("update monitored_items set content_metadata='[]' where id=1"),
      '23514'
    )
    await denied(
      () =>
        db.query(
          "update monitored_items set content_metadata=jsonb_build_object('payload',repeat('x',65536)) where id=1"
        ),
      '23514'
    )
  })
  await role('postgres')
  const before = (await db.query('select count(*) as n from monitored_items'))
    .rows[0].n
  const rollback = await readFile(
    new URL(
      '../supabase/rollback/202610120001_content_analytics.sql',
      import.meta.url
    ),
    'utf8'
  )
  await test('isolated rollback preserves legacy publications and matches', async () => {
    await db.exec(rollback)
    assert.equal(
      (await db.query('select count(*) as n from monitored_items')).rows[0].n,
      before
    )
    assert.ok(
      (await db.query('select count(*) as n from monitor_matches')).rows[0].n >
        600
    )
    assert.equal(
      (
        await db.query(
          "select to_regprocedure('public.get_content_analytics(timestamptz,timestamptz,text,text,integer)') as fn"
        )
      ).rows[0].fn,
      null
    )
    assert.equal(
      (
        await db.query(
          "select count(*) as n from information_schema.columns where table_name='monitored_items' and column_name='content_metadata'"
        )
      ).rows[0].n,
      0
    )
  })
  console.log(
    `Analytics database integration: ${checks} checks passed. Synthetic contract only; production schema and live RLS remain unverified.`
  )
} finally {
  await db.close()
}
