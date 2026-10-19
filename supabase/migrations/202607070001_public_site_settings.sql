create table if not exists public.public_site_settings (
  id text primary key default 'main',
  site_name text not null default 'Vizual.Az',
  site_url text not null default 'https://vizual.az',
  logo_url text not null default '/images/vizual-logo.svg',
  icon_url text not null default '/images/vizual-icon.svg',
  seo_title text not null default U&'Vizual.Az - Kommunikasiya v\0259 Media Monitorinq Platformas\0131',
  seo_description text not null default U&'Media m\0259nb\0259l\0259rind\0259 yay\0131mlanan materiallar\0131, vebsayt d\0259yi\015fiklikl\0259rini v\0259 t\0259\015fkilat\0131n\0131z haqq\0131nda vacib m\0259lumatlar\0131 bir platformadan izl\0259yin.',
  og_title text not null default 'Vizual.Az',
  og_description text not null default U&'Media monitorinqi, vebsayt d\0259yi\015fiklikl\0259ri v\0259 vacib bildiri\015fl\0259r bir platformada.',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint public_site_settings_singleton check (id = 'main')
);

insert into public.public_site_settings (id)
values ('main')
on conflict (id) do nothing;

alter table public.public_site_settings enable row level security;

create or replace function public.is_admin_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_profiles
    where user_id = auth.uid()
      and role in ('admin', 'superadmin')
      and coalesce(status, 'active') = 'active'
  );
$$;

drop policy if exists "Public can read public site settings" on public.public_site_settings;
drop policy if exists "Admins can manage public site settings" on public.public_site_settings;

create policy "Public can read public site settings"
on public.public_site_settings
for select
to anon, authenticated
using (true);

create policy "Admins can manage public site settings"
on public.public_site_settings
for all
to authenticated
using (public.is_admin_user())
with check (public.is_admin_user());

revoke insert, update, delete on public.public_site_settings from anon;
grant select on public.public_site_settings to anon, authenticated;
grant insert, update, delete on public.public_site_settings to authenticated;
