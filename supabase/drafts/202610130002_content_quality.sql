-- M4.5 additive local intake foundation. No collector/scheduler/permission is enabled.
begin;
do $$ begin
  if to_regprocedure('private.ai_access()') is null then raise exception 'CONTENT_AI_PREREQUISITE_REQUIRED'; end if;
end $$;
create table private.content_intake_config (
  singleton boolean primary key default true check(singleton),enabled boolean not null default false,
  queue_limit integer not null default 1000 check(queue_limit between 1 and 10000),
  monthly_per_owner integer not null default 1000 check(monthly_per_owner between 1 and 10000)
);
insert into private.content_intake_config(singleton) values(true);
create table private.content_source_permissions (
  source_id text primary key,enabled boolean not null default false,
  public_excerpt_approved boolean not null default false,
  allowed_origin text not null check(allowed_origin ~ '^https://[a-z0-9.-]+(:[0-9]{1,5})?$'),
  rights_basis text not null check(rights_basis in ('owned_source','publisher_permission','licensed')),
  -- Public-safe opaque reference only: never license text, tokens or private URLs.
  rights_reference text not null check(rights_reference ~ '^[A-Za-z0-9._-]{1,100}$')
  ,min_delay_seconds integer not null default 10 check(min_delay_seconds between 5 and 3600),next_fetch_at timestamptz not null default now()
);
create table private.content_intake_usage (
  owner_id uuid not null,month date not null,requested_jobs integer not null default 0 check(requested_jobs>=0),primary key(owner_id,month)
);
create table private.content_intake_jobs (
  id uuid primary key default gen_random_uuid(),owner_id uuid not null,item_id text not null,source_id text not null,item_url text not null,
  plan_id text not null,request_key uuid not null,
  status text not null default 'pending' check(status in ('pending','running','complete','dead')),
  attempts integer not null default 0 check(attempts between 0 and 3),available_at timestamptz not null default now(),
  lease_until timestamptz,token uuid,error_code text,created_at timestamptz not null default now(),finished_at timestamptz,
  unique(owner_id,request_key),check((status='running')=(token is not null and lease_until is not null))
);
create index content_intake_due on private.content_intake_jobs(available_at,id) where status in ('pending','running');
create unique index content_intake_active_item on private.content_intake_jobs(owner_id,item_id) where status in ('pending','running');
create index content_intake_retention on private.content_intake_jobs(finished_at,id) where status in ('complete','dead');
create table private.content_intake_requests(owner_id uuid not null,request_key uuid not null,
  job_id uuid not null references private.content_intake_jobs(id) on delete cascade,primary key(owner_id,request_key));
do $$ declare t text; begin
  foreach t in array array['content_intake_config','content_source_permissions','content_intake_usage','content_intake_jobs','content_intake_requests'] loop
    execute format('alter table private.%I enable row level security',t);
    execute format('revoke all on private.%I from public,anon,authenticated',t);
    execute format('grant select,insert,update,delete on private.%I to service_role',t);
  end loop;
end $$;
create function private.content_intake_authorized(j private.content_intake_jobs) returns boolean
language sql stable security definer set search_path=pg_catalog as $$
  select exists(select 1 from private.content_intake_config where singleton and enabled)
    and exists(select 1 from public.user_profiles u join private.ai_plan_features f on f.plan_id=u.plan_id::text
      join public.user_subscriptions s on s.user_id=u.user_id and s.plan_id=u.plan_id join public.subscription_plans p on p.id=u.plan_id
      where u.user_id=j.owner_id and u.status='active' and u.plan_id::text=j.plan_id and f.enabled and p.is_active
        and s.status in ('active','trialing') and (s.current_period_end is null or s.current_period_end>now()))
    and exists(select 1 from public.monitored_items i join public.monitor_matches x on x.item_id=i.id
      join public.user_monitors m on m.id=x.monitor_id join private.content_source_permissions cp on cp.source_id=i.source_id::text
      where i.id::text=j.item_id and i.source_id::text=j.source_id and i.url=j.item_url and m.user_id=j.owner_id and cp.enabled and cp.public_excerpt_approved
        and (i.url=cp.allowed_origin or left(i.url,length(cp.allowed_origin)+1)=cp.allowed_origin||'/'));
