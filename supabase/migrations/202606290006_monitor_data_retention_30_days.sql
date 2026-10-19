-- Keyword Monitor result retention for customer exports.
-- Release 1 requires day/week/month exports, so monitor data is retained for
-- at least 30 days by the cleanup RPC used by the Railway worker.

create or replace function public.cleanup_old_monitor_data(
  days_to_keep integer default 30
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  safe_days integer := greatest(coalesce(days_to_keep, 30), 30);
  cutoff_time timestamptz := now() - make_interval(days => safe_days);
begin
  delete from public.monitor_alerts
  where match_id in (
    select mm.id
    from public.monitor_matches mm
    join public.monitored_items mi on mi.id = mm.item_id
    where coalesce(mi.detected_at, mi.published_at, now()) < cutoff_time
  );

  delete from public.monitor_matches
  where item_id in (
    select id
    from public.monitored_items
    where coalesce(detected_at, published_at, now()) < cutoff_time
  );

  delete from public.monitored_items
  where coalesce(detected_at, published_at, now()) < cutoff_time;
end;
$$;

grant execute on function public.cleanup_old_monitor_data(integer) to service_role;

comment on function public.cleanup_old_monitor_data(integer)
is 'Deletes monitor alerts, matches and monitored items older than at least 30 days.';

