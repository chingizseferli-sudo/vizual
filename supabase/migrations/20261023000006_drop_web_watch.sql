-- Web page watching is removed (UI, page_change worker and its data).
-- Drops the change_* tables, their functions, and subscription_plans.max_watches.
-- The keyword limit no longer falls back to 20 x max_watches: plan
-- limits.max_keywords, else unlimited.

-- 1. Keyword limit without max_watches -----------------------------------------
create or replace function public.keyword_limit_for_user(p_user_id uuid)
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
      select case when (p.limits ->> 'max_keywords') ~ '^\d+$' then (p.limits ->> 'max_keywords')::integer end
      from public.subscription_plans p
      where p.id = coalesce(
        (select profile.plan_id from public.user_profiles profile where profile.user_id = p_user_id),
        (select free_plan.id from public.subscription_plans free_plan where free_plan.code = 'free' limit 1)
      )
    )
  end;
$$;

revoke all on function public.keyword_limit_for_user(uuid) from public, anon, authenticated;

-- The return type loses max_watches, so the function is recreated.
drop function if exists public.current_user_plan_limits();
create function public.current_user_plan_limits()
returns table (max_keywords integer, max_social_keywords integer)
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
    case when (p.limits ->> 'max_keywords') ~ '^\d+$' then (p.limits ->> 'max_keywords')::integer end,
    public.social_keyword_limit_for_user((select auth.uid()))
  from plan
  join public.subscription_plans p on p.id = plan.id;
$$;

revoke all on function public.current_user_plan_limits() from public, anon;
grant execute on function public.current_user_plan_limits() to authenticated;

-- 2. Objects that read max_watches ------------------------------------------------
-- Superseded by add_keyword() in 20261020000008 and no longer callable by customers.
drop function if exists public.create_user_monitor_with_limit(text, text, boolean);
-- Unused helper view; it selects max_watches.
drop view if exists public.user_profile_with_plan_limits;

-- 3. Web watch tables and functions ----------------------------------------------
-- cascade removes their policies, triggers and indexes.
drop table if exists public.change_alerts cascade;
drop table if exists public.change_events cascade;
drop table if exists public.change_snapshots cascade;
drop table if exists public.change_sources cascade;

drop function if exists public.delete_user_change_source(uuid);
drop function if exists public.enforce_change_source_customer_limits();

alter table public.subscription_plans drop column if exists max_watches;
