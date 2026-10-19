-- Isolated rollback: restore M4 contracts without editing applied source SQL.
begin;
drop function public.complete_ai_insight_job(uuid,uuid,jsonb,text,text,text,numeric);
alter function public.complete_ai_insight_job_m4(uuid,uuid,jsonb,text,text,text,numeric) rename to complete_ai_insight_job;
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
              and left(i.content_metadata->>'excerpt',4000)=e->'metadata'->>'excerpt')))));
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


drop function private.ai_project_content_metadata(public.monitored_items,jsonb);
drop function public.enqueue_content_intake(uuid,text,uuid);
drop function public.claim_content_intake(integer);
drop function public.complete_content_intake(uuid,uuid,jsonb);
drop function public.fail_content_intake(uuid,uuid,text);
drop function public.cancel_content_intake(uuid,uuid);
drop function public.prune_content_intake(integer);
drop index public.content_quality_source;
drop function private.content_intake_authorized(private.content_intake_jobs);
drop table private.content_intake_requests;
drop table private.content_intake_jobs;
drop table private.content_intake_usage;
drop table private.content_source_permissions;
drop table private.content_intake_config;
commit;
