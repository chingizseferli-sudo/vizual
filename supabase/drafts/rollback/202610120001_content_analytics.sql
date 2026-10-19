-- Export new metadata/job records and stop analytics processing first.
-- LOCAL TEST ROLLBACK ONLY until a production rollback is explicitly approved.
begin;
drop function public.get_content_analytics(timestamptz,timestamptz,text,text,integer);
drop trigger analytics_metadata_write_guard on public.monitored_items;
drop function public.protect_content_metadata();
drop table private.content_processing_jobs;
drop index public.analytics_matches_monitor_item;
drop index public.analytics_monitors_owner;
drop index public.analytics_items_detection;
drop index public.analytics_items_text_identity;
drop index public.analytics_items_unprocessed;
alter table public.monitored_items drop constraint monitored_items_content_metadata_shape;
alter table public.monitored_items drop column content_metadata;
commit;
