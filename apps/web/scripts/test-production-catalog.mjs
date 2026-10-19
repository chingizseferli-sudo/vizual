import { PGlite } from '@electric-sql/pglite'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const db = new PGlite()
try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table public.catalog_probe(id integer primary key, private_value text default 'sentinel_never_exported');
    insert into public.catalog_probe values(1,'personal_row_never_exported');
    alter table public.catalog_probe enable row level security;
    create policy probe_owner on public.catalog_probe to authenticated using (private_value='policy_literal_never_exported');
    grant select(id) on public.catalog_probe to authenticated;
    create function public.probe_definer() returns void language plpgsql security definer set search_path=public set test.secret='config_never_exported'
      as $$begin raise exception 'function_body_never_exported'; end$$;
    create view public.catalog_probe_view as select 'view_literal_never_exported'::text as example;
    create schema auth; create schema storage;
    create table auth.catalog_auth_probe(id integer, private_value text default 'auth_default_never_exported');
    insert into auth.catalog_auth_probe values(1,'auth_row_never_exported');
    create table storage.catalog_storage_probe(id integer, private_value text default 'storage_default_never_exported');
    insert into storage.catalog_storage_probe values(1,'storage_row_never_exported');
  `)
  const sql = await readFile(
    new URL('./production-catalog.sql', import.meta.url),
    'utf8'
  )
  const result = await db.exec(sql)
  const catalog = result.find((r) => r.rows?.[0]?.production_catalog)?.rows[0]
    .production_catalog
  assert.ok(catalog)
  const output = JSON.stringify(catalog)
  for (const sentinel of [
    'sentinel_never_exported',
    'personal_row_never_exported',
    'policy_literal_never_exported',
    'function_body_never_exported',
    'config_never_exported',
    'view_literal_never_exported',
    'auth_default_never_exported',
    'auth_row_never_exported',
    'storage_default_never_exported',
    'storage_row_never_exported',
  ])
    assert.equal(output.includes(sentinel), false)
  assert.ok(catalog.relations.find((r) => r.name === 'catalog_probe').rls)
  assert.ok(
    catalog.functions
      .find((f) => f.name === 'probe_definer')
      .execute_acl.some((a) => a.grantee === 'PUBLIC')
  )
  assert.ok(
    catalog.column_acl.some(
      (a) => a.column === 'id' && a.grantee === 'authenticated'
    )
  )
  assert.equal(catalog.ledger_present.supabase, false)
  for (const [schema, name] of [
    ['auth', 'catalog_auth_probe'],
    ['storage', 'catalog_storage_probe'],
  ]) {
    assert.ok(
      catalog.relations.some((r) => r.schema === schema && r.name === name)
    )
    assert.equal(
      (await db.query(`select count(*)::integer as n from ${schema}.${name}`))
        .rows[0].n,
      1
    )
  }
  assert.equal(
    (await db.query('select count(*)::integer as n from public.catalog_probe'))
      .rows[0].n,
    1
  )
  await db.exec('begin read only')
  await assert.rejects(
    () => db.exec('delete from public.catalog_probe'),
    (e) => e.code === '25006'
  )
  await db.exec('rollback')
  process.stdout.write(
    'PASS: metadata collector executes in PostgreSQL, preserves rows, exposes ACL/RLS metadata, omits sensitive literals and enforces READ ONLY. Synthetic isolated fixture only.\n'
  )
} finally {
  await db.close()
}
