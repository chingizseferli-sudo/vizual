-- Plan limits for existing monitors and fixed social check intervals.
--
-- 1. Customers created monitors before limits were enforced in SQL, so some
--    have more active monitors than their plan allows. The newest excess
--    monitors are set to inactive with inactive_reason = 'plan_limit' (never
--    deleted). A customer cannot reactivate one past the limit; an admin can.
-- 2. Social search intervals are limited to 1, 2, 3, 6 or 12 hours for the
--    admin default, each plan and the per-customer override.
-- 3. current_user_social_access() tells a customer their real interval.
-- Idempotent.

-- 1. Monitors over the plan limit ---------------------------------------------

alter table public.user_monitors
  add column if not exists inactive_reason text;

with plan_limit as (
  select
    profile.user_id,
    case when own_plan.id is null then free_plan.max_watches else own_plan.max_watches end as max_watches
  from public.user_profiles profile
  left join public.subscription_plans own_plan on own_plan.id = profile.plan_id
  left join public.subscription_plans free_plan on free_plan.code = 'free'
  where not exists (
    select 1 from public.admin_users admin
    where admin.user_id = profile.user_id and admin.status = 'active'
  )
),
ranked as (
  select
    monitor.id,
    row_number() over (partition by monitor.user_id order by monitor.created_at, monitor.id) as position,
    plan_limit.max_watches
  from public.user_monitors monitor
  join plan_limit on plan_limit.user_id = monitor.user_id
  where monitor.status = 'active'
    and plan_limit.max_watches is not null -- null = unlimited plan
)
update public.user_monitors monitor
set status = 'inactive', inactive_reason = 'plan_limit'
from ranked
where ranked.id = monitor.id
  and ranked.position > ranked.max_watches;

create or replace function public.guard_user_monitor_customer_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_limit integer;
  v_active_count integer;
begin
  if new.status = 'active' then
    new.inactive_reason := null;
  end if;

  if current_user not in ('anon', 'authenticated') or public.is_admin_user() then
    return new;
  end if;

  -- inactive_reason is set by the system and admins only.
  if tg_op = 'INSERT' then
    new.inactive_reason := null;
  elsif new.status <> 'active' then
    new.inactive_reason := old.inactive_reason;
  end if;

  if new.telegram_chat_id is not null
     and (tg_op = 'INSERT' or new.telegram_chat_id is distinct from old.telegram_chat_id) then
    raise exception 'TELEGRAM_CHAT_LINK_REQUIRED' using errcode = '42501';
  end if;

  if new.status = 'active' and (tg_op = 'INSERT' or old.status is distinct from 'active') then
    select limits.max_watches into v_limit from public.current_user_plan_limits() limits;

    if v_limit is not null then
      select count(*) into v_active_count
      from public.user_monitors monitor
      where monitor.user_id = new.user_id
        and monitor.status = 'active'
        and monitor.id <> new.id;

      if v_active_count >= v_limit then
        raise exception using errcode = 'P0001', message = 'PLAN_WATCH_LIMIT_REACHED';
      end if;
    end if;
  end if;

  return new;
end;
$$;

-- 2. Social intervals: 1, 2, 3, 6 or 12 hours ----------------------------------

update public.social_settings
set default_interval_minutes = case when default_interval_minutes < 60 then 60 else 360 end
where default_interval_minutes not in (60, 120, 180, 360, 720);

alter table public.social_settings
  drop constraint if exists social_settings_default_interval_minutes_check,
  drop constraint if exists social_settings_default_interval_allowed,
  add constraint social_settings_default_interval_allowed
    check (default_interval_minutes in (60, 120, 180, 360, 720));

update public.user_profiles
set social_interval_minutes = 60
where social_interval_minutes is not null
  and social_interval_minutes not in (60, 120, 180, 360, 720);

alter table public.user_profiles
  drop constraint if exists user_profiles_social_interval_check,
  add constraint user_profiles_social_interval_check
    check (social_interval_minutes is null or social_interval_minutes in (60, 120, 180, 360, 720));

update public.subscription_plans
set limits = limits - 'social_interval_minutes'
where limits ? 'social_interval_minutes'
  and (limits ->> 'social_interval_minutes') not in ('60', '120', '180', '360', '720');

alter table public.subscription_plans
  drop constraint if exists subscription_plans_social_interval_check,
  add constraint subscription_plans_social_interval_check
    check (
      not (coalesce(limits, '{}'::jsonb) ? 'social_interval_minutes')
      or (limits ->> 'social_interval_minutes') in ('60', '120', '180', '360', '720')
    );

-- 3. The caller's effective social interval ------------------------------------
-- Customers cannot read social_settings, so this returns only what applies to
-- them: override, else plan, else the admin default, and which platforms run.

create or replace function public.current_user_social_access()
returns table (interval_minutes integer, facebook_enabled boolean, instagram_enabled boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(
      profile.social_interval_minutes,
      case when (own_plan.limits ->> 'social_interval_minutes') ~ '^\d+$'
        then (own_plan.limits ->> 'social_interval_minutes')::integer end,
      settings.default_interval_minutes
    ),
    settings.facebook_enabled,
    settings.instagram_enabled
  from public.social_settings settings
  left join public.user_profiles profile on profile.user_id = (select auth.uid())
  left join public.subscription_plans own_plan on own_plan.id = profile.plan_id
  where settings.id = 1;
$$;

revoke all on function public.current_user_social_access() from public, anon;
grant execute on function public.current_user_social_access() to authenticated;
