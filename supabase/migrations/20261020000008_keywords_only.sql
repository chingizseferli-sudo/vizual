-- Keywords only: customers manage a flat list of keywords, not monitors.
--
-- user_monitors stays as a hidden container: every customer has exactly one
-- non-archived "primary" monitor that holds all of their keywords. Matches and
-- alerts keep pointing at the monitor they were made for, so history from the
-- merged monitors is kept.
--
-- 1. monitor_keywords.status: 'active' or 'paused'. The plan keyword limit
--    counts active keywords only.
-- 2. One-time merge per customer:
--    - primary = oldest active monitor; a new 'Açar sözlər' monitor when none
--      is active.
--    - keywords of the other monitors move to the primary. Keywords of a monitor
--      the customer had switched off arrive paused; plan_limit monitors keep
--      their keywords' status. A keyword the primary already has (same text,
--      case and spaces ignored) is not moved.
--    - the other monitors become status 'archived', inactive_reason 'merged'.
--    - the primary sends Telegram to the profile's chat.
--    - active keywords beyond the plan's max_keywords are paused, oldest stay
--      active.
-- 3. Customers no longer create, change or delete monitors, and cannot insert
--    or change keywords directly: add_keyword(), set_keyword_status() and
--    delete_keyword() do it with the plan limit and account checks.
--    max_watches no longer limits customers' keywords.
-- Idempotent.

-- 1. Keyword status ------------------------------------------------------------

alter table public.monitor_keywords
  add column if not exists status text not null default 'active';

alter table public.monitor_keywords
  drop constraint if exists monitor_keywords_status_check,
  add constraint monitor_keywords_status_check check (status in ('active', 'paused'));

