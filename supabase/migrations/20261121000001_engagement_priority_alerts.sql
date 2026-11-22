-- Engagement, priority sources and alert rules. Idempotent.
--
-- 1. monitored_items keeps the author and the like / comment / share / view
--    counts the social providers already return (stored when the post is
--    first found). engagement = likes + comments + shares.
-- 2. monitor_keywords.is_critical: a critical keyword's alerts are marked
--    "Kritik" and can also go by email. Set through set_keyword_critical().
-- 3. user_priority_sources: up to 20 news sites per customer. The rss worker
--    reads them every minute (others every 3 minutes) and marks their alerts.
--    customer_sources() lists the sites a customer can pick.
-- 4. user_profiles.alert_email (instant email for critical / priority /
--    high-engagement alerts) and engagement_alert_threshold (a social post at
--    or above it is marked "Yüksək engagement"; null = off). Set through
--    set_alert_settings().
-- 5. Results carry the new fields and can be sorted by engagement;
--    my_dashboard_stats() feeds the dashboard charts.

-- 1. Engagement -------------------------------------------------------------
alter table public.monitored_items
  add column if not exists author text,
  add column if not exists like_count bigint,
  add column if not exists comment_count bigint,
  add column if not exists share_count bigint,
  add column if not exists view_count bigint;

alter table public.monitored_items
  add column if not exists engagement bigint
    generated always as (coalesce(like_count, 0) + coalesce(comment_count, 0) + coalesce(share_count, 0)) stored;

alter table public.monitored_items
  drop constraint if exists monitored_items_engagement_counts_check,
  add constraint monitored_items_engagement_counts_check
    check (coalesce(like_count, 0) >= 0 and coalesce(comment_count, 0) >= 0
      and coalesce(share_count, 0) >= 0 and coalesce(view_count, 0) >= 0);

-- 2. Critical keywords ------------------------------------------------------
alter table public.monitor_keywords
  add column if not exists is_critical boolean not null default false;

create or replace function public.set_keyword_critical(p_keyword_id uuid, p_critical boolean)
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

  update public.monitor_keywords keyword
  set is_critical = coalesce(p_critical, false)
  from public.user_monitors monitor
  where keyword.id = p_keyword_id
    and monitor.id = keyword.monitor_id
    and monitor.user_id = v_user_id
    and monitor.status <> 'archived'
  returning keyword.* into v_row;

  if v_row.id is null then
    raise exception 'KEYWORD_NOT_FOUND' using errcode = 'P0002';
  end if;

  return v_row;
end;
$$;

revoke all on function public.set_keyword_critical(uuid, boolean) from public, anon;
grant execute on function public.set_keyword_critical(uuid, boolean) to authenticated;

-- 3. Priority sources -------------------------------------------------------
create table if not exists public.user_priority_sources (
  user_id uuid not null references auth.users (id) on delete cascade,
  source_id uuid not null references public.sources (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, source_id)
);

create index if not exists user_priority_sources_source_idx
  on public.user_priority_sources (source_id);

alter table public.user_priority_sources enable row level security;

drop policy if exists user_priority_sources_select_own on public.user_priority_sources;
create policy user_priority_sources_select_own
on public.user_priority_sources
for select
to authenticated
using (user_id = (select auth.uid()) or public.is_admin_user());

-- Writes go through set_priority_source() only.
revoke all on public.user_priority_sources from anon, authenticated;
grant select on public.user_priority_sources to authenticated;

-- News sites a customer can mark as priority (sources itself is admin-only).
create or replace function public.customer_sources()
returns table (id uuid, name text, host text, is_priority boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select
    source.id,
    source.name,
    public.url_host(source.base_url),
    exists (
      select 1 from public.user_priority_sources priority
      where priority.source_id = source.id and priority.user_id = (select auth.uid())
    )
  from public.sources source
  where (select auth.uid()) is not null
    and source.status = 'active'
  order by source.name;
$$;

revoke all on function public.customer_sources() from public, anon;
grant execute on function public.customer_sources() to authenticated;

create or replace function public.set_priority_source(p_source_id uuid, p_priority boolean)
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

  if not coalesce(p_priority, false) then
    delete from public.user_priority_sources
    where user_id = v_user_id and source_id = p_source_id;
    return;
  end if;

  if not exists (select 1 from public.sources where id = p_source_id and status = 'active') then
    raise exception 'SOURCE_NOT_FOUND' using errcode = 'P0002';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('priority_sources:' || v_user_id::text));

  if (select count(*) from public.user_priority_sources where user_id = v_user_id) >= 20
    and not exists (
      select 1 from public.user_priority_sources where user_id = v_user_id and source_id = p_source_id
    ) then
    raise exception 'PRIORITY_SOURCE_LIMIT' using errcode = 'P0001';
  end if;

  insert into public.user_priority_sources (user_id, source_id)
  values (v_user_id, p_source_id)
  on conflict do nothing;
