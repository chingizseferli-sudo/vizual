-- Isolated rollback only. Stop processing/export new data before any approved rollback.
begin;
drop function public.get_ai_insights();
drop function public.request_ai_insights(timestamptz,timestamptz,text,uuid);
drop function public.review_ai_recommendation(uuid,integer,text);
drop function public.cancel_ai_insight_job(uuid);
drop function public.claim_ai_insight_jobs(integer);
drop function public.complete_ai_insight_job(uuid,uuid,jsonb,text,text,text,numeric);
drop function public.fail_ai_insight_job(uuid,uuid,text);
drop function public.prune_ai_insight_jobs(integer);
drop function private.ai_access();
drop function private.ai_job_authorized(private.ai_jobs);
drop table private.ai_reviews;
drop table private.ai_jobs;
drop table private.ai_usage;
drop table private.ai_plan_features;
drop table private.ai_system_config;
commit;
