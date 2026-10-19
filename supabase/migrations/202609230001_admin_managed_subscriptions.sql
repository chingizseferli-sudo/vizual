-- Add admin-managed billing metadata and customer subscription history.
-- This migration does not integrate a payment provider; assignments are manual.

alter table public.subscription_plans
  add column if not exists price_amount numeric(12, 2),
  add column if not exists currency text not null default 'AZN',
  add column if not exists billing_interval text not null default 'month',
  add column if not exists is_public boolean not null default true,
  add column if not exists display_order integer not null default 0,
  add column if not exists features jsonb not null default '[]'::jsonb;

alter table public.subscription_plans
  drop constraint if exists subscription_plans_price_amount_check,
  add constraint subscription_plans_price_amount_check
    check (price_amount is null or price_amount >= 0),
  drop constraint if exists subscription_plans_currency_check,
  add constraint subscription_plans_currency_check
    check (currency ~ '^[A-Z]{3}$'),
  drop constraint if exists subscription_plans_billing_interval_check,
  add constraint subscription_plans_billing_interval_check
    check (billing_interval in ('month', 'year', 'one_time', 'custom')),
  drop constraint if exists subscription_plans_display_order_check,
  add constraint subscription_plans_display_order_check
    check (display_order >= 0),
  drop constraint if exists subscription_plans_features_check,
  add constraint subscription_plans_features_check
    check (jsonb_typeof(features) = 'array');

update public.subscription_plans
set
  price_amount = case code
    when 'free' then 0
    else price_amount
  end,
  billing_interval = case
    when is_custom then 'custom'
    else billing_interval
  end,
  display_order = case code
    when 'free' then 10
    when 'pro' then 20
    when 'business' then 30
    when 'enterprise' then 40
    else display_order
  end,
  updated_at = now();

create index if not exists subscription_plans_public_order_idx
  on public.subscription_plans (is_public, is_active, display_order);

create or replace function public.protect_default_subscription_plan()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.code = 'free' and tg_op = 'DELETE' then
    raise exception using
      errcode = '23514',
      message = 'DEFAULT_PLAN_REQUIRED';
  end if;

  if old.code = 'free' and (new.code <> 'free' or new.is_active = false) then
    raise exception using
      errcode = '23514',
      message = 'DEFAULT_PLAN_REQUIRED';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

drop trigger if exists protect_default_subscription_plan_trigger
  on public.subscription_plans;

create trigger protect_default_subscription_plan_trigger
before update or delete on public.subscription_plans
for each row
execute function public.protect_default_subscription_plan();

create table if not exists public.user_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid not null references public.subscription_plans(id) on delete restrict,
  status text not null default 'active',
  started_at timestamptz not null default now(),
  current_period_end timestamptz,
  ended_at timestamptz,
  notes text,
  assigned_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_subscriptions_status_check
    check (status in ('trialing', 'active', 'canceled', 'expired')),
  constraint user_subscriptions_period_check
    check (current_period_end is null or current_period_end > started_at),
  constraint user_subscriptions_ended_at_check
    check (ended_at is null or ended_at >= started_at),
  constraint user_subscriptions_notes_check
    check (notes is null or char_length(notes) <= 1000)
);

create unique index if not exists user_subscriptions_one_current_idx
  on public.user_subscriptions (user_id)
  where status in ('trialing', 'active');

create index if not exists user_subscriptions_user_created_idx
  on public.user_subscriptions (user_id, created_at desc);

create index if not exists user_subscriptions_plan_status_idx
  on public.user_subscriptions (plan_id, status);

insert into public.user_subscriptions (
  user_id,
  plan_id,
  status,
  started_at,
  assigned_by
)
select
  profile.user_id,
  profile.plan_id,
  'active',
  coalesce(profile.created_at, now()),
  null
from public.user_profiles as profile
where profile.plan_id is not null
  and not exists (
    select 1
    from public.user_subscriptions as subscription
    where subscription.user_id = profile.user_id
      and subscription.status in ('trialing', 'active')
  );

create or replace function public.set_user_subscriptions_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_user_subscriptions_updated_at_trigger
  on public.user_subscriptions;

create trigger set_user_subscriptions_updated_at_trigger
before update on public.user_subscriptions
for each row
execute function public.set_user_subscriptions_updated_at();

alter table public.user_subscriptions enable row level security;

drop policy if exists subscription_plans_read_active
  on public.subscription_plans;
drop policy if exists subscription_plans_read_active_or_admin
  on public.subscription_plans;
drop policy if exists subscription_plans_admin_manage
  on public.subscription_plans;

create policy subscription_plans_read_active_or_admin
on public.subscription_plans
for select
to public
using (
  (is_active = true and (is_public = true or auth.uid() is not null))
  or public.is_admin_user()
);

create policy subscription_plans_admin_manage
on public.subscription_plans
for all
to authenticated
using (public.is_admin_user())
with check (public.is_admin_user());

drop policy if exists user_subscriptions_admin_manage
  on public.user_subscriptions;

create policy user_subscriptions_admin_manage
on public.user_subscriptions
for all
to authenticated
using (public.is_admin_user())
with check (public.is_admin_user());

revoke insert, update, delete, truncate
  on public.subscription_plans
  from anon;
grant select
  on public.subscription_plans
  to anon, authenticated;
grant insert, update
  on public.subscription_plans
  to authenticated;
revoke delete
  on public.subscription_plans
  from authenticated;

revoke all
  on public.user_subscriptions
  from anon;
revoke all
  on public.user_subscriptions
  from authenticated;
grant select
  on public.user_subscriptions
  to authenticated;

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
