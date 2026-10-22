-- Plan table agreed on 22 Oct 2026, and a per-plan limit on how many keywords
-- go to Facebook/Instagram search (that search is what costs money).
--
-- 1. Plans demo/free/pro/business get the agreed prices and limits.
--    Enterprise is left as it is.
-- 2. monitor_keywords.social_enabled: the customer picks which keywords are
--    searched on FB/IG. Changed only through set_keyword_social().
-- 3. Limit: user_profiles.social_keyword_limit (admin-only override), else
--    plan limits.max_social_keywords, else unlimited. 0 means no FB/IG.
--    Admins are unlimited. social_keyword_ids_for_worker() is what the social
--    collector searches: flagged, active keywords, oldest first, up to the limit
--    (so a downgrade or a resumed keyword never goes over it).
-- 4. Existing customers: their oldest active keywords are flagged up to the limit.
-- 5. Public pricing copy shows the new plans where it still has the old text.

-- 1. Plans -------------------------------------------------------------------
update public.subscription_plans
set limits = coalesce(limits, '{}'::jsonb) || '{
      "max_keywords": 5, "max_social_keywords": 3, "social_interval_minutes": 1440,
      "max_competitors": 0, "report_frequencies": []
    }'::jsonb,
    updated_at = now()
where code = 'demo';

update public.subscription_plans
set price_amount = 100, currency = 'AZN', billing_interval = 'month',
    limits = (coalesce(limits, '{}'::jsonb) - 'social_interval_minutes') || '{
      "max_keywords": 10, "max_social_keywords": 0,
      "max_competitors": 0, "report_frequencies": ["weekly"]
    }'::jsonb,
    updated_at = now()
where code = 'free';

update public.subscription_plans
set price_amount = 300, currency = 'AZN', billing_interval = 'month',
    limits = coalesce(limits, '{}'::jsonb) || '{
      "max_keywords": 30, "max_social_keywords": 10, "social_interval_minutes": 1440,
      "max_competitors": 3, "report_frequencies": ["daily", "weekly"]
    }'::jsonb,
    updated_at = now()
where code = 'pro';

update public.subscription_plans
set price_amount = 599, currency = 'AZN', billing_interval = 'month',
    limits = coalesce(limits, '{}'::jsonb) || '{
      "max_keywords": 100, "max_social_keywords": 30, "social_interval_minutes": 720,
      "max_competitors": 5, "report_frequencies": ["daily", "weekly", "monthly"]
    }'::jsonb,
    updated_at = now()
where code = 'business';

-- Names and descriptions only where they are still the English seed text.
update public.subscription_plans
set name = 'Başlanğıc', updated_at = now()
where code = 'free' and name = 'Free';
update public.subscription_plans
set description = 'Kiçik komandalar üçün: 10 açar söz, xəbər saytları, Telegram bildirişləri, həftəlik hesabat.', updated_at = now()
where code = 'free' and (description is null or description = 'Starter plan for trying Visual Monitor.');

update public.subscription_plans
set description = 'PR və kommunikasiya komandaları üçün: 30 açar söz, Facebook və Instagram, 3 rəqib, gündəlik hesabat.', updated_at = now()
where code = 'pro' and (description is null or description = 'Professional plan for regular monitoring.');

update public.subscription_plans
set name = 'Biznes', updated_at = now()
where code = 'business' and name = 'Business';
update public.subscription_plans
set description = 'Razılaşma ilə, 599 AZN-dən. 100 açar söz, Facebook və Instagram gündə 2 dəfə, 5 rəqib, bütün hesabatlar.', updated_at = now()
where code = 'business' and (description is null or description = 'Business plan for larger monitoring teams.');

-- 2. Columns -----------------------------------------------------------------
alter table public.monitor_keywords
  add column if not exists social_enabled boolean not null default false;

alter table public.user_profiles
  add column if not exists social_keyword_limit integer;
alter table public.user_profiles
  drop constraint if exists user_profiles_social_keyword_limit_check;
alter table public.user_profiles
  add constraint user_profiles_social_keyword_limit_check
  check (social_keyword_limit is null or social_keyword_limit between 0 and 1000);

alter table public.subscription_plans
  drop constraint if exists subscription_plans_max_social_keywords_check;
