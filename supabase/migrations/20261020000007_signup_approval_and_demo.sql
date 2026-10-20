-- Sign-ups wait for admin approval, and approval starts a 7-day demo.
--
-- 1. New auth users get user_profiles.status = 'pending'. Existing users keep
--    their status. Pending, rejected, expired, inactive and blocked customers
--    cannot create monitors, keywords or page watches (checked in SQL, not
--    only in the UI), and the workers skip monitors whose owner is not active.
-- 2. A 'demo' plan: free of charge, 2 monitors, 20 keywords, Facebook and
--    Instagram once a day (1440 minutes, newly allowed everywhere).
-- 3. admin_approve_signup() activates the account on a trialing demo
--    subscription that ends 7 days later; admin_reject_signup() rejects it.
-- 4. expire_demo_accounts() (service role, called daily by the rss worker)
--    ends trials whose period is over and marks their owners 'expired'.
--    Assigning a plan with admin_assign_user_subscription() reactivates an
--    expired or pending account.

-- 1. Social intervals: allow 24 hours ------------------------------------------

alter table public.social_settings
  drop constraint if exists social_settings_default_interval_allowed,
  add constraint social_settings_default_interval_allowed
    check (default_interval_minutes in (60, 120, 180, 360, 720, 1440));

alter table public.user_profiles
  drop constraint if exists user_profiles_social_interval_check,
  add constraint user_profiles_social_interval_check
    check (social_interval_minutes is null or social_interval_minutes in (60, 120, 180, 360, 720, 1440));

alter table public.subscription_plans
  drop constraint if exists subscription_plans_social_interval_check,
  add constraint subscription_plans_social_interval_check
    check (
      not (coalesce(limits, '{}'::jsonb) ? 'social_interval_minutes')
      or (limits ->> 'social_interval_minutes') in ('60', '120', '180', '360', '720', '1440')
    );

-- 2. Demo plan -----------------------------------------------------------------

insert into public.subscription_plans (
  code, name, description, is_active, is_custom, is_public, price_amount,
  currency, billing_interval, display_order, max_watches,
  minimum_interval_minutes, history_days, telegram_enabled, features, limits
)
values (
  'demo',
  'Demo',
  '7 günlük pulsuz sınaq. Facebook və Instagram gündə bir dəfə yoxlanılır.',
  true, false, true, 0,
  'AZN', 'one_time', 0, 2,
  null, 30, true,
  '["2 monitor", "20 açar söz", "Facebook və Instagram gündə 1 dəfə", "7 gün"]'::jsonb,
  '{"max_keywords": 20, "social_interval_minutes": 1440}'::jsonb
)
on conflict (code) do nothing;

-- 3. Account status ------------------------------------------------------------

alter table public.user_profiles
  add column if not exists signup_notified_at timestamptz;

comment on column public.user_profiles.signup_notified_at is
  'When admin Telegram chats were told about this pending sign-up (rss worker).';

create index if not exists user_profiles_pending_signup_idx
  on public.user_profiles (created_at)
  where status = 'pending';

create or replace function public.handle_new_auth_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_profiles (user_id, email, status)
  values (new.id, new.email, 'pending')
  on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke execute on function public.handle_new_auth_user_profile() from public, anon, authenticated;

-- Same as 20261020000001, plus: a customer-created profile row starts pending.
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
    new.email := (select auth.jwt()) ->> 'email';
    return new;
  end if;

  if new.role is distinct from old.role
     or new.status is distinct from old.status
     or new.plan_id is distinct from old.plan_id
     or new.user_id is distinct from old.user_id
     or new.email is distinct from old.email
     or new.social_interval_minutes is distinct from old.social_interval_minutes
     or new.signup_notified_at is distinct from old.signup_notified_at
     or (new.telegram_chat_id is not null and new.telegram_chat_id is distinct from old.telegram_chat_id) then
    raise exception 'PROFILE_SENSITIVE_FIELDS_ADMIN_ONLY' using errcode = '42501';
  end if;

  return new;
