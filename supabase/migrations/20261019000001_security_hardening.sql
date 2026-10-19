-- Security hardening (RLS, function privileges, profile escalation, indexes).
--
-- STATUS: NOT APPLIED. Apply to STAGING first, run the verification queries in
-- docs/SECURITY.md, then promote to production. Do not run with
-- `supabase db push` against production before staging sign-off.
--
-- Idempotent: every policy is dropped-if-exists before it is created, every
-- function change is guarded by to_regprocedure/to_regclass, and indexes use
-- IF NOT EXISTS. Production core tables were created in the dashboard, so table
-- presence is checked before touching optional objects.
--
-- Prerequisites (checked at runtime, see the DO blocks):
--   * public.admin_users exists (migration 202606290003). If it does not, the
--     canonical is_admin_user() is NOT replaced and a WARNING is raised.
--
-- Writers that bypass RLS (service_role: Railway/Telegram workers, edge
-- functions) are unaffected. Any external worker that still writes with the
-- ANON key (news, sent_news, discovery_logs, rejected_sources) WILL BREAK and
-- must be switched to service_role before this ships.

begin;

-- ---------------------------------------------------------------------------
-- 1. Canonical admin check: admin_users only, empty search_path.
--    202607070001 re-defined is_admin_user() on user_profiles.role, which
--    re-coupled admin access to a customer-writable table.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.admin_users') is not null then
    execute $fn$
      create or replace function public.is_admin_user()
      returns boolean
      language sql
      stable
      security definer
      set search_path = ''
      as $body$
        select exists (
          select 1
          from public.admin_users admin_user
          where admin_user.user_id = (select auth.uid())
            and admin_user.status = 'active'
            and admin_user.role in ('admin', 'superadmin')
        );
      $body$
    $fn$;

    execute $fn$
      create or replace function public.is_superadmin_user()
      returns boolean
      language sql
      stable
      security definer
      set search_path = ''
      as $body$
        select exists (
          select 1
          from public.admin_users admin_user
          where admin_user.user_id = (select auth.uid())
            and admin_user.status = 'active'
            and admin_user.role = 'superadmin'
        );
      $body$
    $fn$;

    -- anon must keep EXECUTE: policies declared `to public` call it.
    grant execute on function public.is_admin_user() to anon, authenticated;
    revoke all on function public.is_superadmin_user() from public, anon;
    grant execute on function public.is_superadmin_user() to authenticated;

    -- Any active admin could previously create superadmins. Writes to
    -- admin_users are now superadmin-only; admins can still read the list.
    drop policy if exists admin_users_admin_manage on public.admin_users;
    drop policy if exists admin_users_admin_select on public.admin_users;
    drop policy if exists admin_users_superadmin_manage on public.admin_users;

    create policy admin_users_admin_select
      on public.admin_users
      for select
      to authenticated
      using (public.is_admin_user());

    create policy admin_users_superadmin_manage
      on public.admin_users
      for all
      to authenticated
      using (public.is_superadmin_user())
      with check (public.is_superadmin_user());

    revoke all on public.admin_users from anon;
  else
    raise warning 'public.admin_users is missing: is_admin_user() NOT replaced. Apply 202606290003_admin_users_separate_auth first.';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. user_profiles: block self-escalation on INSERT as well as UPDATE.
--    Old trigger only fired on UPDATE, so a user without a profile row could
--    INSERT one with role='admin' (an admin under the profile-based
--    is_admin_user()) or with a paid plan_id.
-- ---------------------------------------------------------------------------
create or replace function public.prevent_profile_sensitive_self_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Only end-user API roles are restricted. service_role, postgres and
  -- dashboard sessions are trusted.
  if current_user not in ('anon', 'authenticated') or public.is_admin_user() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.role is not null and new.role <> 'customer' then
      raise exception 'PROFILE_SENSITIVE_FIELDS_ADMIN_ONLY' using errcode = '42501';
    end if;
    -- Self-created profiles always start on the free plan.
    new.plan_id := (
      select plan.id from public.subscription_plans plan where plan.code = 'free' limit 1
    );
    return new;
  end if;

  if new.role is distinct from old.role
     or new.status is distinct from old.status
     or new.plan_id is distinct from old.plan_id
     or new.user_id is distinct from old.user_id then
    raise exception 'PROFILE_SENSITIVE_FIELDS_ADMIN_ONLY' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_profile_sensitive_self_update_trigger on public.user_profiles;
