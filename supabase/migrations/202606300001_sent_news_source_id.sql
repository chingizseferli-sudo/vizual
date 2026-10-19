-- Link Telegram-delivered news to the exact source that produced it.
-- This makes source health depend on real delivered news instead of host/title guessing.

alter table public.sent_news
  add column if not exists source_id uuid references public.sources(id) on delete set null;

create index if not exists sent_news_source_id_idx on public.sent_news(source_id);
create index if not exists sent_news_created_at_idx on public.sent_news(created_at);

-- Best-effort backfill for existing rows. Future bot writes should send source_id directly.
with source_hosts as (
  select
    id,
    lower(regexp_replace(regexp_replace(coalesce(base_url, latest_url, rss_url, ''), '^https?://(www\.)?', ''), '/.*$', '')) as host,
    lower(coalesce(name, '')) as source_name
  from public.sources
), sent_hosts as (
  select
    id,
    lower(regexp_replace(regexp_replace(coalesce(link, ''), '^https?://(www\.)?', ''), '/.*$', '')) as host,
    lower(coalesce(source, '')) as source_name
  from public.sent_news
  where source_id is null
)
update public.sent_news sn
set source_id = sh.id
from sent_hosts sent
join source_hosts sh on (
  sent.host <> '' and sh.host <> '' and (
    sent.host = sh.host or sent.host like '%.' || sh.host or sh.host like '%.' || sent.host
  )
) or (
  sent.source_name <> '' and sh.source_name <> '' and sent.source_name = sh.source_name
)
where sn.id = sent.id
  and sn.source_id is null;