end;
$$;

-- Keyed on auth.uid(), not current_user, so it also covers the security
-- definer create_user_monitor_with_limit(). Service role has no auth.uid().
-- current_user_account_state() is defined in section 6 below.
create or replace function public.require_active_customer_account()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null or public.is_admin_user() then
    return new;
  end if;

  -- current_user_account_state() also catches a demo that ran out before the
  -- daily expire_demo_accounts() run (customers cannot read user_subscriptions).
  if (select state.status from public.current_user_account_state() state) is distinct from 'active' then
    raise exception 'ACCOUNT_NOT_ACTIVE' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists require_active_customer_account_trigger on public.user_monitors;
create trigger require_active_customer_account_trigger
  before insert on public.user_monitors
  for each row
  execute function public.require_active_customer_account();

drop trigger if exists require_active_customer_account_trigger on public.monitor_keywords;
create trigger require_active_customer_account_trigger
  before insert on public.monitor_keywords
  for each row
  execute function public.require_active_customer_account();

drop trigger if exists require_active_customer_account_trigger on public.change_sources;
create trigger require_active_customer_account_trigger
  before insert on public.change_sources
  for each row
  execute function public.require_active_customer_account();

-- 4. Approve / reject ----------------------------------------------------------

create or replace function public.admin_approve_signup(p_user_id uuid)
returns public.user_subscriptions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_demo_plan_id uuid;
  v_subscription public.user_subscriptions;
begin
  if auth.uid() is null or not public.is_admin_user() then
    raise exception using errcode = '42501', message = 'ADMIN_ACCESS_REQUIRED';
  end if;

  if not exists (select 1 from public.user_profiles where user_id = p_user_id) then
    raise exception using errcode = '22023', message = 'USER_PROFILE_NOT_FOUND';
  end if;

  select id into v_demo_plan_id
  from public.subscription_plans
  where code = 'demo' and is_active = true;

  if v_demo_plan_id is null then
    raise exception using errcode = '22023', message = 'ACTIVE_PLAN_NOT_FOUND';
  end if;

  update public.user_subscriptions
  set status = 'canceled', ended_at = now(), updated_at = now()
  where user_id = p_user_id
    and status in ('trialing', 'active');

  insert into public.user_subscriptions (
    user_id, plan_id, status, started_at, current_period_end, notes, assigned_by
  )
  values (
    p_user_id, v_demo_plan_id, 'trialing', now(), now() + interval '7 days',
    'Qeydiyyat təsdiqləndi: 7 günlük demo', auth.uid()
  )
  returning * into v_subscription;

  update public.user_profiles
  set status = 'active', plan_id = v_demo_plan_id, updated_at = now()
  where user_id = p_user_id;

  return v_subscription;
end;
$$;

