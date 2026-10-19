-- Assign existing admin/global Change Monitor watches to the chingizseferli customer account.
-- This preserves existing snapshots/events because source ids remain unchanged.
-- Duplicate watches already owned by the user are skipped to avoid unique-index conflicts.

begin;

do $$
declare
  v_user_id uuid;
  v_assigned_count integer := 0;
  v_skipped_duplicate_count integer := 0;
begin
  select profile.user_id
    into v_user_id
  from public.user_profiles profile
  where lower(profile.email) = lower('chingizseferli@gmail.com')
    and coalesce(profile.status, 'active') = 'active'
  limit 1;

  if v_user_id is null then
    raise exception 'Customer profile not found or inactive: chingizseferli@gmail.com';
  end if;

  select count(*)
    into v_skipped_duplicate_count
  from public.change_sources global_source
  where global_source.user_id is null
    and exists (
      select 1
      from public.change_sources owned_source
      where owned_source.user_id = v_user_id
        and coalesce(owned_source.url, '') = coalesce(global_source.url, '')
        and coalesce(owned_source.selector, '') = coalesce(global_source.selector, '')
    );

  update public.change_sources global_source
     set user_id = v_user_id,
         updated_at = now()
   where global_source.user_id is null
     and not exists (
       select 1
       from public.change_sources owned_source
       where owned_source.user_id = v_user_id
         and coalesce(owned_source.url, '') = coalesce(global_source.url, '')
         and coalesce(owned_source.selector, '') = coalesce(global_source.selector, '')
     );

  get diagnostics v_assigned_count = row_count;

  raise notice 'Assigned % global watches to chingizseferli@gmail.com. Skipped % duplicates.', v_assigned_count, v_skipped_duplicate_count;
end $$;

commit;