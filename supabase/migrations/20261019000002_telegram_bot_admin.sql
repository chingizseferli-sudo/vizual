-- Telegram bot: one-time link tokens, global pause, worker runtime state.
--
-- STATUS: NOT APPLIED. Apply to STAGING first (see docs/SECURITY.md), then
-- production. Idempotent: safe to run more than once.
--
-- Linking used to be `/start <auth user uuid>`: anyone who learned a user's
-- UUID could receive that user's alerts. The profile page now asks
-- create_telegram_link_token() for a random, single-use, 15-minute token and
-- the rss worker (service role) redeems it.
--
-- Requires pgcrypto in the `extensions` schema (Supabase default).

begin;

-- ---------------------------------------------------------------------------
-- 1. One-time link tokens. Only the SECURITY DEFINER function and the
--    service-role worker touch this table: RLS on, no policies.
-- ---------------------------------------------------------------------------
create table if not exists public.telegram_link_tokens (
  token text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '15 minutes',
  used_at timestamptz,
  chat_id text
);

create index if not exists telegram_link_tokens_user_id_idx
  on public.telegram_link_tokens (user_id);

alter table public.telegram_link_tokens enable row level security;
revoke all on public.telegram_link_tokens from anon, authenticated;

create or replace function public.create_telegram_link_token()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  new_token text;
begin
  if current_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  -- One live token per user; also drops expired leftovers.
  delete from public.telegram_link_tokens link_token
  where link_token.user_id = current_user_id
    and link_token.used_at is null;

  new_token := encode(extensions.gen_random_bytes(16), 'hex');

  insert into public.telegram_link_tokens (token, user_id)
  values (new_token, current_user_id);

  return new_token;
end;
$$;

revoke all on function public.create_telegram_link_token() from public, anon;
grant execute on function public.create_telegram_link_token() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Global bot settings (singleton row). Admins read/update; worker reads
--    with the service role.
-- ---------------------------------------------------------------------------
create table if not exists public.bot_settings (
  id integer primary key default 1 check (id = 1),
  notifications_paused boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

insert into public.bot_settings (id) values (1) on conflict (id) do nothing;

alter table public.bot_settings enable row level security;
revoke all on public.bot_settings from anon;
revoke insert, delete, truncate on public.bot_settings from authenticated;
grant select, update on public.bot_settings to authenticated;

drop policy if exists bot_settings_admin_select on public.bot_settings;
drop policy if exists bot_settings_admin_update on public.bot_settings;

create policy bot_settings_admin_select
  on public.bot_settings
  for select
  to authenticated
  using (public.is_admin_user());

create policy bot_settings_admin_update
  on public.bot_settings
  for update
  to authenticated
  using (public.is_admin_user())
  with check (public.is_admin_user());

-- updated_at / updated_by are set server-side, not trusted from the client.
create or replace function public.bot_settings_stamp_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := (select auth.uid());
  return new;
end;
$$;

drop trigger if exists bot_settings_stamp_update_trigger on public.bot_settings;
create trigger bot_settings_stamp_update_trigger
  before update on public.bot_settings
  for each row
  execute function public.bot_settings_stamp_update();

-- ---------------------------------------------------------------------------
-- 3. Worker runtime state (getUpdates offset, heartbeat). Written by the
--    service-role worker only; admins read.
-- ---------------------------------------------------------------------------
create table if not exists public.bot_runtime_state (
  key text primary key,
  value jsonb,
  updated_at timestamptz not null default now()
);

alter table public.bot_runtime_state enable row level security;
revoke all on public.bot_runtime_state from anon;
revoke insert, update, delete, truncate on public.bot_runtime_state from authenticated;
grant select on public.bot_runtime_state to authenticated;

drop policy if exists bot_runtime_state_admin_select on public.bot_runtime_state;

create policy bot_runtime_state_admin_select
  on public.bot_runtime_state
  for select
  to authenticated
  using (public.is_admin_user());

-- Admin page counts linked users with a head-only count on this column.
create index if not exists user_profiles_telegram_chat_id_idx
  on public.user_profiles (telegram_chat_id)
  where telegram_chat_id is not null;

commit;
