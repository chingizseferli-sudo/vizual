-- YouTube keyword search (official YouTube Data API v3) and a per-plan list of
-- social networks. Idempotent.
--
-- 1. social_settings: YouTube switch (off by default), the daily quota the
--    collector may spend (Google gives 10 000 units a day; one search is 100)
--    and a floor interval per keyword.
-- 2. social_keyword_state may hold platform 'youtube'.
-- 3. One sources row for YouTube; videos hang off it like other social posts.
-- 4. subscription_plans.limits.social_platforms: networks the plan's social
--    keywords are searched on. Unset = Facebook + Instagram (as before).
--    Biznes gets YouTube too, only where the admin has not set it already.

-- 1. Settings ----------------------------------------------------------------
alter table public.social_settings
  add column if not exists youtube_enabled boolean not null default false,
  add column if not exists youtube_daily_quota integer not null default 9000,
  add column if not exists youtube_min_interval_minutes integer not null default 360;

alter table public.social_settings
  drop constraint if exists social_settings_youtube_quota_check,
  add constraint social_settings_youtube_quota_check
    check (youtube_daily_quota > 0),
  drop constraint if exists social_settings_youtube_interval_check,
  add constraint social_settings_youtube_interval_check
    check (youtube_min_interval_minutes between 10 and 10080);

-- 2. Keyword state ------------------------------------------------------------
alter table public.social_keyword_state
  drop constraint if exists social_keyword_state_platform_check,
  add constraint social_keyword_state_platform_check
    check (platform in ('facebook', 'instagram', 'youtube'));

-- 3. Sources row --------------------------------------------------------------
insert into public.sources (name, base_url, source_type, status, monitor_method, notes)
values ('YouTube', 'https://www.youtube.com', 'youtube', 'social', 'social', 'Social collector (YouTube Data API v3). Not crawled by the rss worker.')
on conflict (base_url) do update
  set source_type = excluded.source_type,
      status = excluded.status,
      monitor_method = excluded.monitor_method;

-- 4. Plans --------------------------------------------------------------------
update public.subscription_plans
set limits = coalesce(limits, '{}'::jsonb) || '{"social_platforms": ["facebook", "instagram", "youtube"]}'::jsonb,
    updated_at = now()
where code = 'business'
  and not (coalesce(limits, '{}'::jsonb) ? 'social_platforms');
