-- Customers pick the Baku-time hour their email reports arrive (default 09:00).
-- The worker passes the current Baku hour on the day a report becomes due
-- (p_max_hour); on later days it passes 23 so a missed report still goes out.

alter table public.user_profiles
  add column if not exists email_report_hour smallint not null default 9;

alter table public.user_profiles
  drop constraint if exists user_profiles_email_report_hour_check;
alter table public.user_profiles
  add constraint user_profiles_email_report_hour_check
  check (email_report_hour between 0 and 23);

drop function if exists public.email_report_recipients(text, date, integer);

create or replace function public.email_report_recipients(
  p_kind text,
  p_period_start date,
  p_limit integer default 50,
  p_max_hour integer default 23
)
returns table (user_id uuid, email text)
language sql
stable
security definer
set search_path = ''
as $$
  select profile.user_id, auth_user.email::text
  from public.user_profiles profile
  join auth.users auth_user on auth_user.id = profile.user_id
  join public.subscription_plans plan on plan.id = coalesce(
    profile.plan_id,
    (select free_plan.id from public.subscription_plans free_plan where free_plan.code = 'free' limit 1)
  )
  where profile.status = 'active'
    and profile.email_report_hour <= coalesce(p_max_hour, 23)
    and coalesce(auth_user.email, '') <> ''
    and coalesce(plan.limits -> 'report_frequencies', '[]'::jsonb) ? p_kind
    and not (p_kind = any(profile.email_report_opt_out))
    and exists (
      select 1
      from public.monitor_keywords keyword
      join public.user_monitors monitor on monitor.id = keyword.monitor_id
      where monitor.user_id = profile.user_id
        and monitor.status <> 'archived'
        and coalesce(keyword.status, 'active') = 'active'
    )
    and not exists (
      select 1
      from public.email_report_deliveries delivery
      where delivery.user_id = profile.user_id
        and delivery.kind = p_kind
        and delivery.period_start = p_period_start
        and not (delivery.status = 'failed' and delivery.attempts < 3)
    )
  order by profile.user_id
  limit greatest(coalesce(p_limit, 50), 0);
$$;

revoke all on function public.email_report_recipients(text, date, integer, integer) from public, anon, authenticated;
grant execute on function public.email_report_recipients(text, date, integer, integer) to service_role;
