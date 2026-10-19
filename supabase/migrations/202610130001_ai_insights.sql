-- M4 local foundation. Apply only after catalog/ledger review and approval.
-- All feature gates default OFF; no scheduler or provider activation is implied.
begin;
do $$ declare required record; begin
  if to_regprocedure('public.get_content_analytics(timestamp with time zone,timestamp with time zone,text,text,integer)') is null then
    raise exception 'AI_ANALYTICS_PREREQUISITE_REQUIRED';
  end if;
  for required in select * from (values ('user_subscriptions','user_id'),('user_subscriptions','plan_id'),
    ('user_subscriptions','status'),('user_subscriptions','current_period_end'),('subscription_plans','is_active')) as r(table_name,column_name) loop
    if not exists(select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=required.table_name and c.column_name=required.column_name) then
      raise exception 'AI_SUBSCRIPTION_PREREQUISITE_REQUIRED';
    end if;
  end loop;
end $$;

create table private.ai_system_config (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,
  monthly_budget_usd numeric(14,6) not null default 10 check(monthly_budget_usd between 0 and 100000),
  queue_limit integer not null default 1000 check(queue_limit between 1 and 10000)
);
insert into private.ai_system_config(singleton) values(true);
create table private.ai_plan_features (
  plan_id text primary key,
  enabled boolean not null default false,
  monthly_jobs integer not null default 0 check(monthly_jobs between 0 and 1000),
  reserved_cost_usd numeric(12,6) not null default 0.05 check(reserved_cost_usd between 0.000001 and 10),
  max_input_chars integer not null default 30000 check(max_input_chars between 500 and 50000)
);
create table private.ai_usage (
  owner_id uuid not null, month date not null,
  requested_jobs integer not null default 0 check(requested_jobs>=0),
  reserved_cost_usd numeric(14,6) not null default 0 check(reserved_cost_usd>=0),
  primary key(owner_id,month)
);
create index ai_usage_month on private.ai_usage(month);
create table private.ai_jobs (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null,
  request_key uuid not null, monitor_id text not null, monitor_name text not null,
  plan_id text not null, period_start timestamptz not null,period_end timestamptz not null,
  evidence jsonb not null check(jsonb_typeof(evidence)='object' and octet_length(evidence::text)<=262144),
  limits jsonb not null, status text not null default 'pending' check(status in ('pending','running','complete','dead')),
  attempts integer not null default 0 check(attempts between 0 and 3),
  available_at timestamptz not null default now(),lease_until timestamptz,token uuid,
  result jsonb check(result is null or (jsonb_typeof(result)='object' and octet_length(result::text)<=131072)),
  provider text,model text,prompt_version text,cost_usd numeric(12,6),error_code text,
  created_at timestamptz not null default now(),finished_at timestamptz,
  unique(owner_id,request_key),check(period_start<period_end),
  check((status='running')=(token is not null and lease_until is not null)),
  check(cost_usd is null or cost_usd>=0)
);
create index ai_jobs_owner_created on private.ai_jobs(owner_id,created_at desc,id);
create index ai_jobs_due on private.ai_jobs(available_at,id) where status in ('pending','running');
create index ai_jobs_retention on private.ai_jobs(period_start,id) where status in ('complete','dead');
create table private.ai_reviews (
  job_id uuid not null references private.ai_jobs(id) on delete cascade,
  owner_id uuid not null, recommendation_index integer not null check(recommendation_index between 0 and 49),
  verdict text not null check(verdict in ('accepted','rejected','needs_review')),
  updated_at timestamptz not null default now(),primary key(job_id,recommendation_index)
);
do $$ declare t text; begin
  foreach t in array array['ai_system_config','ai_plan_features','ai_usage','ai_jobs','ai_reviews'] loop
    execute format('alter table private.%I enable row level security',t);
    execute format('revoke all on private.%I from public,anon,authenticated',t);
    execute format('grant select,insert,update,delete on private.%I to service_role',t);
  end loop;
end $$;

-- Applied before provider dispatch and again before persistence/serving results.
create function private.ai_job_authorized(j private.ai_jobs) returns boolean language sql stable security definer
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
              and left(i.content_metadata->>'excerpt',4000)=e->'metadata'->>'excerpt')))));