create trigger prevent_profile_sensitive_self_update_trigger
  before insert or update on public.user_profiles
  for each row
  execute function public.prevent_profile_sensitive_self_update();

-- ---------------------------------------------------------------------------
-- 3. news: remove anonymous write access. In-repo writers are the admin UI
--    (authenticated admin session) only; see docs/SECURITY.md.
-- ---------------------------------------------------------------------------
do $$
declare
  pol record;
begin
  if to_regclass('public.news') is null then
    raise warning 'public.news is missing: skipped.';
    return;
  end if;

  execute 'alter table public.news enable row level security';
  execute 'drop policy if exists "Allow public insert news" on public.news';
  execute 'drop policy if exists "Allow public update news" on public.news';
  execute 'drop policy if exists "Allow public delete news" on public.news';

  -- Sweep any other write policy that reaches anon/public.
  for pol in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'news'
      and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
      and (roles @> array['anon']::name[] or roles @> array['public']::name[])
  loop
    execute format('drop policy if exists %I on public.news', pol.policyname);
  end loop;

  execute 'drop policy if exists news_admin_manage on public.news';
  execute $p$
    create policy news_admin_manage
      on public.news
      for all
      to authenticated
      using (public.is_admin_user())
      with check (public.is_admin_user())
  $p$;

  execute 'revoke insert, update, delete, truncate on public.news from anon';
  execute 'grant select, insert, update, delete on public.news to authenticated';
end
$$;

-- ---------------------------------------------------------------------------
-- 4. change_alerts: drop the USING (true) read policy (cross-tenant leak of
--    alerts incl. telegram_chat_id) and restate the owner/admin policies.
-- ---------------------------------------------------------------------------
alter table public.change_alerts enable row level security;

drop policy if exists "Allow authenticated read change alerts" on public.change_alerts;
drop policy if exists change_alerts_admin_manage on public.change_alerts;
drop policy if exists change_alerts_customer_select on public.change_alerts;

create policy change_alerts_admin_manage
  on public.change_alerts
  for all
  to authenticated
  using (public.is_admin_user())
  with check (public.is_admin_user());

create policy change_alerts_customer_select
  on public.change_alerts
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.change_sources source
      where source.id = change_alerts.source_id
        and source.user_id = (select auth.uid())
    )
  );

revoke all on public.change_alerts from anon;
revoke insert, update, delete, truncate on public.change_alerts from authenticated;
grant select on public.change_alerts to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Operational tables read only by the admin panel: no anon access.
--    Workers write them with service_role (bypasses RLS).
-- ---------------------------------------------------------------------------
do $$
declare
  tbl text;
  pol record;
begin
  foreach tbl in array array['discovery_logs', 'rejected_sources', 'sent_news', 'notification_logs']
  loop
    if to_regclass(format('public.%I', tbl)) is null then
      raise warning 'public.% is missing: skipped.', tbl;
      continue;
    end if;

    execute format('alter table public.%I enable row level security', tbl);

    for pol in
      select policyname
      from pg_policies
      where schemaname = 'public'
        and tablename = tbl
        and (roles @> array['anon']::name[] or roles @> array['public']::name[])
    loop
      execute format('drop policy if exists %I on public.%I', pol.policyname, tbl);
    end loop;

    execute format('drop policy if exists %I on public.%I', tbl || '_admin_manage', tbl);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_admin_user()) with check (public.is_admin_user())',
      tbl || '_admin_manage',
      tbl
    );

    execute format('revoke all on public.%I from anon', tbl);
    -- Admin UI reads all four and deletes notification_logs only.
    execute format('revoke insert, update, truncate on public.%I from authenticated', tbl);
    execute format('grant select, delete on public.%I to authenticated', tbl);
  end loop;
end
$$;

