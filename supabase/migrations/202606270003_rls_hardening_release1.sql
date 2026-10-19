-- Release 1 RLS hardening for Visual Monitor.
-- This migration removes broad public/global access and restores tenant isolation.
-- It is intentionally scoped to policies/grants only; service_role bot paths remain unaffected.

create or replace function public.is_admin_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_profiles profile
    where profile.user_id = auth.uid()
      and profile.status = 'active'
      and profile.role in ('admin', 'superadmin')
  );
$$;

grant execute on function public.is_admin_user() to authenticated;

create or replace function public.prevent_profile_sensitive_self_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if current_setting('request.jwt.claim.role', true) = 'service_role' then
    return new;
  end if;

  if (
    new.role is distinct from old.role
    or new.status is distinct from old.status
    or new.plan_id is distinct from old.plan_id
  ) and not public.is_admin_user() then
    raise exception 'PROFILE_SENSITIVE_FIELDS_ADMIN_ONLY'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_profile_sensitive_self_update_trigger on public.user_profiles;

create trigger prevent_profile_sensitive_self_update_trigger
before update on public.user_profiles
for each row
execute function public.prevent_profile_sensitive_self_update();

alter table public.user_profiles enable row level security;
alter table public.user_monitors enable row level security;
alter table public.monitor_keywords enable row level security;
alter table public.monitor_matches enable row level security;
alter table public.monitor_alerts enable row level security;
alter table public.monitored_items enable row level security;
alter table public.sources enable row level security;
alter table public.subscription_plans enable row level security;
alter table public.change_sources enable row level security;
alter table public.change_events enable row level security;
alter table public.change_snapshots enable row level security;

-- Remove unsafe broad/public policies found in the Release 1 audit.
drop policy if exists "Allow public read user_monitors" on public.user_monitors;
drop policy if exists "Allow public read monitor_keywords" on public.monitor_keywords;
drop policy if exists "Allow public read monitor_matches" on public.monitor_matches;
drop policy if exists "Allow public read monitor_alerts" on public.monitor_alerts;
drop policy if exists "Allow public read monitored_items" on public.monitored_items;
drop policy if exists "Allow public read sources" on public.sources;
drop policy if exists "Allow public update sources" on public.sources;
drop policy if exists "Allow public delete sources" on public.sources;
drop policy if exists "Allow authenticated read change events" on public.change_events;
drop policy if exists "Allow authenticated read change snapshots" on public.change_snapshots;

-- Replace public profile policies with authenticated user/admin policies.
drop policy if exists "Users can read own profile" on public.user_profiles;
drop policy if exists "Users can insert own profile" on public.user_profiles;
drop policy if exists "Users can update own profile" on public.user_profiles;
drop policy if exists user_profiles_select_own on public.user_profiles;
drop policy if exists user_profiles_insert_own on public.user_profiles;
drop policy if exists user_profiles_update_own_safe on public.user_profiles;
drop policy if exists user_profiles_admin_manage on public.user_profiles;

create policy user_profiles_select_own
on public.user_profiles
for select
to authenticated
using (user_id = auth.uid());

create policy user_profiles_insert_own
on public.user_profiles
for insert
to authenticated
with check (user_id = auth.uid());

create policy user_profiles_update_own_safe
on public.user_profiles
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy user_profiles_admin_manage
on public.user_profiles
for all
to authenticated
using (public.is_admin_user())
with check (public.is_admin_user());

-- Customer monitor ownership plus admin management.
drop policy if exists user_monitors_admin_manage on public.user_monitors;

create policy user_monitors_admin_manage
on public.user_monitors
for all
to authenticated
using (public.is_admin_user())
with check (public.is_admin_user());

-- Keyword ownership plus admin management.
drop policy if exists monitor_keywords_admin_manage on public.monitor_keywords;

create policy monitor_keywords_admin_manage
on public.monitor_keywords
for all
to authenticated
using (public.is_admin_user())
with check (public.is_admin_user());

-- Matches are bot-written through service_role; customers read only their monitor matches.
drop policy if exists monitor_matches_select_own_monitor on public.monitor_matches;
drop policy if exists monitor_matches_admin_manage on public.monitor_matches;

create policy monitor_matches_select_own_monitor
on public.monitor_matches
for select
to authenticated
using (
  exists (
    select 1
    from public.user_monitors monitor
    where monitor.id = monitor_matches.monitor_id
      and monitor.user_id = auth.uid()
  )
);

create policy monitor_matches_admin_manage
on public.monitor_matches
for all
to authenticated
using (public.is_admin_user())
with check (public.is_admin_user());