$$;
revoke all on function private.ai_job_authorized(private.ai_jobs) from public,anon,authenticated;

-- Caller identity and authoritative plan checks are shared by customer RPCs.
create function private.ai_access() returns jsonb language plpgsql security definer
set search_path=pg_catalog set timezone='UTC' as $$
declare actor uuid:=auth.uid(); profile_plan text; feature private.ai_plan_features%rowtype;
  cfg private.ai_system_config%rowtype; used integer:=0; reason text;
begin
  select p.plan_id::text into profile_plan from public.user_profiles p where p.user_id=actor and p.status='active';
  if actor is null or not found then raise exception 'AI_ACCESS_DENIED' using errcode='42501'; end if;
  select * into cfg from private.ai_system_config where singleton;
  select * into feature from private.ai_plan_features where plan_id=profile_plan;
  if not coalesce(cfg.enabled,false) then reason:='disabled';
  elsif not coalesce(feature.enabled,false) then reason:='plan_disabled';
  elsif not exists(select 1 from public.user_subscriptions s join public.subscription_plans p on p.id=s.plan_id
    where s.user_id=actor and s.plan_id::text=profile_plan and s.status in ('active','trialing')
      and (s.current_period_end is null or s.current_period_end>now()) and p.is_active) then reason:='subscription_required';
  end if;
  select u.requested_jobs into used from private.ai_usage u where u.owner_id=actor and u.month=date_trunc('month',now())::date;
  return jsonb_build_object('owner_id',actor,'plan_id',profile_plan,'available',reason is null,'reason',reason,
    'quota',jsonb_build_object('limit',coalesce(feature.monthly_jobs,0),'used',coalesce(used,0),
      'remaining',greatest(0,coalesce(feature.monthly_jobs,0)-coalesce(used,0))),
    'limits',jsonb_build_object('reserved_cost_usd',feature.reserved_cost_usd,'max_input_chars',feature.max_input_chars,
      'max_attempts',3,'per_attempt_cost_usd',feature.reserved_cost_usd/3));
end $$;
revoke all on function private.ai_access() from public,anon,authenticated;

create function public.get_ai_insights() returns jsonb language plpgsql security definer
set search_path=pg_catalog set timezone='UTC' set statement_timeout='5s' as $$
declare access jsonb:=private.ai_access(); actor uuid:=(access->>'owner_id')::uuid; runs jsonb; retention integer;
begin
  select least(31,greatest(1,coalesce(p.history_days,30))) into retention
    from public.user_profiles u left join public.subscription_plans p on p.id=u.plan_id where u.user_id=actor;
  if (access->>'available')::boolean then
    select coalesce(jsonb_agg(jsonb_build_object('id',j.id,'monitor_id',j.monitor_id,'period_start',j.period_start,
      'period_end',j.period_end,'status',j.status,'created_at',j.created_at,'result',j.result,'error_code',j.error_code,
      'provider',j.provider,'model',j.model,'prompt_version',j.prompt_version,'cost_usd',j.cost_usd,
      'reviews',(select coalesce(jsonb_agg(jsonb_build_object('recommendation_index',r.recommendation_index,'verdict',r.verdict)),'[]'::jsonb)
        from private.ai_reviews r where r.job_id=j.id and r.owner_id=actor)) order by j.created_at desc,j.id),'[]'::jsonb)
    into runs from (select * from private.ai_jobs j where j.owner_id=actor and private.ai_job_authorized(j)
      and exists(select 1 from public.user_monitors m where m.id::text=j.monitor_id and m.user_id=actor)
      -- Revalidate both historical evidence ownership and deletion/retention.
      and not exists(select 1 from jsonb_array_elements(j.evidence->'items') e where not exists(
        select 1 from public.monitored_items i join public.monitor_matches x on x.item_id=i.id
          join public.user_monitors m on m.id=x.monitor_id
        where i.id::text=e->>'id' and m.user_id=actor and m.id::text=j.monitor_id))
      order by j.created_at desc,j.id limit 20) j;
  end if;
  return jsonb_build_object('version',1,'owner_id',actor,'available',access->'available','reason',access->'reason',
    'quota',access->'quota','runs',coalesce(runs,'[]'::jsonb),
    'monitors',(select coalesce(jsonb_agg(jsonb_build_object('id',m.id::text,'name',m.name)),'[]'::jsonb)
      from (select id,name from public.user_monitors where user_id=actor order by name,id limit 100) m));