alter table public.subscription_plans
  add constraint subscription_plans_max_social_keywords_check
  check (
    not (coalesce(limits, '{}'::jsonb) ? 'max_social_keywords')
    or (limits ->> 'max_social_keywords') ~ '^\d+$'
  );

-- Same as 20261020000007, plus social_keyword_limit (admin-only).
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
    new.status := 'pending';
    new.signup_notified_at := null;
    new.telegram_chat_id := null;
    new.social_interval_minutes := null;
    new.social_keyword_limit := null;
    new.email := (select auth.jwt()) ->> 'email';
    return new;
  end if;

  if new.role is distinct from old.role
     or new.status is distinct from old.status
     or new.plan_id is distinct from old.plan_id
     or new.user_id is distinct from old.user_id
     or new.email is distinct from old.email
     or new.social_interval_minutes is distinct from old.social_interval_minutes
     or new.social_keyword_limit is distinct from old.social_keyword_limit
     or new.signup_notified_at is distinct from old.signup_notified_at
     or (new.telegram_chat_id is not null and new.telegram_chat_id is distinct from old.telegram_chat_id) then
    raise exception 'PROFILE_SENSITIVE_FIELDS_ADMIN_ONLY' using errcode = '42501';
  end if;

  return new;
end;
$$;

-- 3. Limit -------------------------------------------------------------------
create or replace function public.social_keyword_limit_for_user(p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (
      select 1 from public.admin_users admin
      where admin.user_id = p_user_id and admin.status = 'active'
    ) then null
    else (
      select coalesce(
        profile.social_keyword_limit,
        case when (p.limits ->> 'max_social_keywords') ~ '^\d+$'
          then (p.limits ->> 'max_social_keywords')::integer end
      )
      from public.subscription_plans p
      left join public.user_profiles profile on profile.user_id = p_user_id
      where p.id = coalesce(
        profile.plan_id,
        (select free_plan.id from public.subscription_plans free_plan where free_plan.code = 'free' limit 1)
      )
    )
  end;
$$;

revoke all on function public.social_keyword_limit_for_user(uuid) from public, anon, authenticated;

-- The return type gains a column, so the function is recreated.
drop function if exists public.current_user_plan_limits();
create function public.current_user_plan_limits()
returns table (max_watches integer, max_keywords integer, max_social_keywords integer)
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
    ),
    public.social_keyword_limit_for_user((select auth.uid()))
  from plan
  join public.subscription_plans p on p.id = plan.id;
$$;

revoke all on function public.current_user_plan_limits() from public, anon;
grant execute on function public.current_user_plan_limits() to authenticated;

create or replace function public.set_keyword_social(p_keyword_id uuid, p_enabled boolean)
returns public.monitor_keywords
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_limit integer;
  v_used integer;
  v_row public.monitor_keywords;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('monitor_keywords:' || v_user_id::text));

  select keyword.* into v_row
  from public.monitor_keywords keyword
  join public.user_monitors monitor on monitor.id = keyword.monitor_id
  where keyword.id = p_keyword_id
    and monitor.user_id = v_user_id
    and monitor.status <> 'archived';

  if v_row.id is null then
    raise exception 'KEYWORD_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_row.social_enabled = coalesce(p_enabled, false) then
    return v_row;
  end if;

  if p_enabled then
    if not public.is_admin_user()
       and (select state.status from public.current_user_account_state() state) is distinct from 'active' then
      raise exception 'ACCOUNT_NOT_ACTIVE' using errcode = '42501';
    end if;

    v_limit := public.social_keyword_limit_for_user(v_user_id);
    if v_limit = 0 then
      raise exception 'PLAN_SOCIAL_NOT_INCLUDED' using errcode = 'P0001';
    end if;

    select count(*) into v_used
    from public.monitor_keywords keyword
    join public.user_monitors monitor on monitor.id = keyword.monitor_id
    where monitor.user_id = v_user_id
      and monitor.status <> 'archived'
      and keyword.social_enabled
      and coalesce(keyword.status, 'active') = 'active';

    if v_limit is not null and v_used >= v_limit then
      raise exception 'PLAN_SOCIAL_KEYWORD_LIMIT_REACHED' using errcode = 'P0001';
    end if;
  end if;

  update public.monitor_keywords
  set social_enabled = coalesce(p_enabled, false)
  where id = v_row.id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.set_keyword_social(uuid, boolean) from public, anon;
grant execute on function public.set_keyword_social(uuid, boolean) to authenticated;