$$;
revoke all on function private.content_intake_authorized(private.content_intake_jobs) from public,anon,authenticated;

create function public.enqueue_content_intake(p_owner_id uuid,p_item_id text,p_request_key uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog set timezone='UTC' set lock_timeout='2s' as $$
declare j private.content_intake_jobs%rowtype;cfg private.content_intake_config%rowtype;
begin
  if p_owner_id is null or p_request_key is null or p_item_id is null or length(p_item_id)>200 then raise exception 'CONTENT_INVALID_REQUEST' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('vizual-content-intake-enqueue',0));
  select * into cfg from private.content_intake_config where singleton;
  if not cfg.enabled then raise exception 'CONTENT_COLLECTION_DISABLED' using errcode='42501'; end if;
  select i.id::text as item_id,i.source_id::text as source_id,i.url as item_url,u.plan_id::text as plan_id,p_owner_id as owner_id
    into j.item_id,j.source_id,j.item_url,j.plan_id,j.owner_id
    from public.monitored_items i join public.monitor_matches x on x.item_id=i.id join public.user_monitors m on m.id=x.monitor_id
      join public.user_profiles u on u.user_id=m.user_id where i.id::text=p_item_id and m.user_id=p_owner_id limit 1;
  if not found or not private.content_intake_authorized(j) then raise exception 'CONTENT_ACCESS_DENIED' using errcode='42501'; end if;
  select jobs.* into j from private.content_intake_jobs jobs join private.content_intake_requests r on r.job_id=jobs.id
    where r.owner_id=p_owner_id and r.request_key=p_request_key;
  if found then
    if j.item_id<>p_item_id then raise exception 'CONTENT_IDEMPOTENCY_CONFLICT' using errcode='22023'; end if;
    return jsonb_build_object('id',j.id,'status',j.status,'reused',true);
  end if;
  select * into j from private.content_intake_jobs where owner_id=p_owner_id and item_id=p_item_id and status in ('pending','running');
  if found then
    insert into private.content_intake_requests(owner_id,request_key,job_id) values(p_owner_id,p_request_key,j.id);
    return jsonb_build_object('id',j.id,'status',j.status,'reused',true);
  end if;
  if coalesce((select requested_jobs from private.content_intake_usage where owner_id=p_owner_id and month=date_trunc('month',now())::date),0)>=cfg.monthly_per_owner then
    raise exception 'CONTENT_MONTHLY_QUOTA_REACHED' using errcode='54000'; end if;
  if (select count(*) from private.content_intake_jobs where status in ('pending','running'))>=cfg.queue_limit then
    raise exception 'CONTENT_QUEUE_CAPACITY_REACHED' using errcode='54000'; end if;
  insert into private.content_intake_usage(owner_id,month,requested_jobs) values(p_owner_id,date_trunc('month',now())::date,1)
    on conflict(owner_id,month) do update set requested_jobs=private.content_intake_usage.requested_jobs+1;
  insert into private.content_intake_jobs(owner_id,item_id,source_id,item_url,plan_id,request_key)
    select p_owner_id,i.id::text,i.source_id::text,i.url,u.plan_id::text,p_request_key from public.monitored_items i,public.user_profiles u
      where i.id::text=p_item_id and u.user_id=p_owner_id returning * into j;
  insert into private.content_intake_requests(owner_id,request_key,job_id) values(p_owner_id,p_request_key,j.id);
  return jsonb_build_object('id',j.id,'status','pending','reused',false);
end $$;

