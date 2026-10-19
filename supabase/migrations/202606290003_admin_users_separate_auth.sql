-- Separate admin panel authorization from customer workspace profiles.
-- Supabase Auth remains the identity provider; admin access is granted by public.admin_users.

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  role text not null default 'admin' check (role in ('admin', 'superadmin')),
  status text not null default 'active' check (status in ('active', 'inactive', 'blocked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists admin_users_email_idx on public.admin_users (lower(email));
create index if not exists admin_users_role_status_idx on public.admin_users (role, status);

insert into public.admin_users (user_id, email, role, status)
select
  profile.user_id,
  profile.email,
  case
    when profile.role = 'superadmin' then 'superadmin'
    else 'admin'
  end as role,
  case
    when profile.status in ('active', 'inactive', 'blocked') then profile.status
    else 'active'
  end as status
from public.user_profiles as profile
where profile.role in ('admin', 'superadmin')
on conflict (user_id) do update set
  email = excluded.email,
  role = excluded.role,
  status = excluded.status,
  updated_at = now();

create or replace function public.set_admin_users_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_admin_users_updated_at_trigger on public.admin_users;
create trigger set_admin_users_updated_at_trigger
before update on public.admin_users
for each row
execute function public.set_admin_users_updated_at();

alter table public.admin_users enable row level security;

create or replace function public.is_admin_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users admin_user
    where admin_user.user_id = auth.uid()
      and admin_user.status = 'active'
      and admin_user.role in ('admin', 'superadmin')
  );
$$;

grant execute on function public.is_admin_user() to authenticated;

revoke all on public.admin_users from anon;
revoke all on public.admin_users from authenticated;
grant select, insert, update, delete on public.admin_users to authenticated;

drop policy if exists admin_users_select_self on public.admin_users;
drop policy if exists admin_users_admin_manage on public.admin_users;

create policy admin_users_select_self
on public.admin_users
for select
to authenticated
using (user_id = auth.uid());

create policy admin_users_admin_manage
on public.admin_users
for all
to authenticated
using (public.is_admin_user())
with check (public.is_admin_user());
