-- Server-side plan limits, Telegram/email profile guards, function privileges,
-- SVG-free asset bucket and a per-user rate limit for URL-fetching edge
-- functions. Idempotent: safe to run more than once.
--
-- Before this migration the per-plan limits lived only in the SPA: anyone with
-- a session could insert unlimited user_monitors / monitor_keywords /
-- change_sources through PostgREST (worker and Apify cost, see
-- docs/SECURITY.md #11 and #16).

begin;

-- ---------------------------------------------------------------------------
-- 1. Caller's own plan limits. SECURITY DEFINER so the triggers below see the
--    plan even when it is inactive or not readable by the caller. Returns only
--    the caller's own limits, so EXECUTE for authenticated leaks nothing.
--    max_keywords: plan.limits->>'max_keywords', else 20 per allowed watch,
--    else unlimited (custom/enterprise plans with null max_watches).
-- ---------------------------------------------------------------------------
create or replace function public.current_user_plan_limits()
returns table (max_watches integer, max_keywords integer)
language sql
stable
security definer
set search_path = ''
as $$
  with plan as (
    select coalesce(
      (
        select own_plan.id
        from public.user_profiles profile
        join public.subscription_plans own_plan on own_plan.id = profile.plan_id
        where profile.user_id = (select auth.uid())
        limit 1
      ),
      (
        select free_plan.id
        from public.subscription_plans free_plan
        where free_plan.code = 'free'
        limit 1
      )
    ) as id
  )
  select
    p.max_watches,
    coalesce(
      case when (p.limits ->> 'max_keywords') ~ '^\d+$' then (p.limits ->> 'max_keywords')::integer end,
      p.max_watches * 20
    )
  from plan
  join public.subscription_plans p on p.id = plan.id;
$$;

revoke all on function public.current_user_plan_limits() from public, anon;
grant execute on function public.current_user_plan_limits() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. user_monitors: customers create monitors only through
--    create_user_monitor_with_limit(); the direct INSERT policy bypassed it.
--    The RPC now serialises per user so parallel calls cannot overshoot.
--    Customers may clear but not point a monitor at an arbitrary Telegram chat
--    (the bot links chats only through one-time tokens).
-- ---------------------------------------------------------------------------
drop policy if exists "Allow authenticated users to insert monitors" on public.user_monitors;

create or replace function public.create_user_monitor_with_limit(
  p_name text,
  p_description text default null,
  p_notify_telegram boolean default true
)
returns setof public.user_monitors
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_limit integer;
  v_current_count integer;
  v_monitor public.user_monitors;
begin
  if v_user_id is null then
    raise exception using errcode = '28000', message = 'AUTH_REQUIRED';
  end if;

  if nullif(trim(p_name), '') is null then
    raise exception using errcode = '22023', message = 'MONITOR_NAME_REQUIRED';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('user_monitors:' || v_user_id::text));

  select limits.max_watches into v_limit from public.current_user_plan_limits() limits;

  select count(*) into v_current_count
  from public.user_monitors monitor
  where monitor.user_id = v_user_id;

  if v_limit is not null and v_current_count >= v_limit then
    raise exception using errcode = 'P0001', message = 'PLAN_WATCH_LIMIT_REACHED';
  end if;

  insert into public.user_monitors (user_id, name, description, status, notify_telegram)
  values (
    v_user_id,
    trim(p_name),
    nullif(trim(coalesce(p_description, '')), ''),
    'active',
    coalesce(p_notify_telegram, true)
  )
  returning * into v_monitor;

  return next v_monitor;
end;
$$;

revoke all on function public.create_user_monitor_with_limit(text, text, boolean) from public, anon;
grant execute on function public.create_user_monitor_with_limit(text, text, boolean) to authenticated;

create or replace function public.guard_user_monitor_customer_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user not in ('anon', 'authenticated') or public.is_admin_user() then
    return new;
  end if;

  if new.telegram_chat_id is not null
     and (tg_op = 'INSERT' or new.telegram_chat_id is distinct from old.telegram_chat_id) then
    raise exception 'TELEGRAM_CHAT_LINK_REQUIRED' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_user_monitor_customer_write_trigger on public.user_monitors;
create trigger guard_user_monitor_customer_write_trigger
  before insert or update on public.user_monitors
  for each row
  execute function public.guard_user_monitor_customer_write();

-- ---------------------------------------------------------------------------
-- 3. monitor_keywords: per-user keyword cap and sane keyword length. Every
--    unique keyword is a paid social search in apps/worker.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_monitor_keyword_customer_limits()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_limit integer;
  v_count integer;
begin
  if current_user not in ('anon', 'authenticated') or public.is_admin_user() then
    return new;
  end if;

  if char_length(trim(coalesce(new.keyword, ''))) not between 1 and 200 then
    raise exception 'KEYWORD_LENGTH_INVALID' using errcode = '22023';
  end if;

  if tg_op = 'UPDATE' then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('monitor_keywords:' || v_user_id::text));

  select limits.max_keywords into v_limit from public.current_user_plan_limits() limits;
  if v_limit is null then
    return new;
  end if;

  select count(*) into v_count
  from public.monitor_keywords keyword
  join public.user_monitors monitor on monitor.id = keyword.monitor_id
  where monitor.user_id = v_user_id;

  if v_count >= v_limit then
    raise exception 'PLAN_KEYWORD_LIMIT_REACHED' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_monitor_keyword_customer_limits_trigger on public.monitor_keywords;