create function public.claim_content_intake(p_limit integer default 1) returns setof jsonb
language plpgsql security definer set search_path=pg_catalog set timezone='UTC' set lock_timeout='2s' as $$
begin
  if p_limit is null or p_limit not between 1 and 5 then raise exception 'CONTENT_INVALID_BATCH' using errcode='22023'; end if;
  if not exists(select 1 from private.content_intake_config where singleton and enabled) then return; end if;
  perform pg_advisory_xact_lock(hashtextextended('vizual-content-intake-claim',0));
  update private.content_intake_jobs j set status='dead',token=null,lease_until=null,error_code='access_revoked',finished_at=now()
    where status in ('pending','running') and (status='pending' or lease_until<now())
      and (not private.content_intake_authorized(j) or attempts>=3 or date_trunc('month',created_at)<>date_trunc('month',now()));
  if exists(select 1 from private.content_intake_jobs where status='running' and lease_until>now()) then return; end if;
  return query with due as (select j.id from private.content_intake_jobs j join private.content_source_permissions cp on cp.source_id=j.source_id
    where attempts<3 and cp.next_fetch_at<=now()
    and ((status='pending' and available_at<=now()) or (status='running' and lease_until<now()))
    order by available_at,j.id limit 1 for update of j skip locked), claimed as (
      update private.content_intake_jobs j set status='running',attempts=attempts+1,token=gen_random_uuid(),lease_until=now()+interval '5 minutes'
      from due where j.id=due.id returning j.*), paced as (
      update private.content_source_permissions cp set next_fetch_at=now()+make_interval(secs=>min_delay_seconds)
      from claimed j where cp.source_id=j.source_id returning cp.*)
    select jsonb_build_object('id',j.id,'owner_id',j.owner_id,'item_id',j.item_id,'source_id',j.source_id,'item_url',j.item_url,
      'item_title',(select title from public.monitored_items where id::text=j.item_id),'token',j.token,'attempts',j.attempts,
      'permission',jsonb_build_object('basis',cp.rights_basis,'reference',cp.rights_reference,'allowed_origin',cp.allowed_origin),
      'limits',jsonb_build_object('max_excerpt_chars',4000)) from claimed j join paced cp on cp.source_id=j.source_id;
end $$;