end;
$$;

revoke all on function public.set_priority_source(uuid, boolean) from public, anon;
grant execute on function public.set_priority_source(uuid, boolean) to authenticated;

-- 4. Alert settings ---------------------------------------------------------
alter table public.user_profiles
  add column if not exists alert_email boolean not null default false,
  add column if not exists engagement_alert_threshold integer;

alter table public.user_profiles
  drop constraint if exists user_profiles_engagement_alert_threshold_check,
  add constraint user_profiles_engagement_alert_threshold_check
    check (engagement_alert_threshold is null or engagement_alert_threshold between 10 and 10000000);

create or replace function public.set_alert_settings(p_alert_email boolean, p_engagement_threshold integer)
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

  if p_engagement_threshold is not null and p_engagement_threshold not between 10 and 10000000 then
    raise exception 'ENGAGEMENT_THRESHOLD_INVALID' using errcode = '22023';
  end if;

  update public.user_profiles
  set alert_email = coalesce(p_alert_email, false),
      engagement_alert_threshold = p_engagement_threshold,
      updated_at = now()
  where user_id = v_user_id;
end;
$$;

revoke all on function public.set_alert_settings(boolean, integer) from public, anon;
grant execute on function public.set_alert_settings(boolean, integer) to authenticated;

-- 5. Results and dashboard --------------------------------------------------
-- The return types change, so the functions are recreated.
drop function if exists public.my_results_page(integer, text, text[], text, text, text, text, date, integer, integer);
drop function if exists public.my_result_filters(integer);
drop function if exists public.my_result_matches(integer);

