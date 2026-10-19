-- Customer access for Change Monitor watches.
-- Existing admin/global watches keep user_id = null and remain admin-only.

begin;

alter table public.change_sources
  add column if not exists user_id uuid;

create index if not exists idx_change_sources_user_id
  on public.change_sources(user_id);

alter table public.change_sources enable row level security;
alter table public.change_events enable row level security;
alter table public.change_snapshots enable row level security;
alter table public.change_alerts enable row level security;

-- Keep admin full access, add owner access for customer-created watches.
drop policy if exists change_sources_customer_select on public.change_sources;
drop policy if exists change_sources_customer_insert on public.change_sources;
drop policy if exists change_sources_customer_update on public.change_sources;
drop policy if exists change_sources_customer_delete on public.change_sources;

create policy change_sources_customer_select
on public.change_sources
for select
to authenticated
using (user_id = auth.uid() or public.is_admin_user());

create policy change_sources_customer_insert
on public.change_sources
for insert
to authenticated
with check (user_id = auth.uid() or public.is_admin_user());

create policy change_sources_customer_update
on public.change_sources
for update
to authenticated
using (user_id = auth.uid() or public.is_admin_user())
with check (user_id = auth.uid() or public.is_admin_user());

create policy change_sources_customer_delete
on public.change_sources
for delete
to authenticated
using (user_id = auth.uid() or public.is_admin_user());

-- Customers can read history only for their own watches. Workers continue through service_role.
drop policy if exists change_events_customer_select on public.change_events;
drop policy if exists change_snapshots_customer_select on public.change_snapshots;
drop policy if exists change_alerts_admin_manage on public.change_alerts;
drop policy if exists change_alerts_customer_select on public.change_alerts;

create policy change_events_customer_select
on public.change_events
for select
to authenticated
using (
  public.is_admin_user()
  or exists (
    select 1
    from public.change_sources source
    where source.id = change_events.source_id
      and source.user_id = auth.uid()
  )
);

create policy change_snapshots_customer_select
on public.change_snapshots
for select
to authenticated
using (
  public.is_admin_user()
  or exists (
    select 1
    from public.change_sources source
    where source.id = change_snapshots.source_id
      and source.user_id = auth.uid()
  )
);

create policy change_alerts_admin_manage
on public.change_alerts
for all
to authenticated
using (public.is_admin_user())
with check (public.is_admin_user());

create policy change_alerts_customer_select
on public.change_alerts
for select
to authenticated
using (
  public.is_admin_user()
  or exists (
    select 1
    from public.change_sources source
    where source.id = change_alerts.source_id
      and source.user_id = auth.uid()
  )
);

grant select, insert, update, delete on public.change_sources to authenticated;
grant select on public.change_events to authenticated;
grant select on public.change_snapshots to authenticated;
grant select on public.change_alerts to authenticated;

commit;