create trigger enforce_monitor_keyword_customer_limits_trigger
  before insert or update on public.monitor_keywords
  for each row
  execute function public.enforce_monitor_keyword_customer_limits();

-- ---------------------------------------------------------------------------
-- 4. change_sources: watch-count limit (max_watches) on customer inserts, on
--    top of the existing interval floor.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_change_source_customer_limits()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_limit integer;
  v_count integer;
begin
  if current_user not in ('anon', 'authenticated') or public.is_admin_user() then
    return new;
  end if;

  if new.interval_minutes is not null and new.interval_minutes < 5 then
    new.interval_minutes := 5;
  end if;

  if tg_op = 'INSERT' then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('change_sources:' || new.user_id::text));

    select limits.max_watches into v_limit from public.current_user_plan_limits() limits;

    select count(*) into v_count
    from public.change_sources source
    where source.user_id = new.user_id;

    if v_limit is not null and v_count >= v_limit then
      raise exception 'PLAN_WATCH_LIMIT_REACHED' using errcode = 'P0001';
    end if;
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
-- 5. user_profiles: email and telegram_chat_id are no longer customer-writable.
--    A customer could set telegram_chat_id to someone else's chat (bypassing
--    the one-time link token) or spoof the email admins see. Clearing the chat
--    id (unlink) stays allowed.
-- ---------------------------------------------------------------------------
create or replace function public.prevent_profile_sensitive_self_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user not in ('anon', 'authenticated') or public.is_admin_user() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.role is not null and new.role <> 'customer' then
      raise exception 'PROFILE_SENSITIVE_FIELDS_ADMIN_ONLY' using errcode = '42501';
    end if;
    new.plan_id := (
      select plan.id from public.subscription_plans plan where plan.code = 'free' limit 1
    );
    new.telegram_chat_id := null;
    new.email := (select auth.jwt()) ->> 'email';
    return new;
  end if;

  if new.role is distinct from old.role
     or new.status is distinct from old.status
     or new.plan_id is distinct from old.plan_id
     or new.user_id is distinct from old.user_id
     or new.email is distinct from old.email
     or (new.telegram_chat_id is not null and new.telegram_chat_id is distinct from old.telegram_chat_id) then
    raise exception 'PROFILE_SENSITIVE_FIELDS_ADMIN_ONLY' using errcode = '42501';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. is_admin_user(): no longer executable by anon. The only anon policy that
--    called it (subscription_plans) is split per role first.
-- ---------------------------------------------------------------------------
drop policy if exists subscription_plans_read_active_or_admin on public.subscription_plans;
drop policy if exists subscription_plans_read_public on public.subscription_plans;
drop policy if exists subscription_plans_read_authenticated on public.subscription_plans;

create policy subscription_plans_read_public
  on public.subscription_plans
  for select
  to anon
  using (is_active = true and is_public = true);

create policy subscription_plans_read_authenticated
  on public.subscription_plans
  for select
  to authenticated
  using (is_active = true or public.is_admin_user());

revoke all on function public.is_admin_user() from public, anon;
grant execute on function public.is_admin_user() to authenticated, service_role;

-- Not SECURITY DEFINER, but pin search_path anyway (linter: mutable search_path).
do $$
begin
  if to_regprocedure('public.cleanup_source_domain(text)') is not null then
    execute 'alter function public.cleanup_source_domain(text) set search_path = ''''';
  end if;
end
$$;

-- Trigger-only SECURITY DEFINER function: never callable over the API.
revoke all on function public.set_default_user_profile_plan() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Public asset bucket: no SVG (script-capable, served from the storage
--    origin). Existing SVG objects must be replaced by hand.
-- ---------------------------------------------------------------------------
update storage.buckets
set allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp']
where id = 'public-site-assets';

-- ---------------------------------------------------------------------------
-- 8. Per-user fixed-window rate limit for edge functions that fetch
--    user-supplied URLs (selector-proxy, change-selector-test). Only the
--    service role (edge functions) calls it.
-- ---------------------------------------------------------------------------
create table if not exists public.edge_rate_limits (
  user_id uuid not null,
  bucket text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (user_id, bucket, window_start)
);

alter table public.edge_rate_limits enable row level security;
revoke all on public.edge_rate_limits from public, anon, authenticated;

create or replace function public.consume_edge_rate_limit(
  p_user_id uuid,
  p_bucket text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_window timestamptz;
  v_hits integer;
begin
  if p_user_id is null or p_limit < 1 or p_window_seconds < 1 then
    return false;
  end if;

  v_window := pg_catalog.to_timestamp(
    floor(extract(epoch from pg_catalog.now()) / p_window_seconds) * p_window_seconds
  );

  insert into public.edge_rate_limits as rate (user_id, bucket, window_start, hits)
  values (p_user_id, p_bucket, v_window, 1)
  on conflict (user_id, bucket, window_start)
  do update set hits = rate.hits + 1
  returning rate.hits into v_hits;

  if pg_catalog.random() < 0.01 then
    delete from public.edge_rate_limits old_rate
    where old_rate.window_start < pg_catalog.now() - interval '1 day';
  end if;

  return v_hits <= p_limit;
end;
$$;

revoke all on function public.consume_edge_rate_limit(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_edge_rate_limit(uuid, text, integer, integer) to service_role;

commit;
