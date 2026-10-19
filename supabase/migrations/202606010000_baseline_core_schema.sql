-- Baseline: core tables that production created in the dashboard, never in a migration.
-- Columns, defaults and policies follow the production schema read on 2026-10-18.
-- Every later migration in this folder runs on top of this file, so a fresh
-- project is built with `supabase db push` alone. Idempotent.

-- Profiles -------------------------------------------------------------------

create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text,
  telegram_chat_id text,
  role text not null default 'customer',
  status text not null default 'active',
  plan_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_profiles_telegram_chat_id_idx
  on public.user_profiles (telegram_chat_id) where telegram_chat_id is not null;

-- Replaced by the admin_users-based version in later migrations.
create or replace function public.is_admin_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_profiles profile
    where profile.user_id = auth.uid()
      and profile.status = 'active'
      and profile.role in ('admin', 'superadmin')
  );
$$;

-- Every new auth user gets a customer profile.
create or replace function public.handle_new_auth_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_profiles (user_id, email)
  values (new.id, new.email)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke execute on function public.handle_new_auth_user_profile() from public, anon, authenticated;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
after insert on auth.users
for each row
execute function public.handle_new_auth_user_profile();

-- News sources and collected items ---------------------------------------------

create table if not exists public.sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  base_url text not null,
  latest_url text,
  rss_url text,
  source_type text default 'news_site',
  status text default 'active',
  trust_level text default 'medium',
  check_interval_minutes integer default 5,
  monitor_method text default 'auto',
  selector text,
  article_pattern text,
  discovery_status text default 'pending',
  discovery_score integer default 0,
  last_discovered_at timestamptz,
  notes text,
  last_checked_at timestamptz,
  last_success_at timestamptz,
  last_article_found_at timestamptz,
  last_error text,
  last_result text,
  consecutive_fail_count integer not null default 0,
  review_status text,
  review_reason text,
  reviewed_at timestamptz,
  created_at timestamptz default now()
);

-- sync_sources_to_supabase upserts with on_conflict=base_url.
create unique index if not exists sources_base_url_key on public.sources (base_url);
create index if not exists sources_status_idx on public.sources (status);

create table if not exists public.monitored_items (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references public.sources (id) on delete cascade,
  title text not null,
  url text not null,
  published_at timestamptz,
  detected_at timestamptz default now(),
  item_hash text,
  status text default 'new',
  created_at timestamptz default now()
);

-- The worker inserts with resolution=ignore-duplicates: the URL is the dedupe key.
create unique index if not exists monitored_items_url_key on public.monitored_items (url);
create index if not exists monitored_items_source_created_idx
  on public.monitored_items (source_id, created_at desc);

create table if not exists public.sent_news (
  id uuid primary key default gen_random_uuid(),
  link text not null,
  title text,
  source text,
  source_id uuid references public.sources (id) on delete set null,
  created_at timestamptz default now()
);

create index if not exists sent_news_link_idx on public.sent_news (link);
create index if not exists sent_news_created_at_idx on public.sent_news (created_at desc);

create table if not exists public.discovery_logs (
  id uuid primary key default gen_random_uuid(),
  domain text not null,
  url text,
  status text not null,
  reason text,
  method text,
  score integer default 0,
  sample_links jsonb,
  created_at timestamptz default now()
);

create index if not exists discovery_logs_created_at_idx on public.discovery_logs (created_at desc);

create table if not exists public.rejected_sources (
  id uuid primary key default gen_random_uuid(),
  domain text not null,
  url text,
  reason text,
  checked_at timestamptz default now()
);

-- discovery_bot upserts with on_conflict=domain.
create unique index if not exists rejected_sources_domain_key on public.rejected_sources (domain);

-- Customer monitors ------------------------------------------------------------

create table if not exists public.user_monitors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  name text not null,
  description text,
  status text default 'active',
  notify_telegram boolean default true,
  telegram_chat_id text,
  created_at timestamptz default now()
);

create index if not exists user_monitors_user_id_idx on public.user_monitors (user_id);

create table if not exists public.monitor_keywords (
  id uuid primary key default gen_random_uuid(),
  monitor_id uuid references public.user_monitors (id) on delete cascade,
  keyword text not null,
  match_type text default 'phrase',
  created_at timestamptz default now()
);

create index if not exists monitor_keywords_monitor_id_idx on public.monitor_keywords (monitor_id);

create table if not exists public.monitor_matches (
  id uuid primary key default gen_random_uuid(),
  monitor_id uuid references public.user_monitors (id) on delete cascade,
  item_id uuid references public.monitored_items (id) on delete cascade,
  matched_keyword text,
  created_at timestamptz default now()
);

-- The worker inserts with resolution=ignore-duplicates: one match per monitor and item.
create unique index if not exists monitor_matches_monitor_item_key
  on public.monitor_matches (monitor_id, item_id);
create index if not exists monitor_matches_item_id_idx on public.monitor_matches (item_id);