-- Archive table created with CREATE TABLE AS (no RLS) by 202606190002.
do $$
begin
  if to_regclass('public.source_cleanup_archive') is not null then
    execute 'alter table public.source_cleanup_archive enable row level security';
    execute 'revoke all on public.source_cleanup_archive from anon, authenticated';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 6. change_sources: server-side floor for check interval (client clamps to 5
--    minutes, but direct API inserts could set 1 minute or less).
-- ---------------------------------------------------------------------------
create or replace function public.enforce_change_source_customer_limits()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user not in ('anon', 'authenticated') or public.is_admin_user() then
    return new;
  end if;

  if new.interval_minutes is not null and new.interval_minutes < 5 then
    new.interval_minutes := 5;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_change_source_customer_limits_trigger on public.change_sources;
create trigger enforce_change_source_customer_limits_trigger
  before insert or update on public.change_sources
  for each row
  execute function public.enforce_change_source_customer_limits();

-- ---------------------------------------------------------------------------
-- 7. Function privileges. PostgreSQL grants EXECUTE to PUBLIC by default, so
--    "grant ... to service_role" alone left these callable by anon.
--    cleanup_old_monitor_data(1) from 202606190001 let anon wipe monitor data.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.cleanup_old_monitor_data(integer)') is not null then
    revoke all on function public.cleanup_old_monitor_data(integer) from public, anon, authenticated;
    grant execute on function public.cleanup_old_monitor_data(integer) to service_role;
  end if;

  if to_regprocedure('public.increment_source_fail(uuid,text)') is not null then
    revoke all on function public.increment_source_fail(uuid, text) from public, anon, authenticated;
    grant execute on function public.increment_source_fail(uuid, text) to service_role;
  end if;

  if to_regprocedure('public.delete_user_change_source(uuid)') is not null then
    revoke all on function public.delete_user_change_source(uuid) from public, anon;
    grant execute on function public.delete_user_change_source(uuid) to authenticated;
  end if;

  if to_regprocedure('public.create_user_monitor_with_limit(text,text,boolean)') is not null then
    revoke all on function public.create_user_monitor_with_limit(text, text, boolean) from public, anon;
    grant execute on function public.create_user_monitor_with_limit(text, text, boolean) to authenticated;
  end if;

  if to_regprocedure('public.admin_assign_user_subscription(uuid,uuid,text,timestamptz,text)') is not null then
    revoke all on function public.admin_assign_user_subscription(uuid, uuid, text, timestamptz, text) from public, anon;
    grant execute on function public.admin_assign_user_subscription(uuid, uuid, text, timestamptz, text) to authenticated;
  end if;
end
$$;

-- Pin search_path on every SECURITY DEFINER function in public that lacks it
-- (covers functions created in the dashboard that are not in migrations).
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and not exists (
        select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg
        where cfg like 'search_path=%'
      )
  loop
    raise notice 'Pinning search_path on %', fn.signature;
    execute format('alter function %s set search_path = public, pg_temp', fn.signature);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 8. Indexes for RLS EXISTS sub-queries and the hottest customer filters.
--    Plain CREATE INDEX takes a SHARE lock; on large production tables run
--    these manually with CONCURRENTLY outside a transaction instead.
--    Check for equivalent dashboard-created indexes first (docs/SECURITY.md).
-- ---------------------------------------------------------------------------
create index if not exists user_monitors_user_id_idx
  on public.user_monitors (user_id);
create index if not exists monitor_keywords_monitor_id_idx
  on public.monitor_keywords (monitor_id);
create index if not exists monitor_matches_monitor_id_created_at_idx
  on public.monitor_matches (monitor_id, created_at desc);
create index if not exists monitor_matches_item_id_idx
  on public.monitor_matches (item_id);
create index if not exists monitor_alerts_match_id_idx
  on public.monitor_alerts (match_id);
create index if not exists change_events_source_id_created_at_idx
  on public.change_events (source_id, created_at desc);
create index if not exists change_snapshots_source_id_idx
  on public.change_snapshots (source_id);
create index if not exists change_alerts_source_id_created_at_idx
  on public.change_alerts (source_id, created_at desc);

commit;