-- A user's keyword limit without auth.uid(): plan max_keywords, else 20 per
-- allowed watch, else unlimited. Admins are unlimited. Internal only.
create or replace function public.keyword_limit_for_user(p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (
      select 1 from public.admin_users admin
      where admin.user_id = p_user_id and admin.status = 'active'
    ) then null
    else (
      select coalesce(
        case when (p.limits ->> 'max_keywords') ~ '^\d+$' then (p.limits ->> 'max_keywords')::integer end,
        p.max_watches * 20
      )
      from public.subscription_plans p
      where p.id = coalesce(
        (select profile.plan_id from public.user_profiles profile where profile.user_id = p_user_id),
        (select free_plan.id from public.subscription_plans free_plan where free_plan.code = 'free' limit 1)
      )
    )
  end;
$$;

revoke all on function public.keyword_limit_for_user(uuid) from public, anon, authenticated;

-- Active keywords that count towards the limit.
create or replace function public.active_keyword_count_for_user(p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.monitor_keywords keyword
  join public.user_monitors monitor on monitor.id = keyword.monitor_id
  where monitor.user_id = p_user_id
    and monitor.status <> 'archived'
    and keyword.status = 'active';
$$;

revoke all on function public.active_keyword_count_for_user(uuid) from public, anon, authenticated;

-- 2. Merge each customer's monitors into one ------------------------------------

insert into public.user_monitors (user_id, name, status, notify_telegram, telegram_chat_id)
select owner.user_id, 'Açar sözlər', 'active', true, profile.telegram_chat_id
from (
  select distinct monitor.user_id
  from public.user_monitors monitor
  where monitor.user_id is not null
    and monitor.status <> 'archived'
) owner
left join public.user_profiles profile on profile.user_id = owner.user_id
where not exists (
  select 1 from public.user_monitors active_monitor
  where active_monitor.user_id = owner.user_id and active_monitor.status = 'active'
);

drop table if exists pg_temp.keyword_primary;
create temporary table keyword_primary on commit drop as
select distinct on (monitor.user_id) monitor.user_id, monitor.id
from public.user_monitors monitor
where monitor.user_id is not null
  and monitor.status = 'active'
order by monitor.user_id, monitor.created_at, monitor.id;

drop table if exists pg_temp.keyword_move;
create temporary table keyword_move on commit drop as
select
  keyword.id,
  pick.id as primary_id,
  lower(btrim(keyword.keyword)) as norm,
  case
    when source.status = 'active' or source.inactive_reason = 'plan_limit' then keyword.status
    else 'paused'
  end as new_status,
  row_number() over (
    partition by pick.user_id, lower(btrim(keyword.keyword))
    order by
      (source.status = 'active' or source.inactive_reason = 'plan_limit') and keyword.status = 'active' desc,
      keyword.created_at,
      keyword.id
  ) as position
from public.monitor_keywords keyword
join public.user_monitors source on source.id = keyword.monitor_id
join keyword_primary pick on pick.user_id = source.user_id
where source.id <> pick.id
  and source.status <> 'archived';

-- An active duplicate wakes the primary's paused copy.
update public.monitor_keywords keyword
set status = 'active'
from keyword_move move
where keyword.monitor_id = move.primary_id
  and lower(btrim(keyword.keyword)) = move.norm
  and move.new_status = 'active'
  and keyword.status = 'paused';

update public.monitor_keywords keyword
set monitor_id = move.primary_id, status = move.new_status
from keyword_move move
where keyword.id = move.id
  and move.position = 1
  and not exists (
    select 1 from public.monitor_keywords existing
    where existing.monitor_id = move.primary_id
      and lower(btrim(existing.keyword)) = move.norm
  );

update public.user_monitors monitor
set status = 'archived', inactive_reason = 'merged'
from keyword_primary pick
where monitor.user_id = pick.user_id
  and monitor.id <> pick.id
  and monitor.status <> 'archived';

update public.user_monitors monitor
set notify_telegram = true, telegram_chat_id = profile.telegram_chat_id
from keyword_primary pick
left join public.user_profiles profile on profile.user_id = pick.user_id
where monitor.id = pick.id
  and (monitor.notify_telegram is distinct from true
       or monitor.telegram_chat_id is distinct from profile.telegram_chat_id);

with ranked as (
  select
    keyword.id,
    row_number() over (partition by pick.user_id order by keyword.created_at, keyword.id) as position,
    public.keyword_limit_for_user(pick.user_id) as max_keywords
  from public.monitor_keywords keyword
  join keyword_primary pick on pick.id = keyword.monitor_id
  where keyword.status = 'active'
)
update public.monitor_keywords keyword
set status = 'paused'
from ranked
where ranked.id = keyword.id
  and ranked.max_keywords is not null
  and ranked.position > ranked.max_keywords;

-- 3. Customer writes go through the keyword RPCs ---------------------------------

revoke execute on function public.create_user_monitor_with_limit(text, text, boolean) from authenticated;

create or replace function public.guard_user_monitor_customer_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user not in ('anon', 'authenticated') or public.is_admin_user() then
    if tg_op = 'DELETE' then
      return old;
    end if;
    if new.status = 'active' then
      new.inactive_reason := null;
    end if;
    return new;
  end if;

  raise exception 'MONITORS_MANAGED_BY_SYSTEM' using errcode = '42501';
end;
$$;

drop trigger if exists guard_user_monitor_customer_write_trigger on public.user_monitors;
create trigger guard_user_monitor_customer_write_trigger
  before insert or update or delete on public.user_monitors
  for each row
  execute function public.guard_user_monitor_customer_write();

create or replace function public.enforce_monitor_keyword_customer_limits()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user not in ('anon', 'authenticated') or public.is_admin_user() then
    return new;
  end if;

  raise exception 'USE_KEYWORD_FUNCTIONS' using errcode = '42501';
end;
$$;

drop trigger if exists enforce_monitor_keyword_customer_limits_trigger on public.monitor_keywords;
create trigger enforce_monitor_keyword_customer_limits_trigger
  before insert or update on public.monitor_keywords
  for each row
  execute function public.enforce_monitor_keyword_customer_limits();

-- Shared checks for adding or resuming a keyword. Caller holds the user's lock.
create or replace function public.assert_keyword_slot_available(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := public.keyword_limit_for_user(p_user_id);
begin
  if not public.is_admin_user()
     and (select state.status from public.current_user_account_state() state) is distinct from 'active' then
    raise exception 'ACCOUNT_NOT_ACTIVE' using errcode = '42501';
  end if;

  if v_limit is not null and public.active_keyword_count_for_user(p_user_id) >= v_limit then
    raise exception 'PLAN_KEYWORD_LIMIT_REACHED' using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.assert_keyword_slot_available(uuid) from public, anon, authenticated;

create or replace function public.add_keyword(p_keyword text, p_match_type text default 'contains')
returns public.monitor_keywords
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_keyword text := btrim(coalesce(p_keyword, ''));
  v_match_type text := coalesce(nullif(btrim(p_match_type), ''), 'contains');
  v_monitor_id uuid;
  v_row public.monitor_keywords;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  if char_length(v_keyword) not between 1 and 200 then
    raise exception 'KEYWORD_LENGTH_INVALID' using errcode = '22023';
  end if;

  if v_match_type not in ('contains', 'phrase', 'exact') then
    raise exception 'KEYWORD_MATCH_TYPE_INVALID' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('monitor_keywords:' || v_user_id::text));

  select monitor.id into v_monitor_id
  from public.user_monitors monitor
  where monitor.user_id = v_user_id and monitor.status <> 'archived'
  order by monitor.status = 'active' desc, monitor.created_at, monitor.id
  limit 1;

  if exists (
    select 1 from public.monitor_keywords keyword
    where keyword.monitor_id = v_monitor_id
      and lower(btrim(keyword.keyword)) = lower(v_keyword)
  ) then
    raise exception 'KEYWORD_EXISTS' using errcode = '23505';
  end if;

  perform public.assert_keyword_slot_available(v_user_id);

  if v_monitor_id is null then
    insert into public.user_monitors (user_id, name, status, notify_telegram, telegram_chat_id)
    select v_user_id, 'Açar sözlər', 'active', true,
      (select profile.telegram_chat_id from public.user_profiles profile where profile.user_id = v_user_id)
    returning id into v_monitor_id;
  end if;

  insert into public.monitor_keywords (monitor_id, keyword, match_type, status)
  values (v_monitor_id, v_keyword, v_match_type, 'active')
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.add_keyword(text, text) from public, anon;
grant execute on function public.add_keyword(text, text) to authenticated;

create or replace function public.set_keyword_status(p_keyword_id uuid, p_status text)
returns public.monitor_keywords
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_row public.monitor_keywords;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  if p_status not in ('active', 'paused') then
    raise exception 'KEYWORD_STATUS_INVALID' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('monitor_keywords:' || v_user_id::text));

  select keyword.* into v_row
  from public.monitor_keywords keyword
  join public.user_monitors monitor on monitor.id = keyword.monitor_id
  where keyword.id = p_keyword_id
    and monitor.user_id = v_user_id
    and monitor.status <> 'archived';

  if v_row.id is null then
    raise exception 'KEYWORD_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_row.status = p_status then
    return v_row;
  end if;

  if p_status = 'active' then
    perform public.assert_keyword_slot_available(v_user_id);
  end if;

  update public.monitor_keywords
  set status = p_status
  where id = v_row.id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.set_keyword_status(uuid, text) from public, anon;
grant execute on function public.set_keyword_status(uuid, text) to authenticated;

create or replace function public.delete_keyword(p_keyword_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  delete from public.monitor_keywords keyword
  using public.user_monitors monitor
  where keyword.id = p_keyword_id
    and monitor.id = keyword.monitor_id
    and monitor.user_id = v_user_id
    and monitor.status <> 'archived';

  if not found then
    raise exception 'KEYWORD_NOT_FOUND' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.delete_keyword(uuid) from public, anon;
grant execute on function public.delete_keyword(uuid) to authenticated;