create table if not exists public.monitor_alerts (
  id uuid primary key default gen_random_uuid(),
  match_id uuid references public.monitor_matches (id) on delete cascade,
  item_id uuid references public.monitored_items (id) on delete cascade,
  channel text default 'telegram',
  recipient text,
  status text default 'sent',
  sent_at timestamptz default now()
);

-- The worker treats 409 as "alert already exists".
create unique index if not exists monitor_alerts_match_id_key on public.monitor_alerts (match_id);

-- Page change monitor ----------------------------------------------------------

create table if not exists public.change_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  name text not null,
  url text not null,
  domain text not null,
  selector text,
  status text not null default 'active',
  interval_minutes integer not null default 5,
  next_check_at timestamptz,
  last_checked_at timestamptz,
  last_changed_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  consecutive_fail_count integer not null default 0,
  backoff_until timestamptz,
  content_hash text,
  etag text,
  last_modified text,
  telegram_chat_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists change_sources_due_idx on public.change_sources (status, next_check_at);

create table if not exists public.change_snapshots (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.change_sources (id) on delete cascade,
  content_text text,
  content_hash text not null,
  captured_at timestamptz not null default now(),
  response_status integer,
  response_time_ms integer
);

create index if not exists change_snapshots_source_captured_idx
  on public.change_snapshots (source_id, captured_at desc);

create table if not exists public.change_events (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.change_sources (id) on delete cascade,
  old_snapshot_id uuid references public.change_snapshots (id) on delete set null,
  new_snapshot_id uuid references public.change_snapshots (id) on delete set null,
  old_hash text,
  new_hash text,
  diff_summary text,
  created_at timestamptz not null default now()
);

create index if not exists change_events_source_created_idx
  on public.change_events (source_id, created_at desc);

create table if not exists public.change_alerts (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.change_events (id) on delete cascade,
  source_id uuid not null references public.change_sources (id) on delete cascade,
  telegram_chat_id text,
  status text not null default 'pending',
  sent_at timestamptz,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists change_alerts_status_idx on public.change_alerts (status, created_at);

-- Admin news editor ------------------------------------------------------------

create table if not exists public.news (
  id bigint generated by default as identity primary key,
  title text not null,
  summary text,
  content text,
  image_url text,
  source text,
  category text,
  status text default 'pending',
  slug text,
  featured boolean default false,
  views bigint default 0,
  published_at timestamptz,
  scheduled_at timestamptz,
  created_at timestamptz default timezone('utc', now())
);

-- Row level security -------------------------------------------------------------
-- Default deny on every table; later migrations add admin and tenant policies.

alter table public.user_profiles enable row level security;
alter table public.sources enable row level security;
alter table public.monitored_items enable row level security;
alter table public.sent_news enable row level security;
alter table public.discovery_logs enable row level security;
alter table public.rejected_sources enable row level security;
alter table public.user_monitors enable row level security;
alter table public.monitor_keywords enable row level security;
alter table public.monitor_matches enable row level security;
alter table public.monitor_alerts enable row level security;
alter table public.change_sources enable row level security;
alter table public.change_snapshots enable row level security;
alter table public.change_events enable row level security;
alter table public.change_alerts enable row level security;
alter table public.news enable row level security;

-- Customers manage their own monitors and keywords (production policies).
drop policy if exists "Allow authenticated users to read monitors" on public.user_monitors;
create policy "Allow authenticated users to read monitors"
  on public.user_monitors for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Allow authenticated users to insert monitors" on public.user_monitors;
create policy "Allow authenticated users to insert monitors"
  on public.user_monitors for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Allow authenticated users to update monitors" on public.user_monitors;
create policy "Allow authenticated users to update monitors"
  on public.user_monitors for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Allow authenticated users to delete monitors" on public.user_monitors;
create policy "Allow authenticated users to delete monitors"
  on public.user_monitors for delete to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can read own monitor keywords" on public.monitor_keywords;
create policy "Users can read own monitor keywords"
  on public.monitor_keywords for select to authenticated
  using (exists (
    select 1 from public.user_monitors m
    where m.id = monitor_keywords.monitor_id and m.user_id = auth.uid()
  ));

drop policy if exists "Users can insert own monitor keywords" on public.monitor_keywords;
create policy "Users can insert own monitor keywords"
  on public.monitor_keywords for insert to authenticated
  with check (exists (
    select 1 from public.user_monitors m
    where m.id = monitor_keywords.monitor_id and m.user_id = auth.uid()
  ));

drop policy if exists "Users can update own monitor keywords" on public.monitor_keywords;
create policy "Users can update own monitor keywords"
  on public.monitor_keywords for update to authenticated
  using (exists (
    select 1 from public.user_monitors m
    where m.id = monitor_keywords.monitor_id and m.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.user_monitors m
    where m.id = monitor_keywords.monitor_id and m.user_id = auth.uid()
  ));

drop policy if exists "Users can delete own monitor keywords" on public.monitor_keywords;
create policy "Users can delete own monitor keywords"
  on public.monitor_keywords for delete to authenticated
  using (exists (
    select 1 from public.user_monitors m
    where m.id = monitor_keywords.monitor_id and m.user_id = auth.uid()
  ));
