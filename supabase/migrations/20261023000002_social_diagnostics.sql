-- Social collector diagnostics: what happened to the posts of each keyword's
-- last search (returned, too old, not matching, already stored, new, alerted),
-- and an admin "check now" that makes the next tick search a keyword again.

alter table public.social_keyword_state
  add column if not exists last_stats jsonb;

create or replace function public.admin_social_check_now(
  p_platform text default null,
  p_keyword_fold text default null
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

  update public.social_keyword_state
  set last_checked_at = null
  where (p_platform is null or platform = p_platform)
    and (p_keyword_fold is null or keyword_fold = p_keyword_fold);
  get diagnostics changed = row_count;
  return changed;
end;
$$;

revoke execute on function public.admin_social_check_now(text, text) from public, anon;
grant execute on function public.admin_social_check_now(text, text) to authenticated;