end $$;

create function public.request_ai_insights(p_start timestamptz,p_end timestamptz,p_monitor text,p_request_key uuid)
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
    case when i.content_metadata->'provenance'->>'excerpt_access'='permitted'
      and jsonb_typeof(i.content_metadata->'excerpt')='string' and length(i.content_metadata->>'excerpt')>0
      then coalesce(e.value->'metadata','{}'::jsonb)||jsonb_build_object('excerpt',left(i.content_metadata->>'excerpt',4000))
      else e.value->'metadata' end) order by e.ordinality)
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

create function public.claim_ai_insight_jobs(p_limit integer default 1) returns setof jsonb
language plpgsql security definer set search_path=pg_catalog set timezone='UTC' set lock_timeout='2s' as $$
begin
  if p_limit is null or p_limit not between 1 and 5 then raise exception 'AI_INVALID_BATCH' using errcode='22023'; end if;
  if not exists(select 1 from private.ai_system_config where singleton and enabled) then return; end if;
  update private.ai_jobs set status='dead',token=null,lease_until=null,error_code='lease_exhausted',finished_at=now()
    where status='running' and lease_until<now() and attempts>=3;
  -- Reservations belong to the UTC request month; old backlog cannot consume
  -- a new month's provider budget without another authorized reservation.
  update private.ai_jobs set status='dead',token=null,lease_until=null,error_code='budget_window_expired',finished_at=now()
    where status in ('pending','running') and (status='pending' or lease_until<now())
      and date_trunc('month',created_at)<>date_trunc('month',now());
  -- Expired/blocked/removed entitlements cannot start provider work.
  update private.ai_jobs j set status='dead',token=null,lease_until=null,error_code='access_revoked',finished_at=now()
    where j.status in ('pending','running') and (j.status='pending' or j.lease_until<now()) and not private.ai_job_authorized(j);
  return query with due as (
    select id from private.ai_jobs where attempts<3 and ((status='pending' and available_at<=now()) or (status='running' and lease_until<now()))
      order by available_at,id limit p_limit for update skip locked
  ), claimed as (
    update private.ai_jobs j set status='running',attempts=attempts+1,token=gen_random_uuid(),lease_until=now()+interval '5 minutes'
      from due where due.id=j.id returning j.*
  ) select jsonb_build_object('id',id,'owner_id',owner_id,'monitor_id',monitor_id,'monitor_name',monitor_name,
    'period_start',period_start,'period_end',period_end,'token',token,'attempts',attempts,'evidence',evidence,'limits',limits) from claimed;
end $$;