-- Keywords the social collector may search: flagged and active, of active
-- monitors, oldest first up to each owner's limit. Account status is checked
-- by the worker (inactive owners are already dropped from its keyword cache).
create or replace function public.social_keyword_ids_for_worker()
returns table (keyword_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  with owners as (
    select distinct monitor.user_id
    from public.monitor_keywords keyword
    join public.user_monitors monitor on monitor.id = keyword.monitor_id
    where keyword.social_enabled
  ),
  limits as (
    select owners.user_id, public.social_keyword_limit_for_user(owners.user_id) as max_social
    from owners
  ),
  ranked as (
    select
      keyword.id,
      limits.max_social,
      row_number() over (
        partition by monitor.user_id
        order by keyword.created_at, keyword.id
      ) as position
    from public.monitor_keywords keyword
    join public.user_monitors monitor on monitor.id = keyword.monitor_id
    join limits on limits.user_id = monitor.user_id
    where keyword.social_enabled
      and coalesce(keyword.status, 'active') = 'active'
      and monitor.status = 'active'
  )
  select ranked.id
  from ranked
  where ranked.max_social is null or ranked.position <= ranked.max_social;
$$;

revoke all on function public.social_keyword_ids_for_worker() from public, anon, authenticated;
grant execute on function public.social_keyword_ids_for_worker() to service_role;

-- 4. Existing customers: flag their oldest active keywords up to the limit ----
-- Runs once: only for owners who have no flagged keyword yet.
with candidates as (
  select
    keyword.id,
    public.social_keyword_limit_for_user(monitor.user_id) as max_social,
    row_number() over (
      partition by monitor.user_id
      order by keyword.created_at, keyword.id
    ) as position
  from public.monitor_keywords keyword
  join public.user_monitors monitor on monitor.id = keyword.monitor_id
  where monitor.status = 'active'
    and coalesce(keyword.status, 'active') = 'active'
    and not exists (
      select 1
      from public.monitor_keywords flagged
      join public.user_monitors flagged_monitor on flagged_monitor.id = flagged.monitor_id
      where flagged_monitor.user_id = monitor.user_id
        and flagged.social_enabled
    )
)
update public.monitor_keywords keyword
set social_enabled = true
from candidates
where candidates.id = keyword.id
  and (candidates.max_social is null or candidates.position <= candidates.max_social);

-- 5. Public pricing copy -------------------------------------------------------
-- Replaced only while the plans still carry the old "Sorğu əsasında" prices.
update public.public_site_sections
set content = jsonb_set(
      jsonb_set(content, '{description}', '"Qiymətlərə ƏDV daxildir. Telegram bildirişləri bütün planlarda xəbər tapılan kimi göndərilir."'),
      '{plans}',
      $$[
        {
          "name": "Demo",
          "price": "Pulsuz, 7 gün",
          "description": "Məhsulu tanımaq və ilk nəticələri görmək üçün.",
          "features": ["5 açar söz", "Bütün xəbər saytları", "Telegram bildirişləri", "Facebook və Instagram: 3 söz, gündə 1 dəfə"]
        },
        {
          "name": "Başlanğıc",
          "price": "100 AZN / ay",
          "description": "Kiçik komandalar və ilkin media monitorinqi üçün.",
          "features": ["10 açar söz", "Bütün xəbər saytları", "Telegram bildirişləri", "Həftəlik email hesabatı"]
        },
        {
          "name": "Pro",
          "price": "300 AZN / ay",
          "description": "Aktiv PR və kommunikasiya komandaları üçün.",
          "features": ["30 açar söz", "Facebook və Instagram: 10 söz, gündə 1 dəfə", "3 rəqib üzrə AI analizi", "Gündəlik və həftəlik email hesabatı"]
        },
        {
          "name": "Biznes",
          "price": "599 AZN-dən / ay",
          "description": "Böyük təşkilatlar üçün, şərtlər razılaşma ilə.",
          "features": ["100 açar söz", "Facebook və Instagram: 30 söz, gündə 2 dəfə", "5 rəqib üzrə AI analizi", "Gündəlik, həftəlik və aylıq hesabat"]
        }
      ]$$::jsonb
    ),
    updated_at = now()
where section_key = 'pricing'
  and content #>> '{plans,1,price}' = 'Sorğu əsasında'
  and content #>> '{plans,2,price}' = 'Sorğu əsasında';
