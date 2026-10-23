-- Social posts only about Azerbaijan, and X + LinkedIn keyword search. Idempotent.
--
-- 1. monitor_keywords.az_only (default on, also for existing keywords) and
--    exclude_words: the social collector drops a post with no Azerbaijani
--    signal for an az_only keyword, and any post containing an exclude word.
--    News sites are not filtered. Customers change both through
--    set_keyword_filters() (direct keyword writes are blocked).
-- 2. social_settings: X and LinkedIn switches (off), per-search post caps,
--    floor intervals and monthly budgets. Both use Apify actors.
-- 3. social_keyword_state may hold platform 'x' and 'linkedin'.
-- 4. One sources row each; posts hang off them like other social posts.
-- Plans get X or LinkedIn only when the admin ticks them in the plan form
-- (limits.social_platforms); no plan is changed here.

-- 1. Keyword filters ----------------------------------------------------------
alter table public.monitor_keywords
  add column if not exists az_only boolean not null default true,
  add column if not exists exclude_words text[] not null default '{}';

alter table public.monitor_keywords
  drop constraint if exists monitor_keywords_exclude_words_check,
  add constraint monitor_keywords_exclude_words_check
    check (cardinality(exclude_words) <= 20);

create or replace function public.set_keyword_filters(
  p_keyword_id uuid,
  p_az_only boolean,
  p_exclude_words text[]
)
returns public.monitor_keywords
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_words text[];
  v_row public.monitor_keywords;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  -- Trimmed, non-empty, unique (case-insensitive), first 20, at most 60 characters each.
  select coalesce(array_agg(word order by first_position), '{}')
  into v_words
  from (
    select min(position) as first_position, min(word) as word
    from (
      select pg_catalog.btrim(item) as word, position
      from unnest(coalesce(p_exclude_words, '{}'::text[])) with ordinality as input(item, position)
    ) trimmed
    where word <> ''
    group by pg_catalog.lower(word)
  ) unique_words;

  if cardinality(v_words) > 20 then
    raise exception 'EXCLUDE_WORDS_TOO_MANY' using errcode = 'P0001';
  end if;
  if exists (select 1 from unnest(v_words) word where pg_catalog.char_length(word) > 60) then
    raise exception 'EXCLUDE_WORD_TOO_LONG' using errcode = 'P0001';
  end if;

  update public.monitor_keywords keyword
  set az_only = coalesce(p_az_only, true),
      exclude_words = v_words
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

revoke all on function public.set_keyword_filters(uuid, boolean, text[]) from public, anon;
grant execute on function public.set_keyword_filters(uuid, boolean, text[]) to authenticated;

-- 2. Settings ----------------------------------------------------------------
alter table public.social_settings
  add column if not exists x_enabled boolean not null default false,
  add column if not exists x_max_posts_per_query integer not null default 50,
  add column if not exists x_min_interval_minutes integer not null default 360,
  add column if not exists x_monthly_budget_usd numeric(10, 2),
  add column if not exists linkedin_enabled boolean not null default false,
  add column if not exists linkedin_max_posts_per_query integer not null default 10,
  add column if not exists linkedin_min_interval_minutes integer not null default 720,
  add column if not exists linkedin_monthly_budget_usd numeric(10, 2);

alter table public.social_settings
  drop constraint if exists social_settings_x_linkedin_check,
  add constraint social_settings_x_linkedin_check
    check (
      x_max_posts_per_query between 1 and 200
      and x_min_interval_minutes between 10 and 10080
      and (x_monthly_budget_usd is null or x_monthly_budget_usd >= 0)
      and linkedin_max_posts_per_query between 1 and 100
      and linkedin_min_interval_minutes between 10 and 10080
      and (linkedin_monthly_budget_usd is null or linkedin_monthly_budget_usd >= 0)
    );

-- 3. Keyword state ------------------------------------------------------------
alter table public.social_keyword_state
  drop constraint if exists social_keyword_state_platform_check,
  add constraint social_keyword_state_platform_check
    check (platform in ('facebook', 'instagram', 'youtube', 'x', 'linkedin'));

-- 4. Sources rows -------------------------------------------------------------
insert into public.sources (name, base_url, source_type, status, monitor_method, notes)
values
  ('X', 'https://x.com', 'x', 'social', 'social', 'Social collector (Apify apidojo/tweet-scraper). Not crawled by the rss worker.'),
  ('LinkedIn', 'https://www.linkedin.com', 'linkedin', 'social', 'social', 'Social collector (Apify harvestapi/linkedin-post-search). Not crawled by the rss worker.')
on conflict (base_url) do update
  set source_type = excluded.source_type,
      status = excluded.status,
      monitor_method = excluded.monitor_method;
