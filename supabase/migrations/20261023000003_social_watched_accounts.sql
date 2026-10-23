-- Watched Instagram pages and public Telegram channels (apps/worker/social).
--
-- Instagram has no keyword search, so posts without a hashtag are found by
-- reading chosen pages (news outlets) and matching captions ourselves. One
-- read per page serves every customer; alerts go only to keywords picked for
-- FB/IG, like hashtag results.
--
-- Telegram channels are read from the public t.me/s/<channel> preview (no key,
-- no cost) and treated as a news source: every customer's active keywords
-- match, like websites.
--
-- check_interval_minutes null = the platform default (Instagram 180, Telegram 10).
-- Each part has its own switch in social_settings. Idempotent.

create table if not exists public.social_watched_accounts (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('instagram', 'telegram')),
  handle text not null check (handle ~ '^[a-z0-9._]{1,64}$'),
  display_name text check (display_name is null or length(display_name) <= 120),
  active boolean not null default true,
  check_interval_minutes integer check (check_interval_minutes is null or check_interval_minutes between 5 and 10080),
  last_checked_at timestamptz,
  last_error text,
  last_post_count integer,
  last_stats jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (platform, handle)
);

alter table public.social_watched_accounts enable row level security;
revoke all on public.social_watched_accounts from anon;
grant select, insert, update, delete on public.social_watched_accounts to authenticated;

drop policy if exists social_watched_accounts_admin_all on public.social_watched_accounts;
create policy social_watched_accounts_admin_all
  on public.social_watched_accounts for all to authenticated
  using (public.is_admin_user())
  with check (public.is_admin_user());

drop trigger if exists social_watched_accounts_stamp_update_trigger on public.social_watched_accounts;
create trigger social_watched_accounts_stamp_update_trigger
  before update on public.social_watched_accounts
  for each row execute function public.social_settings_stamp_update();

alter table public.social_settings
  add column if not exists instagram_accounts_enabled boolean not null default false,
  add column if not exists telegram_channels_enabled boolean not null default false;

-- Telegram posts hang off one sources row, like Facebook and Instagram.
insert into public.sources (name, base_url, source_type, status, monitor_method, notes)
values ('Telegram', 'https://t.me', 'telegram', 'social', 'social', 'Public Telegram channels (t.me/s preview). Not crawled by the rss worker.')
on conflict (base_url) do update
  set source_type = excluded.source_type,
      status = excluded.status,
      monitor_method = excluded.monitor_method;

-- "Check now" for one page/channel, or all of a platform.
create or replace function public.admin_social_account_check_now(
  p_platform text default null,
  p_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed integer;
begin
  if not public.is_admin_user() then
    raise exception 'ADMIN_ACCESS_REQUIRED';
  end if;

  update public.social_watched_accounts
  set last_checked_at = null
  where (p_platform is null or platform = p_platform)
    and (p_id is null or id = p_id);
  get diagnostics changed = row_count;
  return changed;
end;
$$;

revoke execute on function public.admin_social_account_check_now(text, uuid) from public, anon;
grant execute on function public.admin_social_account_check_now(text, uuid) to authenticated;