create function public.complete_content_intake(p_id uuid,p_token uuid,p_payload jsonb) returns boolean
language plpgsql security definer set search_path=pg_catalog set timezone='UTC' set lock_timeout='2s' as $$
declare j private.content_intake_jobs%rowtype;cp private.content_source_permissions%rowtype;label text;excerpt text;chars integer;method text;
begin
  select * into j from private.content_intake_jobs where id=p_id and token=p_token and status='running' and lease_until>now() for update;
  if not found then return false; end if;
  if not private.content_intake_authorized(j) then raise exception 'CONTENT_ACCESS_REVOKED' using errcode='42501'; end if;
  select * into cp from private.content_source_permissions where source_id=j.source_id;
  label:=p_payload->'quality'->>'label';excerpt:=p_payload->>'excerpt';chars:=char_length(coalesce(excerpt,''));method:=p_payload->'provenance'->>'method';
  if p_payload is null or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>65536
    or p_payload-array['version','source_id','item_url','canonical_url','headline','excerpt','content_hash','language','published_at','collected_at','quality','provenance']<>'{}'::jsonb
    or (p_payload->'quality')-array['label','extracted_chars','retained_chars','main_content_detected','reasons']<>'{}'::jsonb
    or (p_payload->'provenance')-array['method','rights','robots','access','original_url']<>'{}'::jsonb
    or (p_payload->'provenance'->'rights')-array['basis','reference','verified']<>'{}'::jsonb
    or (p_payload->'provenance'->'robots')-array['state','checked_at']<>'{}'::jsonb
    or (p_payload->'provenance'->'access')-array['authentication_required','paywall']<>'{}'::jsonb
    or (p_payload->'language')-array['code','method','confidence']<>'{}'::jsonb
    or jsonb_typeof(p_payload->'provenance'->'access'->'authentication_required') is distinct from 'boolean'
    or jsonb_typeof(p_payload->'provenance'->'access'->'paywall') is distinct from 'boolean'
    or p_payload->'provenance'->'robots'->>'state' is null
    or p_payload->'provenance'->'robots'->>'state' not in ('allowed','not_applicable','denied','unknown')
    or p_payload->>'version' is distinct from '1' or p_payload->>'source_id' is distinct from j.source_id or p_payload->>'item_url' is distinct from j.item_url
    or p_payload->'provenance'->>'original_url' is distinct from j.item_url or label is null
    or label not in ('full_text','substantial_excerpt','title_summary','title_only','extraction_failed','source_inaccessible')
    or method is null or method not in ('rss_content','article_html','authorized_api','rss_summary','title_only')
    or chars>4000 or coalesce((p_payload->'quality'->>'retained_chars')::integer,-1)<>chars
    or coalesce((p_payload->'quality'->>'extracted_chars')::integer,-1) not between chars and 250000
    or jsonb_typeof(p_payload->'quality'->'reasons') is distinct from 'array'
    or p_payload->'language'->>'code' is null or p_payload->'language'->>'code' not in ('az','tr','ru','en','unknown')
    or p_payload->'language'->>'method' is null or p_payload->'language'->>'method' not in ('declared','heuristic')
    or p_payload->'language'->>'confidence' is null or p_payload->'language'->>'confidence' not in ('low','moderate')
    or p_payload->>'collected_at' is null or not isfinite((p_payload->>'collected_at')::timestamptz)
    or (p_payload->>'collected_at')::timestamptz>now()+interval '5 minutes'
    or p_payload->'provenance'->'rights'->>'basis' is distinct from cp.rights_basis
    or p_payload->'provenance'->'rights'->>'reference' is distinct from cp.rights_reference then
    raise exception 'CONTENT_INVALID_PAYLOAD' using errcode='22023'; end if;
  if chars>0 and (p_payload->'provenance'->'rights'->'verified' is distinct from 'true'::jsonb
    or p_payload->'provenance'->'access'->'authentication_required' is distinct from 'false'::jsonb
    or p_payload->'provenance'->'access'->'paywall' is distinct from 'false'::jsonb
    or (p_payload->'provenance'->'robots'->>'state'='allowed'
      and p_payload->'provenance'->'robots'->>'checked_at' is not null
      and (p_payload->'provenance'->'robots'->>'checked_at')::timestamptz between now()-interval '24 hours' and now()+interval '5 minutes'
      or p_payload->'provenance'->'robots'->>'state'='not_applicable' and method in ('rss_content','authorized_api')) is not true) then
    raise exception 'CONTENT_PERMISSION_REQUIRED' using errcode='42501'; end if;
  if label in ('full_text','substantial_excerpt') and (chars<200 or (p_payload->'quality'->>'extracted_chars')::integer<250
    or p_payload->'quality'->'main_content_detected' is distinct from 'true'::jsonb or method in ('rss_summary','title_only'))
    or label='full_text' and (p_payload->'quality'->>'extracted_chars')::integer<800
    or label in ('title_only','extraction_failed','source_inaccessible') and chars>0 then
    raise exception 'CONTENT_INVALID_QUALITY' using errcode='22023'; end if;
  update public.monitored_items set content_metadata=coalesce(content_metadata,'{}'::jsonb)||jsonb_build_object('version',1,'excerpt',excerpt,
    'language',p_payload->'language'->>'code','provenance',coalesce(content_metadata->'provenance','{}'::jsonb)||jsonb_build_object(
      'excerpt_access',case when chars>0 then 'permitted' else 'unavailable' end,'content_quality',p_payload-'excerpt')) where id::text=j.item_id;
  update private.content_intake_jobs set status='complete',finished_at=now(),token=null,lease_until=null,error_code=null where id=j.id;
  return true;
end $$;