create function public.complete_ai_insight_job(p_id uuid,p_token uuid,p_result jsonb,p_provider text,p_model text,p_prompt_version text,p_cost_usd numeric)
returns boolean language plpgsql security definer set search_path=pg_catalog set timezone='UTC' set lock_timeout='2s' as $$
declare j private.ai_jobs%rowtype; e jsonb; group_row jsonb; evidence_id text; ids text[]; sources integer; sentiment text; previous integer; current_count integer;
begin
  select * into j from private.ai_jobs where id=p_id and token=p_token and status='running' and lease_until>now() for update;
  if not found then return false; end if;
  if not exists(select 1 from private.ai_system_config where singleton and enabled) or not private.ai_job_authorized(j) then
    raise exception 'AI_ACCESS_REVOKED' using errcode='42501'; end if;
  if p_cost_usd is null or p_cost_usd<0 or p_cost_usd>(j.limits->>'per_attempt_cost_usd')::numeric
    or nullif(p_provider,'') is null or length(p_provider)>100 or nullif(p_model,'') is null or length(p_model)>200
    or nullif(p_prompt_version,'') is null or length(p_prompt_version)>100
    or p_result is null or p_result->>'version' is distinct from '1' or jsonb_typeof(p_result->'evidence') is distinct from 'array'
    or jsonb_typeof(p_result->'evidence_ids') is distinct from 'array' or jsonb_typeof(p_result->'topics') is distinct from 'array'
    or jsonb_typeof(p_result->'recommendations') is distinct from 'array' or octet_length(p_result::text)>131072
    or p_result->>'method' is null or p_result->>'method' not in ('deterministic','model')
    or p_result->'entity' is distinct from j.evidence->'entity'
    or jsonb_typeof(p_result->'limitations') is distinct from 'array'
    or p_result->>'analysis_at' is null or not isfinite((p_result->>'analysis_at')::timestamptz)
    or jsonb_array_length(p_result->'topics')>100 then
    raise exception 'AI_INVALID_RESULT' using errcode='22023'; end if;
  select coalesce(array_agg(value),'{}'::text[]) into ids from jsonb_array_elements_text(p_result->'evidence_ids');
  if cardinality(ids)>100 or cardinality(ids)<>(select count(distinct x) from unnest(ids) x)
    or jsonb_array_length(p_result->'evidence')<>cardinality(ids) or jsonb_array_length(p_result->'recommendations')>50 then
    raise exception 'AI_INVALID_EVIDENCE' using errcode='22023'; end if;
  for e in select value from jsonb_array_elements(p_result->'evidence') loop
    if not (e->>'id'=any(ids)) or not exists(select 1 from jsonb_array_elements(j.evidence->'items') original
      where original->>'id'=e->>'id' and original->>'title'=e->>'title' and original->>'url'=e->>'url'
        and original->'source_id' is not distinct from e->'source_id'
        and original->'publisher' is not distinct from e->'publisher'
        and original->'detected_at' is not distinct from e->'detected_at'
        and original->'published_at' is not distinct from e->'published_at')
      or e->>'text_scope' is null or e->>'text_scope' not in ('title','excerpt') or nullif(e->>'excerpt','') is null
      or not exists(select 1 from jsonb_array_elements(j.evidence->'items') original where original->>'id'=e->>'id'
        and ((e->>'text_scope'='title' and e->>'excerpt'=original->>'title') or
          (e->>'text_scope'='excerpt' and e->>'excerpt'=original->'metadata'->>'excerpt')))
      or e->>'sentiment' is null or e->>'sentiment' not in ('positive','negative','neutral','mixed','uncertain')
      or e->>'stance' is null or e->>'stance' not in ('opinion','reported_quote','allegation','fact_report','uncertain')
      or not exists(select 1 from public.monitored_items i join public.monitor_matches x on x.item_id=i.id join public.user_monitors m on m.id=x.monitor_id
        where i.id::text=e->>'id' and m.user_id=j.owner_id and m.id::text=j.monitor_id) then
      raise exception 'AI_INVALID_EVIDENCE' using errcode='22023'; end if;
  end loop;
  if (select count(distinct value->>'id') from jsonb_array_elements(p_result->'evidence'))<>cardinality(ids) then
    raise exception 'AI_INVALID_EVIDENCE' using errcode='22023'; end if;
  for group_row in select value from jsonb_array_elements(p_result->'topics') union all select value from jsonb_array_elements(p_result->'recommendations') loop
    if jsonb_typeof(group_row->'evidence_ids') is distinct from 'array' then raise exception 'AI_INVALID_AGGREGATE' using errcode='22023'; end if;
    for evidence_id in select value from jsonb_array_elements_text(group_row->'evidence_ids') loop
      if not (evidence_id=any(ids)) then raise exception 'AI_INVALID_AGGREGATE' using errcode='22023'; end if;
    end loop;
    if coalesce((group_row->>'mentions')::integer,-1)<>(select count(distinct value) from jsonb_array_elements_text(group_row->'evidence_ids')) then
      raise exception 'AI_INVALID_AGGREGATE' using errcode='22023'; end if;
    select count(distinct nullif(v->>'source_id','')) into sources from jsonb_array_elements(p_result->'evidence') v
      where v->>'id' in (select value from jsonb_array_elements_text(group_row->'evidence_ids'));
    if coalesce((group_row->>'distinct_sources')::integer,-1)<>sources or jsonb_array_length(group_row->'evidence_ids')<1
      or jsonb_array_length(group_row->'evidence_ids')<>(select count(distinct value) from jsonb_array_elements_text(group_row->'evidence_ids')) then
      raise exception 'AI_INVALID_AGGREGATE' using errcode='22023'; end if;
  end loop;
  for group_row in select value from jsonb_array_elements(p_result->'topics') loop
    foreach sentiment in array array['positive','negative','neutral','mixed','uncertain'] loop
      if coalesce((group_row->>sentiment)::integer,-1)<>(select count(*) from jsonb_array_elements(p_result->'evidence') v
        where v->>'id' in (select value from jsonb_array_elements_text(group_row->'evidence_ids')) and v->>'sentiment'=sentiment) then
        raise exception 'AI_INVALID_AGGREGATE' using errcode='22023'; end if;
    end loop;
    if exists(select 1 from jsonb_array_elements(p_result->'evidence') v
      where v->>'id' in (select value from jsonb_array_elements_text(group_row->'evidence_ids')) and v->>'topic' is distinct from group_row->>'name') then
      raise exception 'AI_INVALID_AGGREGATE' using errcode='22023'; end if;
    select count(*) into previous from jsonb_array_elements(p_result->'evidence') v
      where v->>'id' in (select value from jsonb_array_elements_text(group_row->'evidence_ids'))
        and (v->>'detected_at')::timestamptz<j.period_start+(j.period_end-j.period_start)/2;
    current_count:=(group_row->>'mentions')::integer-previous;
    if coalesce((group_row->'change'->>'previous')::integer,-1)<>previous
      or coalesce((group_row->'change'->>'current')::integer,-1)<>current_count
      or (group_row->'change'->>'delta')::integer is distinct from current_count-previous then
      raise exception 'AI_INVALID_AGGREGATE' using errcode='22023'; end if;
  end loop;
  if (select coalesce(sum(jsonb_array_length(v->'evidence_ids')),0) from jsonb_array_elements(p_result->'topics') v)<>cardinality(ids)
    or (select count(distinct v->>'name') from jsonb_array_elements(p_result->'topics') v)<>jsonb_array_length(p_result->'topics') then
    raise exception 'AI_INVALID_AGGREGATE' using errcode='22023'; end if;
  for group_row in select value from jsonb_array_elements(p_result->'recommendations') loop
    if (group_row->>'mentions')::integer<3 or (group_row->>'distinct_sources')::integer<2
      or group_row->>'sentiment' is distinct from 'negative'
      or group_row->>'confidence' is null or group_row->>'confidence' not in ('low','moderate')
      or nullif(group_row->>'confidence_explanation','') is null
      or nullif(group_row->>'action','') is null or nullif(group_row->>'expected_benefit','') is null
      or (group_row->>'period_start')::timestamptz is distinct from j.period_start
      or (group_row->>'period_end')::timestamptz is distinct from j.period_end
      or exists(select 1 from jsonb_array_elements(p_result->'evidence') v
        where v->>'id' in (select value from jsonb_array_elements_text(group_row->'evidence_ids')) and
          (v->>'text_scope'<>'excerpt' or v->>'sentiment'<>'negative' or v->>'stance'<>'opinion' or v->>'topic' is distinct from group_row->>'topic')) then
      raise exception 'AI_INSUFFICIENT_RECOMMENDATION_EVIDENCE' using errcode='22023'; end if;
  end loop;
  update private.ai_jobs set status='complete',result=p_result,provider=p_provider,model=p_model,prompt_version=p_prompt_version,
    cost_usd=p_cost_usd,finished_at=now(),token=null,lease_until=null,error_code=null where id=j.id;
  return true;