-- Alerts are bot-written through service_role; customers read only alerts for their matches.
drop policy if exists monitor_alerts_select_own_monitor on public.monitor_alerts;
drop policy if exists monitor_alerts_admin_manage on public.monitor_alerts;

create policy monitor_alerts_select_own_monitor
on public.monitor_alerts
for select
to authenticated
using (
  exists (
    select 1
    from public.monitor_matches match
    join public.user_monitors monitor on monitor.id = match.monitor_id
    where match.id = monitor_alerts.match_id
      and monitor.user_id = auth.uid()
  )
);

create policy monitor_alerts_admin_manage
on public.monitor_alerts
for all
to authenticated
using (public.is_admin_user())
with check (public.is_admin_user());

-- Items are bot-written through service_role; customers read only items linked to their matches.
drop policy if exists monitored_items_select_own_matches on public.monitored_items;
drop policy if exists monitored_items_admin_manage on public.monitored_items;

create policy monitored_items_select_own_matches
on public.monitored_items
for select
to authenticated
using (
  exists (
    select 1
    from public.monitor_matches match
    join public.user_monitors monitor on monitor.id = match.monitor_id
    where match.item_id = monitored_items.id
      and monitor.user_id = auth.uid()
  )
);

create policy monitored_items_admin_manage
on public.monitored_items
for all
to authenticated
using (public.is_admin_user())
with check (public.is_admin_user());

-- Sources are admin-only in Release 1. Bots continue through service_role.
drop policy if exists sources_admin_manage on public.sources;

create policy sources_admin_manage
on public.sources
for all
to authenticated
using (public.is_admin_user())
with check (public.is_admin_user());

-- Change Monitor is admin-only in Release 1. Customer Watch UI is deferred.
drop policy if exists change_events_admin_manage on public.change_events;
drop policy if exists change_snapshots_admin_manage on public.change_snapshots;

create policy change_events_admin_manage
on public.change_events
for all
to authenticated
using (public.is_admin_user())
with check (public.is_admin_user());

create policy change_snapshots_admin_manage
on public.change_snapshots
for all
to authenticated
using (public.is_admin_user())
with check (public.is_admin_user());

-- Keep existing change_sources admin policies if present, add an idempotent catch-all admin policy.
drop policy if exists change_sources_admin_manage on public.change_sources;

create policy change_sources_admin_manage
on public.change_sources
for all
to authenticated
using (public.is_admin_user())
with check (public.is_admin_user());

-- Subscription plans are read-only to public/authenticated clients for active plans.
drop policy if exists subscription_plans_read_active on public.subscription_plans;

create policy subscription_plans_read_active
on public.subscription_plans
for select
to public
using (is_active = true);

-- Tighten grants. RLS policies still enforce tenant/admin boundaries.
revoke all on public.sources from anon;
revoke all on public.change_sources from anon;
revoke all on public.change_events from anon;
revoke all on public.change_snapshots from anon;
revoke all on public.user_monitors from anon;
revoke all on public.monitor_keywords from anon;
revoke all on public.monitor_matches from anon;
revoke all on public.monitor_alerts from anon;
revoke all on public.monitored_items from anon;
revoke all on public.user_profiles from anon;

revoke insert, update, delete, truncate on public.subscription_plans from anon, authenticated;
revoke insert, update, delete, truncate on public.monitor_matches from anon, authenticated;
revoke insert, update, delete, truncate on public.monitor_alerts from anon, authenticated;
revoke insert, update, delete, truncate on public.monitored_items from anon, authenticated;
revoke insert, update, delete, truncate on public.sources from anon;
revoke insert, update, delete, truncate on public.change_sources from anon;
revoke insert, update, delete, truncate on public.change_events from anon, authenticated;
revoke insert, update, delete, truncate on public.change_snapshots from anon, authenticated;

grant select on public.subscription_plans to anon, authenticated;
grant select, insert, update on public.user_profiles to authenticated;
grant select, insert, update, delete on public.user_monitors to authenticated;
grant select, insert, update, delete on public.monitor_keywords to authenticated;
grant select on public.monitor_matches to authenticated;
grant select on public.monitor_alerts to authenticated;
grant select on public.monitored_items to authenticated;
grant select, insert, update, delete on public.sources to authenticated;
grant select, insert, update, delete on public.change_sources to authenticated;
grant select, insert, update, delete on public.change_events to authenticated;
grant select, insert, update, delete on public.change_snapshots to authenticated;