create or replace function public.my_result_matches(p_days integer)
returns table (
  match_id uuid,
  item_id uuid,
  matched_keyword text,
  match_created_at timestamptz,
  title text,
  url text,
  published_at timestamptz,
  detected_at timestamptz,
  host text,
  network text,
  author text,
  like_count bigint,
  comment_count bigint,
  share_count bigint,
  view_count bigint,
  engagement bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    match.id,
    match.item_id,
    match.matched_keyword,
    match.created_at,
    item.title,
    item.url,
    item.published_at,
    item.detected_at,
    coalesce(item.link_host, '-'),
    item.link_network,
    item.author,
    item.like_count,
    item.comment_count,
    item.share_count,
    item.view_count,
    item.engagement
  from public.user_monitors monitor
  join public.monitor_matches match on match.monitor_id = monitor.id
  left join public.monitored_items item on item.id = match.item_id
  where monitor.user_id = (select auth.uid())
    and match.created_at >= now() - interval '31 days'
    and coalesce(item.detected_at, match.created_at, item.published_at)
      >= now() - make_interval(days => least(greatest(coalesce(p_days, 31), 1), 31));
$$;

revoke all on function public.my_result_matches(integer) from public, anon, authenticated;

-- p_sort: 'new' (default, newest first) or 'engagement' (most engagement first).
create or replace function public.my_results_page(
  p_days integer default 31,
  p_category text default null,
  p_sites text[] default null,
  p_network text default null,
  p_keyword text default null,
  p_language text default null,
  p_search text default null,
  p_date date default null,
  p_limit integer default 12,
  p_offset integer default 0,
  p_sort text default 'new'
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with filtered as (
    select *
    from public.my_result_matches(p_days) m
    where (p_keyword is null or m.matched_keyword = p_keyword)
      and (
        p_category is null
        or (p_category = 'social' and m.network is not null
            and (p_network is null or m.network = p_network))
        or (p_category = 'web' and m.network is null
            and (coalesce(cardinality(p_sites), 0) = 0 or m.host = any (p_sites)))
      )
      and (p_date is null
        or (coalesce(m.detected_at, m.match_created_at) at time zone 'Asia/Baku')::date = p_date)
      and (coalesce(p_search, '') = ''
        or strpos(public.az_lower(m.title), public.az_lower(p_search)) > 0
        or strpos(public.az_lower(m.url), public.az_lower(p_search)) > 0
        or strpos(public.az_lower(m.matched_keyword), public.az_lower(p_search)) > 0)
      and (p_language is null or public.news_language(m.title, m.url) = p_language)
  ),
  items as (
    select
      (array_agg(m.match_id order by m.match_created_at desc))[1] as id,
      m.item_id,
      string_agg(distinct m.matched_keyword, ', ') as matched_keyword,
      max(m.match_created_at) as created_at,
      max(m.title) as title,
      max(m.url) as url,
      max(m.published_at) as published_at,
      max(m.detected_at) as detected_at,
      max(m.network) as network,
      max(m.author) as author,
      max(m.like_count) as like_count,
      max(m.comment_count) as comment_count,
      max(m.share_count) as share_count,
      max(m.view_count) as view_count,
      max(m.engagement) as engagement
    from filtered m
    group by m.item_id
  ),
  page as (
    select *
    from items
    order by
      case when p_sort = 'engagement' then coalesce(engagement, 0) end desc nulls last,
      created_at desc,
      item_id
    limit least(greatest(coalesce(p_limit, 12), 1), 5000)
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select jsonb_build_object(
    'total', (select count(*) from items),
    'media', (select count(distinct host) from filtered where host <> '-'),
    'keywords', (select count(distinct matched_keyword) from filtered),
    'rows', coalesce(
      (select jsonb_agg(to_jsonb(page) order by
        case when p_sort = 'engagement' then coalesce(page.engagement, 0) end desc nulls last,
        page.created_at desc, page.item_id) from page),
      '[]'::jsonb
    )
  );
$$;

revoke all on function public.my_results_page(integer, text, text[], text, text, text, text, date, integer, integer, text) from public, anon;
grant execute on function public.my_results_page(integer, text, text[], text, text, text, text, date, integer, integer, text) to authenticated;

create or replace function public.my_result_filters(p_days integer default 31)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with matches as (select * from public.my_result_matches(p_days))
  select jsonb_build_object(
    'keywords', coalesce((
      select jsonb_agg(keyword order by keyword)
      from (select distinct matched_keyword as keyword from matches where matched_keyword is not null) k
    ), '[]'::jsonb),
    'sites', coalesce((
      select jsonb_agg(host order by host)
      from (select distinct host from matches where network is null and host <> '-') s
    ), '[]'::jsonb),
    'networks', coalesce((
      select jsonb_agg(network)
      from (select distinct network from matches where network is not null) n
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.my_result_filters(integer) from public, anon;
grant execute on function public.my_result_filters(integer) to authenticated;

-- Dashboard charts for the last p_days days (1-31): one article is counted
-- once, on the Baku day it was found.
create or replace function public.my_dashboard_stats(p_days integer default 30)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with items as (
    select
      m.item_id,
      max(m.title) as title,
      max(m.url) as url,
      max(m.host) as host,
      max(m.network) as network,
      max(m.author) as author,
      max(m.like_count) as like_count,
      max(m.comment_count) as comment_count,
      max(m.share_count) as share_count,
      max(m.view_count) as view_count,
      max(m.engagement) as engagement,
      (min(coalesce(m.detected_at, m.match_created_at)) at time zone 'Asia/Baku')::date as day
    from public.my_result_matches(p_days) m
    where m.item_id is not null
    group by m.item_id
  ),
  keywords as (
    select m.matched_keyword as keyword, count(distinct m.item_id) as count
    from public.my_result_matches(p_days) m
    where m.matched_keyword is not null
    group by m.matched_keyword
  ),
  days as (
    select generate_series(
      (now() at time zone 'Asia/Baku')::date - (least(greatest(coalesce(p_days, 30), 1), 31) - 1),
      (now() at time zone 'Asia/Baku')::date,
      interval '1 day'
    )::date as day
  )
  select jsonb_build_object(
    'news', (select count(*) from items where network is null),
    'social', (select count(*) from items where network is not null),
    'engagement', (select coalesce(sum(engagement), 0) from items where network is not null),
    'by_network', coalesce((
      select jsonb_agg(jsonb_build_object('network', coalesce(network, 'web'), 'count', count) order by count desc)
      from (select network, count(*) as count from items group by network) n
    ), '[]'::jsonb),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object(
        'day', days.day,
        'news', (select count(*) from items where items.day = days.day and items.network is null),
        'social', (select count(*) from items where items.day = days.day and items.network is not null)
      ) order by days.day)
      from days
    ), '[]'::jsonb),
    'top_keywords', coalesce((
      select jsonb_agg(jsonb_build_object('keyword', keyword, 'count', count) order by count desc, keyword)
      from (select * from keywords order by count desc, keyword limit 8) k
    ), '[]'::jsonb),
    'top_sources', coalesce((
      select jsonb_agg(jsonb_build_object('host', host, 'count', count) order by count desc, host)
      from (
        select host, count(*) as count from items
        where network is null and host <> '-'
        group by host order by count(*) desc, host limit 8
      ) s
    ), '[]'::jsonb),
    'top_engagement', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.engagement desc)
      from (
        select item_id, title, url, network, author, like_count, comment_count, share_count, view_count, engagement
        from items
        where network is not null and coalesce(engagement, 0) > 0
        order by engagement desc
        limit 5
      ) t
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.my_dashboard_stats(integer) from public, anon;
grant execute on function public.my_dashboard_stats(integer) to authenticated;
