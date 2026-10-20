-- Facebook and Instagram keyword collectors (apps/worker/social).
--
-- Posts are stored as monitored_items under one sources row per platform, so
-- matching, monitor_matches, alerts, retention and the panels work unchanged.
-- Platform rows use status 'social': the rss worker reads only 'active'.
--
-- How often a keyword is searched: the customer's override
-- (user_profiles.social_interval_minutes), else the plan's
-- limits.social_interval_minutes, else social_settings.default_interval_minutes.
-- A keyword shared by several customers is searched once, at the shortest of
-- their intervals. Idempotent.

-- 1. Global settings (singleton). Admins read/update; the worker uses the service role.
create table if not exists public.social_settings (
  id integer primary key default 1 check (id = 1),
  facebook_enabled boolean not null default false,
  instagram_enabled boolean not null default false,
  default_interval_minutes integer not null default 360 check (default_interval_minutes >= 15),
  monthly_budget_usd numeric(10, 2) check (monthly_budget_usd is null or monthly_budget_usd >= 0),
  updated_at timestamptz not null default now()
);

insert into public.social_settings (id) values (1) on conflict (id) do nothing;

alter table public.social_settings enable row level security;
revoke all on public.social_settings from anon;
revoke insert, delete, truncate on public.social_settings from authenticated;
grant select, update on public.social_settings to authenticated;

drop policy if exists social_settings_admin_select on public.social_settings;
create policy social_settings_admin_select
  on public.social_settings for select to authenticated
  using (public.is_admin_user());

drop policy if exists social_settings_admin_update on public.social_settings;
create policy social_settings_admin_update
  on public.social_settings for update to authenticated
  using (public.is_admin_user())
  with check (public.is_admin_user());

create or replace function public.social_settings_stamp_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists social_settings_stamp_update_trigger on public.social_settings;
create trigger social_settings_stamp_update_trigger
  before update on public.social_settings
  for each row execute function public.social_settings_stamp_update();

-- 2. When each folded keyword was last searched per platform. Worker writes, admins read.
create table if not exists public.social_keyword_state (
  platform text not null check (platform in ('facebook', 'instagram')),
  keyword_fold text not null,
  last_checked_at timestamptz,
  last_result_count integer,
  last_error text,
  primary key (platform, keyword_fold)
);

alter table public.social_keyword_state enable row level security;
revoke all on public.social_keyword_state from anon;
revoke insert, update, delete, truncate on public.social_keyword_state from authenticated;
grant select on public.social_keyword_state to authenticated;

drop policy if exists social_keyword_state_admin_select on public.social_keyword_state;
create policy social_keyword_state_admin_select
  on public.social_keyword_state for select to authenticated
  using (public.is_admin_user());

-- 3. Per-plan interval and per-customer override.
update public.subscription_plans
set limits = coalesce(limits, '{}'::jsonb) || jsonb_build_object(
      'social_interval_minutes',
      case code when 'pro' then 180 when 'business' then 60 when 'enterprise' then 60 else 360 end
    )
where not (coalesce(limits, '{}'::jsonb) ? 'social_interval_minutes');

alter table public.user_profiles
  add column if not exists social_interval_minutes integer;

alter table public.user_profiles
  drop constraint if exists user_profiles_social_interval_check,
  add constraint user_profiles_social_interval_check
    check (social_interval_minutes is null or social_interval_minutes >= 15);

-- Same guard as 20261019000003, plus social_interval_minutes (admin-only).
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
     or (new.telegram_chat_id is not null and new.telegram_chat_id is distinct from old.telegram_chat_id) then
    raise exception 'PROFILE_SENSITIVE_FIELDS_ADMIN_ONLY' using errcode = '42501';
  end if;

  return new;
end;
$$;

-- 4. One sources row per platform; posts hang off these.
insert into public.sources (name, base_url, source_type, status, monitor_method, notes)
values
  ('Facebook', 'https://www.facebook.com', 'facebook', 'social', 'social', 'Social collector (Apify). Not crawled by the rss worker.'),
  ('Instagram', 'https://www.instagram.com', 'instagram', 'social', 'social', 'Social collector (SocialFetch). Not crawled by the rss worker.')
on conflict (base_url) do update
  set source_type = excluded.source_type,
      status = excluded.status,
      monitor_method = excluded.monitor_method;
