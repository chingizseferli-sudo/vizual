-- M3 additive contract. Production application requires a reconciled catalog/ledger.
-- This file owns shared analytics objects; never copy into the worker ledger.
begin;
do $$
declare required record;
begin
  for required in select * from (values
    ('monitored_items','id'), ('monitored_items','title'), ('monitored_items','url'),
    ('monitored_items','source_id'), ('monitored_items','published_at'), ('monitored_items','detected_at'),
    ('monitor_matches','item_id'), ('monitor_matches','monitor_id'), ('monitor_matches','matched_keyword'),
    ('user_monitors','id'), ('user_monitors','user_id'), ('user_monitors','name'),
    ('user_profiles','user_id'), ('user_profiles','status'), ('user_profiles','plan_id'),
    ('subscription_plans','id'), ('subscription_plans','history_days'),
    ('sources','id'), ('sources','name'), ('sources','rss_url')
  ) as requirements(table_name,column_name)
  loop
    if not exists (select 1 from information_schema.columns c
      where c.table_schema='public' and c.table_name=required.table_name and c.column_name=required.column_name) then
      raise exception 'ANALYTICS_SCHEMA_PREFLIGHT_FAILED: %.%', required.table_name,required.column_name;
    end if;
  end loop;
  if to_regprocedure('auth.uid()') is null then raise exception 'ANALYTICS_AUTH_PREFLIGHT_FAILED'; end if;
  if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname in ('monitored_items','monitor_matches','user_monitors','user_profiles')
      and not c.relrowsecurity) then
    raise exception 'ANALYTICS_RLS_PREFLIGHT_FAILED';
  end if;
  if exists(select 1 from information_schema.columns c where c.table_schema='public'
    and c.table_name='monitored_items' and c.column_name in ('published_at','detected_at')
    and c.data_type <> 'timestamp with time zone') then
    raise exception 'ANALYTICS_TIMESTAMP_PREFLIGHT_FAILED';
  end if;
  if exists(select 1 from information_schema.columns c where c.table_schema='public'
    and c.table_name in ('user_profiles','user_monitors') and c.column_name='user_id' and c.udt_name<>'uuid') then
    raise exception 'ANALYTICS_IDENTITY_PREFLIGHT_FAILED';
  end if;
end $$;

alter table public.monitored_items add column content_metadata jsonb;
alter table public.monitored_items add constraint monitored_items_content_metadata_shape
  check (content_metadata is null or (jsonb_typeof(content_metadata)='object' and octet_length(content_metadata::text)<=65536
    and content_metadata - array['version','platform','external_id','source_identifier','canonical_url','publisher','author',
      'language','content_type','excerpt','published_at','discovered_at','title_fingerprint','processing_status','metrics',
      'relationships','provenance','access_limitations','original_metadata'] = '{}'::jsonb
    -- Global relationship endpoints need a separately authorized schema in M5.
    and (not content_metadata ? 'relationships' or content_metadata->'relationships' = '[]'::jsonb)));
comment on column public.monitored_items.content_metadata is
  'Versioned normalized publication metadata; no duplicate content identity. Null means unprocessed, not missing engagement zero. Service-written only.';
create index analytics_matches_monitor_item on public.monitor_matches (monitor_id,item_id);
create index analytics_monitors_owner on public.user_monitors (user_id,id);
create index analytics_items_detection on public.monitored_items (detected_at desc,id);
-- Type-independent private job pointers still use indexed publication lookups.
create index analytics_items_text_identity on public.monitored_items ((id::text));
create index analytics_items_unprocessed on public.monitored_items (detected_at,id) where content_metadata is null;