end $$;

create function public.cancel_ai_insight_job(p_job_id uuid) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare access jsonb:=private.ai_access(); updated integer;
begin
  update private.ai_jobs set status='dead',token=null,lease_until=null,error_code='cancelled',finished_at=now()
    where id=p_job_id and owner_id=(access->>'owner_id')::uuid and status in ('pending','running');
  get diagnostics updated=row_count; return updated=1;
end $$;

-- Opt-in trusted batches may physically purge terminal private snapshots. No
-- schedule is installed, and running leases are never deleted by cleanup.
create function public.prune_ai_insight_jobs(p_limit integer default 100) returns integer
language plpgsql security definer set search_path=pg_catalog as $$
declare removed integer;
begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'AI_INVALID_BATCH' using errcode='22023'; end if;
  delete from private.ai_jobs where id in (
    select j.id from private.ai_jobs j left join public.user_profiles u on u.user_id=j.owner_id
      left join public.subscription_plans p on p.id=u.plan_id
    where j.status in ('complete','dead') and (u.user_id is null
      or not exists(select 1 from public.user_monitors m where m.id::text=j.monitor_id and m.user_id=j.owner_id)
      or j.period_start<now()-make_interval(days=>least(31,greatest(1,coalesce(p.history_days,30))))-interval '5 minutes'
      or exists(select 1 from jsonb_array_elements(j.evidence->'items') e where e->'metadata'->>'excerpt' is not null and not exists(
        select 1 from public.monitored_items i where i.id::text=e->>'id'
          and i.content_metadata->'provenance'->>'excerpt_access'='permitted'
          and left(i.content_metadata->>'excerpt',4000)=e->'metadata'->>'excerpt')))
    order by j.period_start,j.id limit p_limit for update of j skip locked
  );
  get diagnostics removed=row_count; return removed;