create function public.fail_content_intake(p_id uuid,p_token uuid,p_error_code text) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare changed integer;
begin
  if p_error_code is null or p_error_code not in ('network_failed','extraction_failed','source_inaccessible','source_unavailable','rate_limited','budget_exhausted','cancelled') then raise exception 'CONTENT_INVALID_ERROR' using errcode='22023'; end if;
  update private.content_intake_jobs set status=case when attempts>=3 or p_error_code in ('source_inaccessible','budget_exhausted','cancelled') then 'dead' else 'pending' end,
    token=null,lease_until=null,error_code=p_error_code,available_at=now()+make_interval(secs=>30*power(2,attempts-1)::integer),
    finished_at=case when attempts>=3 or p_error_code in ('source_inaccessible','budget_exhausted','cancelled') then now() else null end
    where id=p_id and token=p_token and status='running' and lease_until>now();
  get diagnostics changed=row_count;return changed=1;
end $$;
create function public.cancel_content_intake(p_id uuid,p_owner_id uuid) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$ declare changed integer; begin
  update private.content_intake_jobs set status='dead',token=null,lease_until=null,error_code='cancelled',finished_at=now()
    where id=p_id and owner_id=p_owner_id and status in ('pending','running');
  get diagnostics changed=row_count;return changed=1;
end $$;
revoke all on function public.enqueue_content_intake(uuid,text,uuid),public.claim_content_intake(integer),public.complete_content_intake(uuid,uuid,jsonb),
  public.fail_content_intake(uuid,uuid,text),public.cancel_content_intake(uuid,uuid) from public,anon,authenticated;
grant execute on function public.enqueue_content_intake(uuid,text,uuid),public.claim_content_intake(integer),public.complete_content_intake(uuid,uuid,jsonb),
  public.fail_content_intake(uuid,uuid,text),public.cancel_content_intake(uuid,uuid) to service_role;

create index content_quality_source on public.monitored_items((source_id::text),detected_at,id)
  where content_metadata->'provenance'->'content_quality' is not null and content_metadata->>'excerpt' is not null;
create function public.prune_content_intake(p_limit integer default 100) returns integer
language plpgsql security definer set search_path=pg_catalog as $$
declare removed integer; terminal integer;
begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'CONTENT_INVALID_BATCH' using errcode='22023'; end if;
  update public.monitored_items i set content_metadata=jsonb_set(jsonb_set(i.content_metadata,'{excerpt}','null'::jsonb),'{provenance}',
    i.content_metadata->'provenance'||jsonb_build_object('excerpt_access','unavailable','content_quality',
      i.content_metadata->'provenance'->'content_quality'||jsonb_build_object('quality',jsonb_build_object(
        'label','source_inaccessible','extracted_chars',0,'retained_chars',0,'main_content_detected',false,'reasons',jsonb_build_array('permission_revoked')))))
    where id in (select item.id from public.monitored_items item where item.content_metadata->'provenance'->'content_quality' is not null
      and item.content_metadata->>'excerpt' is not null and not exists(select 1 from private.content_source_permissions cp
        where cp.source_id=item.source_id::text and cp.enabled and cp.public_excerpt_approved
          and (item.url=cp.allowed_origin or left(item.url,length(cp.allowed_origin)+1)=cp.allowed_origin||'/')
          and cp.rights_basis=item.content_metadata->'provenance'->'content_quality'->'provenance'->'rights'->>'basis'
          and cp.rights_reference=item.content_metadata->'provenance'->'content_quality'->'provenance'->'rights'->>'reference')
      order by item.detected_at,item.id limit p_limit for update skip locked);
  get diagnostics removed=row_count;
  delete from private.content_intake_jobs where id in(select id from private.content_intake_jobs where status in ('complete','dead')
    and finished_at<now()-interval '31 days' order by finished_at,id limit greatest(0,p_limit-removed) for update skip locked);
  get diagnostics terminal=row_count;return removed+terminal;
end $$;
revoke all on function public.prune_content_intake(integer) from public,anon,authenticated;
grant execute on function public.prune_content_intake(integer) to service_role;

