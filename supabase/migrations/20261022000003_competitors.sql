-- Competitors ("Rəqiblər"): a customer names competitors (up to 3 keywords
-- each); the rss worker records news-site articles that mention them, an AI
-- model labels each headline's tone once (shared by every customer), and once a
-- day writes a short comparison of the customer's own keywords vs competitors.
--
-- 1. subscription_plans.limits.max_competitors: Pro 3, Business and Enterprise 5,
--    others 0 (Demo, Başlanğıc).
-- 2. competitors (customer-owned), competitor_matches (worker-written),
--    competitor_insights (daily AI summary), monitored_items.ai_* (tone cache).
-- 3. Customers write competitors only through add_competitor(),
--    update_competitor() and delete_competitor(); reads are RLS-scoped.
-- 4. competitor_stats() feeds the page and the worker's daily summary.
-- 5. Retention: competitor rows go with their items (30 days); insights too.
-- Idempotent.

-- 1. Plan limit -----------------------------------------------------------------

update public.subscription_plans
set limits = coalesce(limits, '{}'::jsonb) || jsonb_build_object('max_competitors', 3), updated_at = now()
where code = 'pro' and not (coalesce(limits, '{}'::jsonb) ? 'max_competitors');

update public.subscription_plans
set limits = coalesce(limits, '{}'::jsonb) || jsonb_build_object('max_competitors', 5), updated_at = now()
where code in ('business', 'enterprise') and not (coalesce(limits, '{}'::jsonb) ? 'max_competitors');

-- Competitors a user may track: plan limits.max_competitors, else 0. Admins are
-- unlimited (null). Internal only.
create or replace function public.competitor_limit_for_user(p_user_id uuid)
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
    else coalesce((
      select case when (p.limits ->> 'max_competitors') ~ '^\d+$' then (p.limits ->> 'max_competitors')::integer end
      from public.subscription_plans p
      where p.id = coalesce(
        (select profile.plan_id from public.user_profiles profile where profile.user_id = p_user_id),
        (select free_plan.id from public.subscription_plans free_plan where free_plan.code = 'free' limit 1)
      )
    ), 0)
  end;
$$;

revoke all on function public.competitor_limit_for_user(uuid) from public, anon, authenticated;

create or replace function public.current_user_competitor_limit()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select public.competitor_limit_for_user((select auth.uid()));
$$;

revoke all on function public.current_user_competitor_limit() from public, anon;
grant execute on function public.current_user_competitor_limit() to authenticated;

-- 2. Tables ----------------------------------------------------------------------

create table if not exists public.competitors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  keywords text[] not null check (cardinality(keywords) between 1 and 3),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists competitors_user_name_key
  on public.competitors (user_id, lower(name));

create table if not exists public.competitor_matches (
  competitor_id uuid not null references public.competitors (id) on delete cascade,
  item_id uuid not null references public.monitored_items (id) on delete cascade,
  matched_keyword text,
  created_at timestamptz not null default now(),
  primary key (competitor_id, item_id)
);

create index if not exists competitor_matches_item_idx on public.competitor_matches (item_id);

create table if not exists public.competitor_insights (
  user_id uuid not null references auth.users (id) on delete cascade,
  insight_date date not null,
  summary text,
  stats jsonb not null default '[]'::jsonb,
  model text,
  created_at timestamptz not null default now(),
  primary key (user_id, insight_date)
);

-- Headline tone, set once per article by the worker (shared by all customers).
alter table public.monitored_items
  add column if not exists ai_sentiment text,
  add column if not exists ai_topic text,
  add column if not exists ai_classified_at timestamptz;

alter table public.monitored_items
  drop constraint if exists monitored_items_ai_sentiment_check,
  add constraint monitored_items_ai_sentiment_check
    check (ai_sentiment is null or ai_sentiment in ('positive', 'neutral', 'negative'));

create index if not exists monitored_items_ai_pending_idx
  on public.monitored_items (detected_at desc) where ai_classified_at is null;

-- 3. Access -----------------------------------------------------------------------

alter table public.competitors enable row level security;
alter table public.competitor_matches enable row level security;
alter table public.competitor_insights enable row level security;

revoke all on public.competitors, public.competitor_matches, public.competitor_insights from anon;
revoke insert, update, delete on public.competitors, public.competitor_matches, public.competitor_insights from authenticated;
grant select on public.competitors, public.competitor_matches, public.competitor_insights to authenticated;
grant all on public.competitors, public.competitor_matches, public.competitor_insights to service_role;

drop policy if exists competitors_select_own on public.competitors;
create policy competitors_select_own
on public.competitors
for select
to authenticated
using (user_id = (select auth.uid()) or public.is_admin_user());

drop policy if exists competitor_matches_select_own on public.competitor_matches;
create policy competitor_matches_select_own
on public.competitor_matches
for select
to authenticated
using (
  exists (
    select 1 from public.competitors competitor
    where competitor.id = competitor_matches.competitor_id
      and (competitor.user_id = (select auth.uid()) or public.is_admin_user())
  )
);

