-- Visual Monitor platform foundation: configurable subscription plans.
-- Plans are stored in the database so future code reads limits from data,
-- not from hardcoded if/else logic.

create extension if not exists pgcrypto;

create table if not exists public.subscription_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  is_active boolean not null default true,
  is_custom boolean not null default false,
  max_watches integer,
  minimum_interval_minutes integer,
  history_days integer,
  telegram_enabled boolean not null default true,
  limits jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscription_plans_code_check check (code ~ '^[a-z0-9_]+$'),
  constraint subscription_plans_max_watches_check check (max_watches is null or max_watches >= 0),
  constraint subscription_plans_minimum_interval_check check (
    minimum_interval_minutes is null or minimum_interval_minutes >= 1
  ),
  constraint subscription_plans_history_days_check check (history_days is null or history_days >= 0)
);

create index if not exists subscription_plans_code_idx on public.subscription_plans (code);
create index if not exists subscription_plans_active_idx on public.subscription_plans (is_active);

insert into public.subscription_plans (
  code,
  name,
  description,
  is_active,
  is_custom,
  max_watches,
  minimum_interval_minutes,
  history_days,
  telegram_enabled,
  limits
)
values
  (
    'free',
    'Free',
    'Starter plan for trying Visual Monitor.',
    true,
    false,
    15,
    10,
    30,
    true,
    '{"future_limits": {}}'::jsonb
  ),
  (
    'pro',
    'Pro',
    'Professional plan for regular monitoring.',
    true,
    false,
    100,
    1,
    90,
    true,
    '{"future_limits": {}}'::jsonb
  ),
  (
    'business',
    'Business',
    'Business plan for larger monitoring teams.',
    true,
    false,
    500,
    1,
    180,
    true,
    '{"future_limits": {}}'::jsonb
  ),
  (
    'enterprise',
    'Enterprise',
    'Custom enterprise plan. Null numeric limits are configured per account later.',
    true,
    true,
    null,
    null,
    null,
    true,
    '{"custom": true, "future_limits": {}}'::jsonb
  )
on conflict (code) do update
set
  name = excluded.name,
  description = excluded.description,
  is_active = excluded.is_active,
  is_custom = excluded.is_custom,
  max_watches = excluded.max_watches,
  minimum_interval_minutes = excluded.minimum_interval_minutes,
  history_days = excluded.history_days,
  telegram_enabled = excluded.telegram_enabled,
  limits = excluded.limits,
  updated_at = now();

alter table public.user_profiles
  add column if not exists plan_id uuid;

create index if not exists user_profiles_plan_id_idx on public.user_profiles (plan_id);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_profiles_plan_id_fkey'
      and conrelid = 'public.user_profiles'::regclass
  ) then
    alter table public.user_profiles
      add constraint user_profiles_plan_id_fkey
      foreign key (plan_id)
      references public.subscription_plans(id)
      on delete set null;
  end if;
end
$$;

update public.user_profiles as profile
set plan_id = plan.id
from public.subscription_plans as plan
where profile.plan_id is null
  and plan.code = 'free';

create or replace function public.set_default_user_profile_plan()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.plan_id is null then
    select id
    into new.plan_id
    from public.subscription_plans
    where code = 'free'
    limit 1;
  end if;

  return new;
end;
$$;

drop trigger if exists set_default_user_profile_plan_trigger on public.user_profiles;

create trigger set_default_user_profile_plan_trigger
before insert or update on public.user_profiles
for each row
execute function public.set_default_user_profile_plan();

create or replace view public.user_profile_with_plan_limits as
select
  profile.*,
  plan.code as plan_code,
  plan.name as plan_name,
  plan.is_custom as plan_is_custom,
  plan.max_watches,
  plan.minimum_interval_minutes,
  plan.history_days,
  plan.telegram_enabled,
  plan.limits as plan_limits
from public.user_profiles as profile
left join public.subscription_plans as plan on plan.id = profile.plan_id;

alter table public.subscription_plans enable row level security;

drop policy if exists subscription_plans_read_active on public.subscription_plans;

create policy subscription_plans_read_active
on public.subscription_plans
for select
using (is_active = true);

grant select on public.subscription_plans to anon, authenticated;