create function private.ai_project_content_metadata(i public.monitored_items,base jsonb) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog as $$
declare payload jsonb:=i.content_metadata->'provenance'->'content_quality'; projected jsonb; permitted boolean; quality jsonb;
begin
  projected:=case when jsonb_typeof(base)='object' then base else '{}'::jsonb end;
  permitted:=i.content_metadata->'provenance'->>'excerpt_access'='permitted' and
    (payload is null or exists(select 1 from private.content_source_permissions cp where cp.source_id=i.source_id::text and cp.enabled and cp.public_excerpt_approved
      and (i.url=cp.allowed_origin or left(i.url,length(cp.allowed_origin)+1)=cp.allowed_origin||'/')
      and cp.rights_reference=payload->'provenance'->'rights'->>'reference' and cp.rights_basis=payload->'provenance'->'rights'->>'basis'));
  quality:=payload->'quality';
  if permitted and jsonb_typeof(i.content_metadata->'excerpt')='string' and length(i.content_metadata->>'excerpt')>0 then
    projected:=projected||jsonb_build_object('excerpt',left(i.content_metadata->>'excerpt',4000));
  elsif quality->>'label' in ('full_text','substantial_excerpt') then
    quality:=jsonb_build_object('label','source_inaccessible','extracted_chars',0,'retained_chars',0,'main_content_detected',false,'reasons',jsonb_build_array('permission_unavailable'));
  end if;
  return projected||jsonb_build_object('content_quality',quality,'retrieved_at',payload->'collected_at',
    'permission_verified',coalesce(permitted and payload->'provenance'->'rights'->'verified'='true'::jsonb,false));
end $$;
revoke all on function private.ai_project_content_metadata(public.monitored_items,jsonb) from public,anon,authenticated;

-- Keep the applied M4 validator intact under a service-only compatibility name.
alter function public.complete_ai_insight_job(uuid,uuid,jsonb,text,text,text,numeric) rename to complete_ai_insight_job_m4;
create function public.complete_ai_insight_job(p_id uuid,p_token uuid,p_result jsonb,p_provider text,p_model text,p_prompt_version text,p_cost_usd numeric)
returns boolean language plpgsql security definer set search_path=pg_catalog set timezone='UTC' as $$
declare j private.ai_jobs%rowtype;e jsonb;captured jsonb;rec jsonb;ref text;label text;
begin
  select * into j from private.ai_jobs where id=p_id and token=p_token and status='running' and lease_until>now() for update;
  if not found then return false; end if;
  if p_result ? 'independent_author_count' and p_result->'independent_author_count'<>'null'::jsonb
    or p_result ? 'independent_publisher_count' and p_result->'independent_publisher_count'<>'null'::jsonb then
    raise exception 'AI_UNVERIFIED_INDEPENDENCE' using errcode='22023'; end if;
  if p_result ? 'evidence_status' and p_result->>'evidence_status' is distinct from
    (case when jsonb_array_length(p_result->'recommendations')>0 then 'sufficient' else 'insufficient_evidence' end) then
    raise exception 'AI_INVALID_EVIDENCE_STATUS' using errcode='22023'; end if;
  for e in select value from jsonb_array_elements(p_result->'evidence') loop
    select value into captured from jsonb_array_elements(j.evidence->'items') where value->>'id'=e->>'id';
    label:=coalesce(captured->'metadata'->'content_quality'->>'label',case when e->>'text_scope'='title' then 'title_only' else 'title_summary' end);
    if e ? 'quality_label' and e->>'quality_label' is distinct from label
      or e ? 'retrieved_at' and e->'retrieved_at' is distinct from coalesce(captured->'metadata'->'retrieved_at','null'::jsonb)
      or e ? 'evidence_kind' and (e->>'evidence_kind' is null or e->>'evidence_kind' not in ('complaint','suggestion','announcement','journalist_summary','event','reported_opinion','allegation','uncertain','feedback')) then
      raise exception 'AI_INVALID_CONTENT_QUALITY' using errcode='22023'; end if;
    if e->'recommendation_basis'='true'::jsonb and (label not in ('full_text','substantial_excerpt')
      or e->>'evidence_kind' is distinct from 'complaint' or e->>'text_scope' is distinct from 'excerpt'
      or captured->'metadata'->'permission_verified' is distinct from 'true'::jsonb
      or captured->'metadata'->'content_quality'->'main_content_detected' is distinct from 'true'::jsonb
      or char_length(e->>'excerpt')<200 or coalesce((captured->'metadata'->'content_quality'->>'extracted_chars')::integer,0)<250) then
      raise exception 'AI_INVALID_RECOMMENDATION_BASIS' using errcode='22023'; end if;
  end loop;
  for rec in select value from jsonb_array_elements(p_result->'recommendations') loop
    if p_result->>'evidence_status' is distinct from 'sufficient' or rec->>'confidence' is distinct from 'low'
      or rec->'independent_author_count' is distinct from 'null'::jsonb or rec->'independent_publisher_count' is distinct from 'null'::jsonb then
      raise exception 'AI_UNVERIFIED_RECOMMENDATION' using errcode='22023'; end if;
    for ref in select value from jsonb_array_elements_text(rec->'evidence_ids') loop
      if not exists(select 1 from jsonb_array_elements(p_result->'evidence') v where v->>'id'=ref and v->'recommendation_basis'='true'::jsonb) then
        raise exception 'AI_INVALID_RECOMMENDATION_BASIS' using errcode='22023'; end if;
    end loop;
  end loop;
  return public.complete_ai_insight_job_m4(p_id,p_token,p_result,p_provider,p_model,p_prompt_version,p_cost_usd);