end $$;

create function public.fail_ai_insight_job(p_id uuid,p_token uuid,p_error_code text) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare updated integer;
begin
  if p_error_code not in ('provider_unavailable','invalid_output','processing_failed','budget_exceeded','cancelled') or p_error_code is null then
    raise exception 'AI_INVALID_ERROR_CODE' using errcode='22023'; end if;
  update private.ai_jobs set status=case when attempts>=3 or p_error_code in ('invalid_output','budget_exceeded','cancelled') then 'dead' else 'pending' end,
    available_at=now()+make_interval(secs=>30*power(2,attempts-1)::integer),token=null,lease_until=null,error_code=p_error_code,
    finished_at=case when attempts>=3 or p_error_code in ('invalid_output','budget_exceeded','cancelled') then now() else null end where id=p_id and token=p_token and status='running' and lease_until>now();
  get diagnostics updated=row_count; return updated=1;
end $$;

create function public.review_ai_recommendation(p_job_id uuid,p_index integer,p_verdict text) returns boolean
language plpgsql security definer set search_path=pg_catalog as $$
declare access jsonb:=private.ai_access(); actor uuid:=(access->>'owner_id')::uuid; result jsonb;
begin
  if not (access->>'available')::boolean then raise exception 'AI_FEATURE_UNAVAILABLE' using errcode='42501'; end if;
  select j.result into result from private.ai_jobs j where j.id=p_job_id and j.owner_id=actor and j.status='complete' and private.ai_job_authorized(j);
  if not found or p_index is null or p_index<0 or p_index>=jsonb_array_length(result->'recommendations')
    or p_verdict is null or p_verdict not in ('accepted','rejected','needs_review') then raise exception 'AI_REVIEW_DENIED' using errcode='42501'; end if;
  insert into private.ai_reviews(job_id,owner_id,recommendation_index,verdict) values(p_job_id,actor,p_index,p_verdict)
    on conflict(job_id,recommendation_index) do update set verdict=excluded.verdict,updated_at=now();
  return true;
end $$;

revoke all on function public.get_ai_insights(),public.request_ai_insights(timestamptz,timestamptz,text,uuid),
  public.review_ai_recommendation(uuid,integer,text),public.cancel_ai_insight_job(uuid) from public,anon;
grant execute on function public.get_ai_insights(),public.request_ai_insights(timestamptz,timestamptz,text,uuid),
  public.review_ai_recommendation(uuid,integer,text),public.cancel_ai_insight_job(uuid) to authenticated;
revoke all on function public.claim_ai_insight_jobs(integer),public.complete_ai_insight_job(uuid,uuid,jsonb,text,text,text,numeric),
  public.fail_ai_insight_job(uuid,uuid,text),public.prune_ai_insight_jobs(integer) from public,anon,authenticated;
grant execute on function public.claim_ai_insight_jobs(integer),public.complete_ai_insight_job(uuid,uuid,jsonb,text,text,text,numeric),
  public.fail_ai_insight_job(uuid,uuid,text),public.prune_ai_insight_jobs(integer) to service_role;
commit;