create or replace function public.admin_reject_signup(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_admin_user() then
    raise exception using errcode = '42501', message = 'ADMIN_ACCESS_REQUIRED';
  end if;

  update public.user_profiles
  set status = 'rejected', updated_at = now()
  where user_id = p_user_id
    and status = 'pending';

  if not found then
    raise exception using errcode = '22023', message = 'PENDING_SIGNUP_NOT_FOUND';
  end if;
end;
$$;

revoke all on function public.admin_approve_signup(uuid) from public, anon;
grant execute on function public.admin_approve_signup(uuid) to authenticated;
revoke all on function public.admin_reject_signup(uuid) from public, anon;
grant execute on function public.admin_reject_signup(uuid) to authenticated;

-- Same as 202609230001, plus: assigning a plan reactivates a pending or
-- expired account (a blocked or rejected one stays as the admin left it).
create or replace function public.admin_assign_user_subscription(
  p_user_id uuid,
  p_plan_id uuid,
  p_status text default 'active',
  p_current_period_end timestamptz default null,
  p_notes text default null
)
returns public.user_subscriptions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_subscription public.user_subscriptions;
begin
  if auth.uid() is null or not public.is_admin_user() then
    raise exception using
      errcode = '42501',
      message = 'ADMIN_ACCESS_REQUIRED';
  end if;

  if p_status not in ('trialing', 'active') then
    raise exception using
      errcode = '22023',
      message = 'SUBSCRIPTION_STATUS_INVALID';
  end if;

  if p_current_period_end is not null and p_current_period_end <= now() then
    raise exception using
      errcode = '22023',
      message = 'SUBSCRIPTION_END_MUST_BE_FUTURE';
  end if;

  if char_length(coalesce(p_notes, '')) > 1000 then
    raise exception using
      errcode = '22023',
      message = 'SUBSCRIPTION_NOTES_TOO_LONG';
  end if;

  if not exists (
    select 1
    from public.user_profiles
    where user_id = p_user_id
  ) then
    raise exception using
      errcode = '22023',
      message = 'USER_PROFILE_NOT_FOUND';
  end if;

  if not exists (
    select 1
    from public.subscription_plans
    where id = p_plan_id
      and is_active = true
  ) then
    raise exception using
      errcode = '22023',
      message = 'ACTIVE_PLAN_NOT_FOUND';
  end if;

  update public.user_subscriptions
  set
    status = 'canceled',
    ended_at = now(),
    updated_at = now()
  where user_id = p_user_id
    and status in ('trialing', 'active');

  insert into public.user_subscriptions (
    user_id,
    plan_id,
    status,
    started_at,
    current_period_end,
    notes,
    assigned_by
  )
  values (
    p_user_id,
    p_plan_id,
    p_status,
    now(),
    p_current_period_end,
    nullif(trim(coalesce(p_notes, '')), ''),
    auth.uid()
  )
  returning * into v_subscription;

  update public.user_profiles
  set
    plan_id = p_plan_id,
    status = case when status in ('pending', 'expired') then 'active' else status end,
    updated_at = now()
  where user_id = p_user_id;

  return v_subscription;
end;
$$;

revoke all
  on function public.admin_assign_user_subscription(uuid, uuid, text, timestamptz, text)
  from public;
grant execute
  on function public.admin_assign_user_subscription(uuid, uuid, text, timestamptz, text)
  to authenticated;

-- 5. Daily expiry --------------------------------------------------------------

create or replace function public.expire_demo_accounts()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with ended as (
    update public.user_subscriptions subscription
    set status = 'expired', ended_at = now(), updated_at = now()
    where subscription.status = 'trialing'
      and subscription.current_period_end is not null
      and subscription.current_period_end <= now()
    returning subscription.user_id
  ),
  expired_profiles as (
    update public.user_profiles profile
    set status = 'expired', updated_at = now()
    from ended
    where profile.user_id = ended.user_id
      and profile.status = 'active'
      and coalesce(profile.role, 'customer') = 'customer'
    returning 1
  )
  select count(*) into v_count from expired_profiles;

  return v_count;
end;
$$;

revoke all on function public.expire_demo_accounts() from public, anon, authenticated;
grant execute on function public.expire_demo_accounts() to service_role;

-- 6. What the signed-in customer's account state is ----------------------------
-- Customers cannot read user_subscriptions; the web app needs the trial end
-- to show the demo deadline and the "demo ended" screen.

create or replace function public.current_user_account_state()
returns table (status text, plan_code text, trial_ends_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select
    case
      when coalesce(profile.status, 'active') = 'active'
           and subscription.status = 'trialing'
           and subscription.current_period_end <= now()
        then 'expired'
      else coalesce(profile.status, 'active')
    end,
    plan.code,
    case when subscription.status = 'trialing' then subscription.current_period_end end
  from public.user_profiles profile
  left join public.subscription_plans plan on plan.id = profile.plan_id
  left join public.user_subscriptions subscription
    on subscription.user_id = profile.user_id
   and subscription.status in ('trialing', 'active')
  where profile.user_id = (select auth.uid());
$$;

revoke all on function public.current_user_account_state() from public, anon;
grant execute on function public.current_user_account_state() to authenticated;