end $$;
revoke all on function public.complete_ai_insight_job(uuid,uuid,jsonb,text,text,text,numeric) from public,anon,authenticated;
grant execute on function public.complete_ai_insight_job(uuid,uuid,jsonb,text,text,text,numeric) to service_role;

create or replace function private.ai_job_authorized(j private.ai_jobs) returns boolean language sql stable security definer
set search_path=pg_catalog as $$
  select exists(select 1 from public.user_profiles u join private.ai_plan_features f on f.plan_id=u.plan_id::text
    join public.user_subscriptions s on s.user_id=u.user_id and s.plan_id=u.plan_id
    join public.subscription_plans p on p.id=u.plan_id
    where u.user_id=j.owner_id and u.status='active' and u.plan_id::text=j.plan_id and f.enabled and p.is_active
      and s.status in ('active','trialing') and (s.current_period_end is null or s.current_period_end>now())
      and j.period_start>=now()-make_interval(days=>least(31,greatest(1,coalesce(p.history_days,30))))-interval '5 minutes'
      and exists(select 1 from public.user_monitors m where m.id::text=j.monitor_id and m.user_id=j.owner_id)
      and not exists(select 1 from jsonb_array_elements(j.evidence->'items') e where not exists(
        select 1 from public.monitored_items i join public.monitor_matches x on x.item_id=i.id
          join public.user_monitors m on m.id=x.monitor_id
        where i.id::text=e->>'id' and m.user_id=j.owner_id and m.id::text=j.monitor_id
          and (e->'metadata'->>'excerpt' is null or
            (i.content_metadata->'provenance'->>'excerpt_access'='permitted'
              and left(i.content_metadata->>'excerpt',4000)=e->'metadata'->>'excerpt' and (e->'metadata'->'content_quality' is null or e->'metadata'->'content_quality'='null'::jsonb or exists(select 1 from private.content_source_permissions cp where cp.source_id=i.source_id::text and cp.enabled and cp.public_excerpt_approved and (i.url=cp.allowed_origin or left(i.url,length(cp.allowed_origin)+1)=cp.allowed_origin||'/') and cp.rights_reference=i.content_metadata->'provenance'->'content_quality'->'provenance'->'rights'->>'reference' and cp.rights_basis=i.content_metadata->'provenance'->'content_quality'->'provenance'->'rights'->>'basis' and e->'metadata'->'content_quality'=i.content_metadata->'provenance'->'content_quality'->'quality')))))));
$$;
revoke all on function private.ai_job_authorized(private.ai_jobs) from public,anon,authenticated;


