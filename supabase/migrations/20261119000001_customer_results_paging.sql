-- Results page and news map: filter, group and page on the server.
--
-- The pages used to download every match of the last 31 days (1000 rows per
-- request, one request after another) and filter them in the browser, with
-- the monitored_items RLS policy checked once per row. These functions read
-- only the caller's own monitors (user_id = auth.uid()) and return one page.

-- The helpers below are plain immutable SQL (no SET clause) so Postgres
-- inlines them into the queries instead of calling them once per row.

-- Host of a link, lower case, without www and port. A link without a scheme
-- returns the link itself, like the browser's URL fallback. String functions,
-- not regexes: this runs for every match on every page load.
create or replace function public.url_host(p_url text)
returns text
language sql
immutable
parallel safe
as $$
  with parts as (
    select pg_catalog.lower(split_part(split_part(split_part(split_part(
      split_part(coalesce(p_url, ''), '://', 2), '/', 1), '?', 1), '#', 1), ':', 1)) as host
  )
  select case
    when coalesce(p_url, '') = '' then '-'
    when host = '' then p_url
    when left(host, 4) = 'www.' then substr(host, 5)
    else host
  end
  from parts
$$;

-- Social network of a host (rows saved before sources had a source_type are
-- classified too). Null means a news site.
create or replace function public.url_social_network(p_host text)
returns text
language sql
immutable
parallel safe
as $$
  select case
    when p_host in ('facebook.com', 'fb.com', 'fb.watch')
      or p_host like '%.facebook.com' or p_host like '%.fb.com' or p_host like '%.fb.watch'
      then 'facebook'
    when p_host = 'instagram.com' or p_host like '%.instagram.com' then 'instagram'
    when p_host in ('youtube.com', 'youtu.be')
      or p_host like '%.youtube.com' or p_host like '%.youtu.be'
      then 'youtube'
    when p_host in ('x.com', 'twitter.com') or p_host like '%.x.com' or p_host like '%.twitter.com'
      then 'x'
    when p_host = 'linkedin.com' or p_host like '%.linkedin.com' then 'linkedin'
    when p_host in ('t.me', 'telegram.me') then 'telegram'
  end
$$;

-- Azerbaijani lower case (I -> ı, İ -> i), whatever the database collation.
create or replace function public.az_lower(p_text text)
returns text
language sql
immutable
parallel safe
as $$
  select pg_catalog.lower(pg_catalog.translate(coalesce(p_text, ''), 'IİƏÖÜĞŞÇ', 'ıiəöüğşç'))
$$;

-- Edition in the link: /en/..., /ru/... first, then en.site.az. Null if none.
create or replace function public.url_language(p_url text)
returns text
language sql
immutable
parallel safe
as $$
  select coalesce(
    pg_catalog.lower(substring(p_url from '^[A-Za-z][A-Za-z0-9+.-]*://[^/?#]+/([Aa][Zz]|[Rr][Uu]|[Ee][Nn])(?:[/?#]|$)')),
    pg_catalog.lower(substring(p_url from '^[A-Za-z][A-Za-z0-9+.-]*://(?:[^/?#@]*@)?([Aa][Zz]|[Rr][Uu]|[Ee][Nn])\.[^/?#:.]+\.[^/?#:]+'))
  )
$$;