-- A customer operation: even an administrator only sees their own monitoring evidence.
create function public.get_content_analytics(
  p_start timestamptz, p_end timestamptz, p_monitor text default null,
  p_source text default null, p_limit integer default 500
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog
set statement_timeout = '5s'
set timezone = 'UTC'
as $$
declare result jsonb; retention integer; caller uuid := auth.uid();
begin
  if caller is null or not exists (select 1 from public.user_profiles p where p.user_id=caller and p.status='active') then
    raise exception 'ANALYTICS_ACCESS_DENIED' using errcode='42501';
  end if;
  select least(31,greatest(1,coalesce(plan.history_days,30))) into retention
    from public.user_profiles p left join public.subscription_plans plan on plan.id=p.plan_id
    where p.user_id=caller limit 1;
  if p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end)
    or p_start>=p_end or p_end-p_start>interval '31 days' or p_limit is null or p_limit not between 1 and 500
    or p_end>now()+interval '5 minutes' or p_start<now()-make_interval(days=>retention)-interval '5 minutes'
    or length(coalesce(p_monitor,''))>200 or length(coalesce(p_source,''))>200 then
    raise exception 'ANALYTICS_INVALID_WINDOW_OR_FILTER' using errcode='22023';
  end if;
  if p_monitor is not null and not exists(select 1 from public.user_monitors m where m.id::text=p_monitor and m.user_id=caller) then
    raise exception 'ANALYTICS_MONITOR_DENIED' using errcode='42501';
  end if;
  with selected as materialized (
    select i.id,i.title,i.url,i.source_id,i.published_at,i.detected_at,i.content_metadata
    from public.monitored_items i
    where i.detected_at>=p_start and i.detected_at<p_end
      and (p_source is null or i.source_id::text=p_source)
      and exists(select 1 from public.monitor_matches x join public.user_monitors m on m.id=x.monitor_id
        where x.item_id=i.id and m.user_id=caller and (p_monitor is null or m.id::text=p_monitor))
    order by i.detected_at desc,i.id desc limit p_limit+1
  ), page as (select * from selected order by detected_at desc,id desc limit p_limit), evidence as (
    select jsonb_build_object('id',i.id::text,'title',i.title,'url',i.url,
      'source_id',i.source_id::text,'publisher',s.name,'platform',coalesce(i.content_metadata->>'platform',case when s.rss_url is not null then 'rss' else 'website' end),
      'published_at',i.published_at,'detected_at',i.detected_at,
      -- Never expose arbitrary future metadata or unchecked relationship endpoints.
      'metadata',case when i.content_metadata is null then null else jsonb_build_object(
        'version',i.content_metadata->'version','content_type',i.content_metadata->'content_type',
        'canonical_url',i.content_metadata->'canonical_url','language',i.content_metadata->'language',
        'processing_status',i.content_metadata->'processing_status',
        'metrics',i.content_metadata->'metrics','access_limitations',i.content_metadata->'access_limitations') end,
      'matches',(select coalesce(jsonb_agg(distinct jsonb_build_object('monitor_id',m.id::text,'name',m.name,'keyword',x.matched_keyword)),'[]'::jsonb)
        from public.monitor_matches x join public.user_monitors m on m.id=x.monitor_id
        where x.item_id=i.id and m.user_id=caller and (p_monitor is null or m.id::text=p_monitor))) as item,
      i.detected_at,i.id
    from page i left join public.sources s on s.id=i.source_id
  )
  select jsonb_build_object('version',1,'owner_id',caller,'items',coalesce((select jsonb_agg(item order by detected_at desc,id desc) from evidence),'[]'::jsonb),
    'truncated',(select count(*)>p_limit from selected),'limit',p_limit,'collected_at',now(),
    'start',p_start,'end',p_end,'retention_days',retention,
    'monitors',(select coalesce(jsonb_agg(jsonb_build_object('id',m.id::text,'name',m.name)),'[]'::jsonb) from public.user_monitors m where m.user_id=caller)) into result;
  return result;
end $$;
revoke all on function public.get_content_analytics(timestamptz,timestamptz,text,text,integer) from public,anon;
grant execute on function public.get_content_analytics(timestamptz,timestamptz,text,text,integer) to authenticated;

-- Metadata must not become a new browser write channel through legacy table grants.
-- Column-specific grants cannot override an existing whole-table UPDATE privilege.
create function public.protect_content_metadata() returns trigger
language plpgsql set search_path=pg_catalog as $$
begin
  if current_user in ('authenticated','anon') then
    if (tg_op='INSERT' and new.content_metadata is not null) or
       (tg_op='UPDATE' and new.content_metadata is distinct from old.content_metadata) then
      raise exception 'ANALYTICS_METADATA_SERVICE_ONLY' using errcode='42501';
    end if;
  end if;
  return new;
end $$;
create trigger analytics_metadata_write_guard before insert or update on public.monitored_items
  for each row execute function public.protect_content_metadata();

-- Durable bounded jobs; text pointer is deliberately private and revalidated before update.
-- No trigger or processing cost is added to monitoring/Telegram transactions.
create schema if not exists private;
create table private.content_processing_jobs (
  id bigint generated always as identity primary key,
  item_id text not null, version integer not null default 1,
  status text not null default 'pending' check(status in ('pending','running','complete','dead')),
  attempts integer not null default 0 check(attempts between 0 and 5),
  available_at timestamptz not null default now(), lease_until timestamptz,
  token uuid, error_code text, created_at timestamptz not null default now(),
  finished_at timestamptz, unique(item_id,version)
);
create index content_jobs_due on private.content_processing_jobs (available_at,id) where status in ('pending','running');
alter table private.content_processing_jobs enable row level security;
revoke all on private.content_processing_jobs from public,anon,authenticated;
grant usage on schema private to service_role;
grant select,insert,update,delete on private.content_processing_jobs to service_role;
grant usage,select on sequence private.content_processing_jobs_id_seq to service_role;
commit;