drop policy if exists competitor_insights_select_own on public.competitor_insights;
create policy competitor_insights_select_own
on public.competitor_insights
for select
to authenticated
using (user_id = (select auth.uid()) or public.is_admin_user());

-- Customers also read the articles that mention their competitors.
drop policy if exists monitored_items_select_own_competitor_matches on public.monitored_items;
create policy monitored_items_select_own_competitor_matches
on public.monitored_items
for select
to authenticated
using (
  exists (
    select 1
    from public.competitor_matches match
    join public.competitors competitor on competitor.id = match.competitor_id
    where match.item_id = monitored_items.id
      and competitor.user_id = (select auth.uid())
  )
);

-- Name 1-80 characters; 1-3 distinct keywords of 2-100 characters each.
create or replace function public.clean_competitor_input(p_name text, p_keywords text[])
returns table (name text, keywords text[])
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_keywords text[];
begin
  if char_length(v_name) not between 1 and 80 then
    raise exception 'COMPETITOR_NAME_INVALID' using errcode = '22023';
  end if;

  select coalesce(array_agg(keyword order by ord), '{}')
  into v_keywords
  from (
    select distinct on (lower(btrim(raw))) btrim(raw) as keyword, ord
    from unnest(coalesce(p_keywords, '{}'::text[])) with ordinality as input(raw, ord)
    where btrim(raw) <> ''
    order by lower(btrim(raw)), ord
  ) cleaned;

  if cardinality(v_keywords) = 0 then
    v_keywords := array[v_name];
  end if;

  if cardinality(v_keywords) > 3 then
    raise exception 'COMPETITOR_KEYWORDS_TOO_MANY' using errcode = '22023';
  end if;

  if exists (select 1 from unnest(v_keywords) keyword where char_length(keyword) not between 2 and 100) then
    raise exception 'COMPETITOR_KEYWORD_INVALID' using errcode = '22023';
  end if;

  return query select v_name, v_keywords;
end;
$$;

revoke all on function public.clean_competitor_input(text, text[]) from public, anon, authenticated;

create or replace function public.add_competitor(p_name text, p_keywords text[])
returns public.competitors
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_limit integer;
  v_input record;
  v_row public.competitors;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  select * into v_input from public.clean_competitor_input(p_name, p_keywords);

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('competitors:' || v_user_id::text));

  if not public.is_admin_user()
     and (select state.status from public.current_user_account_state() state) is distinct from 'active' then
    raise exception 'ACCOUNT_NOT_ACTIVE' using errcode = '42501';
  end if;

  v_limit := public.competitor_limit_for_user(v_user_id);
  if v_limit is not null
     and (select count(*) from public.competitors competitor where competitor.user_id = v_user_id) >= v_limit then
    raise exception 'PLAN_COMPETITOR_LIMIT_REACHED' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.competitors competitor
    where competitor.user_id = v_user_id and lower(competitor.name) = lower(v_input.name)
  ) then
    raise exception 'COMPETITOR_EXISTS' using errcode = '23505';
  end if;

  insert into public.competitors (user_id, name, keywords)
  values (v_user_id, v_input.name, v_input.keywords)
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.add_competitor(text, text[]) from public, anon;
grant execute on function public.add_competitor(text, text[]) to authenticated;

create or replace function public.update_competitor(p_competitor_id uuid, p_name text, p_keywords text[])
returns public.competitors
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_input record;
  v_row public.competitors;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  select * into v_input from public.clean_competitor_input(p_name, p_keywords);

  if exists (
    select 1 from public.competitors competitor
    where competitor.user_id = v_user_id
      and competitor.id <> p_competitor_id
      and lower(competitor.name) = lower(v_input.name)
  ) then
    raise exception 'COMPETITOR_EXISTS' using errcode = '23505';
  end if;

  update public.competitors competitor
  set name = v_input.name, keywords = v_input.keywords, updated_at = now()
  where competitor.id = p_competitor_id and competitor.user_id = v_user_id
  returning * into v_row;

  if v_row.id is null then
    raise exception 'COMPETITOR_NOT_FOUND' using errcode = 'P0002';
  end if;

  return v_row;
end;
$$;

revoke all on function public.update_competitor(uuid, text, text[]) from public, anon;
grant execute on function public.update_competitor(uuid, text, text[]) to authenticated;

