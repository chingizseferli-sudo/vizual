-- Facebook cost controls. The Apify actor bills per delivered post, so the cost
-- grows with how often a keyword is searched and how many posts one search may
-- return. Admins set a floor interval, a per-search and a per-day post cap, an
-- exact-text filter, and a monthly budget per platform. Idempotent.

alter table public.social_settings
  add column if not exists fb_must_contain_query boolean not null default true,
  add column if not exists fb_min_interval_minutes integer not null default 360,
  add column if not exists fb_max_posts_per_query integer not null default 10,
  add column if not exists fb_daily_posts_per_keyword integer default 30,
  add column if not exists facebook_monthly_budget_usd numeric(10, 2),
  add column if not exists instagram_monthly_budget_usd numeric(10, 2);

alter table public.social_settings
  drop constraint if exists social_settings_fb_min_interval_check,
  add constraint social_settings_fb_min_interval_check
    check (fb_min_interval_minutes between 10 and 10080),
  drop constraint if exists social_settings_fb_max_posts_check,
  add constraint social_settings_fb_max_posts_check
    check (fb_max_posts_per_query between 1 and 50),
  drop constraint if exists social_settings_fb_daily_posts_check,
  add constraint social_settings_fb_daily_posts_check
    check (fb_daily_posts_per_keyword is null or fb_daily_posts_per_keyword between 1 and 1000),
  drop constraint if exists social_settings_platform_budgets_check,
  add constraint social_settings_platform_budgets_check
    check (
      (facebook_monthly_budget_usd is null or facebook_monthly_budget_usd >= 0)
      and (instagram_monthly_budget_usd is null or instagram_monthly_budget_usd >= 0)
    );
