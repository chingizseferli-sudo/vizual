-- Results are kept 30 days for every customer (cleanup_old_monitor_data, run
-- daily by the rss worker). Plans promised 90/180 days; make them say what the
-- system does, and stop the admin form from saving a longer promise.

update public.subscription_plans
set history_days = 30, updated_at = now()
where history_days is distinct from 30;

alter table public.subscription_plans
  drop constraint if exists subscription_plans_history_days_check;
alter table public.subscription_plans
  add constraint subscription_plans_history_days_check
  check (history_days is null or history_days between 1 and 30);
