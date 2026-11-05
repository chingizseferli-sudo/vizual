-- API balance and budget alerts for admins (apps/worker/social/cost_alerts.py).
--
-- The social worker checks the Apify account limit, the SocialFetch credit
-- balance, our own monthly budgets, the YouTube quota and Anthropic credit
-- errors, and tells admins by email and/or Telegram. Each admin chooses the
-- channels; thresholds live in social_settings. Idempotent.

-- 1. Thresholds and the master switch.
alter table public.social_settings
  add column if not exists cost_alerts_enabled boolean not null default true,
  add column if not exists cost_alert_percent integer not null default 80,
  add column if not exists socialfetch_alert_credits integer not null default 1000;

alter table public.social_settings
  drop constraint if exists social_settings_cost_alert_percent_check,
  add constraint social_settings_cost_alert_percent_check
    check (cost_alert_percent between 10 and 99),
  drop constraint if exists social_settings_socialfetch_alert_credits_check,
  add constraint social_settings_socialfetch_alert_credits_check
    check (socialfetch_alert_credits >= 0);

-- 2. Each admin's channels. Default on: alerts reach the admins who exist now.
alter table public.admin_users
  add column if not exists cost_alert_email boolean not null default true,
  add column if not exists cost_alert_telegram boolean not null default true;

-- 3. Admin page: who receives alerts. Any admin may read the list.
create or replace function public.admin_cost_alert_recipients()
returns table (
  user_id uuid,
  email text,
  role text,
  cost_alert_email boolean,
  cost_alert_telegram boolean,
  telegram_linked boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin_user() then
    raise exception 'ADMIN_ACCESS_REQUIRED';
  end if;

  return query
  select
    admin_user.user_id,
    coalesce(admin_user.email, profile.email)::text,
    admin_user.role::text,
    admin_user.cost_alert_email,
    admin_user.cost_alert_telegram,
    profile.telegram_chat_id is not null
  from public.admin_users admin_user
  left join public.user_profiles profile on profile.user_id = admin_user.user_id
  where admin_user.status = 'active'
  order by coalesce(admin_user.email, profile.email);
end;
$$;

revoke execute on function public.admin_cost_alert_recipients() from public, anon;
grant execute on function public.admin_cost_alert_recipients() to authenticated;

-- 4. An admin changes their own channels; a superadmin anyone's.
create or replace function public.admin_set_cost_alerts(
  p_user_id uuid,
  p_email boolean,
  p_telegram boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin_user() then
    raise exception 'ADMIN_ACCESS_REQUIRED';
  end if;
  if p_user_id is distinct from (select auth.uid()) and not public.is_superadmin_user() then
    raise exception 'SUPERADMIN_ACCESS_REQUIRED';
  end if;

  update public.admin_users
  set cost_alert_email = coalesce(p_email, cost_alert_email),
      cost_alert_telegram = coalesce(p_telegram, cost_alert_telegram)
  where user_id = p_user_id;

  if not found then
    raise exception 'ADMIN_NOT_FOUND';
  end if;
end;
$$;

revoke execute on function public.admin_set_cost_alerts(uuid, boolean, boolean) from public, anon;
grant execute on function public.admin_set_cost_alerts(uuid, boolean, boolean) to authenticated;
