-- Change Monitor ownership cleanup hardening.
-- Adds a real auth.users foreign key for customer-owned watches and a safe
-- delete RPC that removes watch snapshots/events/alerts through existing
-- ON DELETE CASCADE relations.

begin;

alter table public.change_sources
  add column if not exists user_id uuid;

create index if not exists idx_change_sources_user_status
  on public.change_sources(user_id, status);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'change_sources_user_id_fkey'
      and conrelid = 'public.change_sources'::regclass
  ) then
    alter table public.change_sources
      add constraint change_sources_user_id_fkey
      foreign key (user_id)
      references auth.users(id)
      on delete cascade;
  end if;
end $$;

create or replace function public.delete_user_change_source(p_source_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source public.change_sources%rowtype;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select *
    into v_source
    from public.change_sources
   where id = p_source_id
   for update;

  if not found then
    raise exception 'CHANGE_SOURCE_NOT_FOUND';
  end if;

  if v_source.user_id is distinct from auth.uid()
     and not public.is_admin_user() then
    raise exception 'CHANGE_SOURCE_FORBIDDEN';
  end if;

  delete from public.change_sources
   where id = p_source_id;
end;
$$;

grant execute on function public.delete_user_change_source(uuid) to authenticated;

commit;

