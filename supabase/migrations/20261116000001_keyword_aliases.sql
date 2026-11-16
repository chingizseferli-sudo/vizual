-- Keyword variants: other spellings of a keyword (English, Russian, short forms)
-- that count as the same keyword. A news item that contains a variant is a
-- match for the keyword, so "Azərbaycan Hava Yolları" also finds
-- "Azerbaijan Airlines" and "Азербайджанские авиалинии".
--
-- 1. monitor_keywords.aliases: at most 5 variants, chosen by the customer
--    through set_keyword_aliases() (direct keyword writes stay blocked). They do
--    not count towards the plan's keyword limit.
-- 2. monitor_keywords.alias_suggestions: variants the rss worker asks Claude for
--    once per keyword (null = not asked yet, '{}' = nothing useful). Written by
--    the worker only; the customer picks from them.
-- Idempotent.

alter table public.monitor_keywords
  add column if not exists aliases text[] not null default '{}',
  add column if not exists alias_suggestions text[];

alter table public.monitor_keywords
  drop constraint if exists monitor_keywords_aliases_check,
  add constraint monitor_keywords_aliases_check check (cardinality(aliases) <= 5),
  drop constraint if exists monitor_keywords_alias_suggestions_check,
  add constraint monitor_keywords_alias_suggestions_check
    check (alias_suggestions is null or cardinality(alias_suggestions) <= 10);

create or replace function public.set_keyword_aliases(p_keyword_id uuid, p_aliases text[])
returns public.monitor_keywords
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_keyword text;
  v_aliases text[];
  v_row public.monitor_keywords;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  select keyword.keyword into v_keyword
  from public.monitor_keywords keyword
  join public.user_monitors monitor on monitor.id = keyword.monitor_id
  where keyword.id = p_keyword_id
    and monitor.user_id = v_user_id
    and monitor.status <> 'archived';

  if v_keyword is null then
    raise exception 'KEYWORD_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Trimmed, inner spaces collapsed, non-empty, unique (case-insensitive), not the keyword itself.
  select coalesce(array_agg(alias order by first_position), '{}')
  into v_aliases
  from (
    select min(position) as first_position, min(alias) as alias
    from (
      select pg_catalog.regexp_replace(pg_catalog.btrim(item), '\s+', ' ', 'g') as alias, position
      from unnest(coalesce(p_aliases, '{}'::text[])) with ordinality as input(item, position)
    ) trimmed
    where alias <> ''
      and pg_catalog.lower(alias) <> pg_catalog.lower(pg_catalog.btrim(v_keyword))
    group by pg_catalog.lower(alias)
  ) unique_aliases;

  if cardinality(v_aliases) > 5 then
    raise exception 'KEYWORD_ALIASES_TOO_MANY' using errcode = 'P0001';
  end if;
  if exists (select 1 from unnest(v_aliases) alias where pg_catalog.char_length(alias) not between 2 and 100) then
    raise exception 'KEYWORD_ALIAS_LENGTH_INVALID' using errcode = 'P0001';
  end if;

  update public.monitor_keywords keyword
  set aliases = v_aliases
  where keyword.id = p_keyword_id
  returning keyword.* into v_row;

  return v_row;
end;
$$;

revoke all on function public.set_keyword_aliases(uuid, text[]) from public, anon;
grant execute on function public.set_keyword_aliases(uuid, text[]) to authenticated;