create or replace function public.delete_competitor(p_competitor_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  delete from public.competitors competitor
  where competitor.id = p_competitor_id and competitor.user_id = (select auth.uid());

  if not found then
    raise exception 'COMPETITOR_NOT_FOUND' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.delete_competitor(uuid) from public, anon;
grant execute on function public.delete_competitor(uuid) to authenticated;

-- 4. Worker and page helpers -------------------------------------------------------

-- Keywords the worker tracks: active accounts only, and only the oldest
-- competitors that fit the current plan (a downgrade pauses the rest).
create or replace function public.competitor_keywords_for_worker()
returns table (competitor_id uuid, user_id uuid, keyword text)
language sql
stable
security definer
set search_path = ''
as $$
  with ranked as (
    select
      competitor.*,
      row_number() over (partition by competitor.user_id order by competitor.created_at, competitor.id) as position,
      public.competitor_limit_for_user(competitor.user_id) as max_competitors
    from public.competitors competitor
    join public.user_profiles profile on profile.user_id = competitor.user_id
    where coalesce(profile.status, 'active') = 'active'
  )
  select ranked.id, ranked.user_id, keyword
  from ranked, unnest(ranked.keywords) keyword
  where ranked.max_competitors is null or ranked.position <= ranked.max_competitors;
$$;

revoke all on function public.competitor_keywords_for_worker() from public, anon, authenticated;
grant execute on function public.competitor_keywords_for_worker() to service_role;

-- Mention counts and tone per entity for the last p_days: the customer's own
-- keywords (kind 'own') and each competitor. Internal; the page calls
-- my_competitor_stats().
create or replace function public.competitor_stats(p_user_id uuid, p_days integer default 7)
returns table (
  kind text,
  competitor_id uuid,
  name text,
  mentions integer,
  positive integer,
  neutral integer,
  negative integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with since as (
    select now() - make_interval(days => least(greatest(coalesce(p_days, 7), 1), 30)) as since_at
  ),
  own_items as (
    select distinct item.id, item.ai_sentiment
    from public.monitor_matches match
    join public.user_monitors monitor on monitor.id = match.monitor_id
    join public.monitored_items item on item.id = match.item_id
    where monitor.user_id = p_user_id
      and coalesce(item.detected_at, item.created_at) >= (select since_at from since)
  ),
  competitor_items as (
    select competitor.id as competitor_id, item.ai_sentiment
    from public.competitors competitor
    join public.competitor_matches match on match.competitor_id = competitor.id
    join public.monitored_items item on item.id = match.item_id
    where competitor.user_id = p_user_id
      and coalesce(item.detected_at, item.created_at) >= (select since_at from since)
  )
  select
    'own'::text, null::uuid, null::text,
    count(*)::integer,
    count(*) filter (where ai_sentiment = 'positive')::integer,
    count(*) filter (where ai_sentiment = 'neutral')::integer,
    count(*) filter (where ai_sentiment = 'negative')::integer
  from own_items
  union all
  select
    'competitor'::text, competitor.id, competitor.name,
    count(item.competitor_id)::integer,
    count(*) filter (where item.ai_sentiment = 'positive')::integer,
    count(*) filter (where item.ai_sentiment = 'neutral')::integer,
    count(*) filter (where item.ai_sentiment = 'negative')::integer
  from public.competitors competitor
  left join competitor_items item on item.competitor_id = competitor.id
  where competitor.user_id = p_user_id
  group by competitor.id, competitor.name, competitor.created_at
$$;

revoke all on function public.competitor_stats(uuid, integer) from public, anon, authenticated;
grant execute on function public.competitor_stats(uuid, integer) to service_role;

create or replace function public.my_competitor_stats(p_days integer default 7)
returns table (
  kind text,
  competitor_id uuid,
  name text,
  mentions integer,
  positive integer,
  neutral integer,
  negative integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.competitor_stats((select auth.uid()), p_days);
$$;

revoke all on function public.my_competitor_stats(integer) from public, anon;
grant execute on function public.my_competitor_stats(integer) to authenticated;

-- Articles waiting for a tone label: recent, and matched by a customer who
-- tracks competitors (their own matches) or by a competitor.
create or replace function public.items_needing_sentiment(p_limit integer default 200)
returns table (id uuid, title text)
language sql
stable
security definer
set search_path = ''
as $$
  select item.id, item.title
  from public.monitored_items item
  where item.ai_classified_at is null
    and coalesce(item.detected_at, item.created_at) >= now() - interval '2 days'
    and (
      exists (select 1 from public.competitor_matches match where match.item_id = item.id)
      or exists (
        select 1
        from public.monitor_matches match
        join public.user_monitors monitor on monitor.id = match.monitor_id
        join public.competitors competitor on competitor.user_id = monitor.user_id
        where match.item_id = item.id
      )
    )
  order by coalesce(item.detected_at, item.created_at) desc
  limit least(greatest(coalesce(p_limit, 200), 1), 500);
$$;

revoke all on function public.items_needing_sentiment(integer) from public, anon, authenticated;
grant execute on function public.items_needing_sentiment(integer) to service_role;

-- 5. Retention ------------------------------------------------------------------------

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

  -- competitor_matches go with their items (on delete cascade).
  delete from public.monitored_items
  where coalesce(detected_at, published_at, now()) < cutoff_time;

  delete from public.competitor_insights
  where insight_date < (cutoff_time at time zone 'Asia/Baku')::date;
end;
$$;

revoke all on function public.cleanup_old_monitor_data(integer) from public, anon, authenticated;
grant execute on function public.cleanup_old_monitor_data(integer) to service_role;
