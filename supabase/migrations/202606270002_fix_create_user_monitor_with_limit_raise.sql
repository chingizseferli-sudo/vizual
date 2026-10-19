-- Fix create_user_monitor_with_limit RAISE syntax so auth/validation/limit errors return normalized messages.
-- Safe to run multiple times.

create or replace function public.create_user_monitor_with_limit(
  p_name text,
  p_description text default null,
  p_notify_telegram boolean default true
)
returns setof public.user_monitors
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_limit integer;
  v_current_count integer;
  v_monitor public.user_monitors;
begin
  if v_user_id is null then
    raise exception using
      errcode = '28000',
      message = 'AUTH_REQUIRED';
  end if;

  if nullif(trim(p_name), '') is null then
    raise exception using
      errcode = '22023',
      message = 'MONITOR_NAME_REQUIRED';
  end if;

  select plan.max_watches
  into v_limit
  from public.user_profiles profile
  left join public.subscription_plans plan on plan.id = profile.plan_id
  where profile.user_id = v_user_id
  limit 1;

  if v_limit is null then
    select max_watches
    into v_limit
    from public.subscription_plans
    where code = 'free'
      and is_active = true
    limit 1;
  end if;

  select count(*)
  into v_current_count
  from public.user_monitors
  where user_id = v_user_id;

  if v_limit is not null and v_current_count >= v_limit then
    raise exception using
      errcode = 'P0001',
      message = 'PLAN_WATCH_LIMIT_REACHED';
  end if;

  insert into public.user_monitors (
    user_id,
    name,
    description,
    status,
    notify_telegram
  )
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

revoke all on function public.create_user_monitor_with_limit(text, text, boolean) from public;
grant execute on function public.create_user_monitor_with_limit(text, text, boolean) to authenticated;