-- Same rules as apps/web/src/lib/news-language.ts: the title's script decides
-- first (a Latin title is never Russian, even under /ru/), then the link's
-- az/en edition, then the title's common words.
create or replace function public.news_language(p_title text, p_url text)
returns text
language sql
immutable
parallel safe
as $$
  select case
    when pg_catalog.regexp_count(coalesce(p_title, ''), '[Ѐ-ӿA-Za-zƏəİıĞğŞşÇçÖöÜü]') = 0
      then coalesce(public.url_language(p_url), 'az')
    when pg_catalog.regexp_count(coalesce(p_title, ''), '[Ѐ-ӿ]')
      > pg_catalog.regexp_count(coalesce(p_title, ''), '[A-Za-zƏəİıĞğŞşÇçÖöÜü]') then 'ru'
    when coalesce(p_title, '') ~ '[əƏ]' then 'az'
    when public.url_language(p_url) in ('az', 'en') then public.url_language(p_url)
    when pg_catalog.regexp_count(public.az_lower(p_title),
        '(?<![a-zəıöüğşç])(the|of|and|in|to|for|on|with|is|at|by|from|as|after|over|new|says|will|has|are|was)(?![a-zəıöüğşç])')
      > pg_catalog.regexp_count(public.az_lower(p_title),
        '(?<![a-zəıöüğşç])(və|bu|üçün|ilə|bir|də|da|olub|edib|oldu|görə|qədər|haqqında|olacaq|ki|çox|daha|yeni|ilk|son)(?![a-zəıöüğşç])')
      then 'en'
    else 'az'
  end
$$;

-- Stored once per article, so filtering by site or network does no string
-- work per request. Adding stored columns rewrites monitored_items once
-- (seconds at current size); the workers' inserts wait for it, nothing fails.
alter table public.monitored_items
  add column if not exists link_host text
    generated always as (public.url_host(url)) stored,
  add column if not exists link_network text
    generated always as (public.url_social_network(public.url_host(url))) stored;

-- The caller's matches of the last p_days days (31 at most, the retention
-- window), one row per match, with what the filters need.
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
  network text
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
    item.link_network
  from public.user_monitors monitor
  join public.monitor_matches match on match.monitor_id = monitor.id
  left join public.monitored_items item on item.id = match.item_id
  where monitor.user_id = (select auth.uid())
    and match.created_at >= now() - interval '31 days'
    and coalesce(item.detected_at, match.created_at, item.published_at)
      >= now() - make_interval(days => least(greatest(coalesce(p_days, 31), 1), 31));
$$;

revoke all on function public.my_result_matches(integer) from public, anon, authenticated;

-- One page of results. Filters work like the old browser filters: the
-- matches are filtered first, then one article is one result with all its
-- keywords. Newest first. p_limit is capped at 5000 (the export uses it).
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
  p_offset integer default 0
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
      max(m.detected_at) as detected_at
    from filtered m
    group by m.item_id
  ),
  page as (
    select *
    from items
    order by created_at desc, item_id
    limit least(greatest(coalesce(p_limit, 12), 1), 5000)
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select jsonb_build_object(
    'total', (select count(*) from items),
    'media', (select count(distinct host) from filtered where host <> '-'),
    'keywords', (select count(distinct matched_keyword) from filtered),
    'rows', coalesce(
      (select jsonb_agg(to_jsonb(page) order by page.created_at desc, page.item_id) from page),
      '[]'::jsonb
    )
  );
$$;

revoke all on function public.my_results_page(integer, text, text[], text, text, text, text, date, integer, integer) from public, anon;
grant execute on function public.my_results_page(integer, text, text[], text, text, text, text, date, integer, integer) to authenticated;

-- Choices for the keyword, site and network filters in the chosen period.
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

-- News map input: the newest 3000 matches with only the fields it groups by.
create or replace function public.my_story_matches()
returns table (
  id uuid,
  item_id uuid,
  matched_keyword text,
  created_at timestamptz,
  title text,
  url text,
  published_at timestamptz,
  detected_at timestamptz
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
    item.detected_at
  from public.user_monitors monitor
  join public.monitor_matches match on match.monitor_id = monitor.id
  join public.monitored_items item on item.id = match.item_id
  where monitor.user_id = (select auth.uid())
    and match.created_at >= now() - interval '31 days'
  order by match.created_at desc
  limit 3000;
$$;

revoke all on function public.my_story_matches() from public, anon;
grant execute on function public.my_story_matches() to authenticated;