create or replace function public.request_ai_insights(p_start timestamptz,p_end timestamptz,p_monitor text,p_request_key uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog set timezone='UTC' set statement_timeout='5s' set lock_timeout='2s' as $$
declare access jsonb; actor uuid:=auth.uid(); existing private.ai_jobs%rowtype; snapshot jsonb; job_id uuid;
  cfg private.ai_system_config%rowtype; reserve numeric; monthly_cap integer; plan text; monitor_name text;
begin
  access:=private.ai_access();
  if p_request_key is null or p_monitor is null or length(p_monitor)>200 then raise exception 'AI_INVALID_REQUEST' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('vizual-ai-enqueue',0));
  access:=private.ai_access();
  if not (access->>'available')::boolean then raise exception 'AI_FEATURE_UNAVAILABLE' using errcode='42501'; end if;
  if not exists(select 1 from public.user_monitors m where m.id::text=p_monitor and m.user_id=actor) then
    raise exception 'AI_MONITOR_DENIED' using errcode='42501'; end if;
  select * into existing from private.ai_jobs where owner_id=actor and request_key=p_request_key;
  if found then
    if existing.monitor_id<>p_monitor or existing.period_start is distinct from p_start or existing.period_end is distinct from p_end then
      raise exception 'AI_IDEMPOTENCY_CONFLICT' using errcode='22023'; end if;
    return jsonb_build_object('id',existing.id,'status',existing.status,'reused',true);
  end if;
  snapshot:=public.get_content_analytics(p_start,p_end,p_monitor,null,100);
  if jsonb_array_length(snapshot->'items')<1 then raise exception 'AI_NO_EVIDENCE' using errcode='22023'; end if;
  if octet_length(snapshot::text)>262144 then raise exception 'AI_EVIDENCE_TOO_LARGE' using errcode='22023'; end if;
  select name into monitor_name from public.user_monitors where user_id=actor and id::text=p_monitor;
  snapshot:=snapshot||jsonb_build_object('entity',jsonb_build_object('name',monitor_name,'aliases','[]'::jsonb));
  -- Existing trusted public metadata may contain a permitted excerpt. Unknown
  -- access rights never enable body analysis; no fetching/collector is added.
  snapshot:=jsonb_set(snapshot,'{items}',(select jsonb_agg(e.value||jsonb_build_object('metadata',
    private.ai_project_content_metadata(i,e.value->'metadata')) order by e.ordinality)
    from jsonb_array_elements(snapshot->'items') with ordinality e(value,ordinality)
      join public.monitored_items i on i.id::text=e.value->>'id'));
  select * into cfg from private.ai_system_config where singleton;
  monthly_cap:=(access->'quota'->>'limit')::integer; reserve:=(access->'limits'->>'reserved_cost_usd')::numeric; plan:=access->>'plan_id';
  if (access->'quota'->>'used')::integer>=monthly_cap then raise exception 'AI_MONTHLY_QUOTA_REACHED' using errcode='54000'; end if;
  if (select count(*) from private.ai_jobs where status in ('pending','running'))>=cfg.queue_limit then
    raise exception 'AI_QUEUE_CAPACITY_REACHED' using errcode='54000'; end if;
  if coalesce((select sum(reserved_cost_usd) from private.ai_usage where month=date_trunc('month',now())::date),0)+reserve>cfg.monthly_budget_usd then
    raise exception 'AI_BUDGET_REACHED' using errcode='54000'; end if;
  insert into private.ai_usage(owner_id,month,requested_jobs,reserved_cost_usd) values(actor,date_trunc('month',now())::date,1,reserve)
    on conflict(owner_id,month) do update set requested_jobs=private.ai_usage.requested_jobs+1,reserved_cost_usd=private.ai_usage.reserved_cost_usd+excluded.reserved_cost_usd;
  insert into private.ai_jobs(owner_id,request_key,monitor_id,monitor_name,plan_id,period_start,period_end,evidence,limits)
    values(actor,p_request_key,p_monitor,monitor_name,plan,p_start,p_end,snapshot,access->'limits') returning id into job_id;
  return jsonb_build_object('id',job_id,'status','pending','reused',false);
end $$;


commit;
