-- Backfill Telegram-delivered news to source_id more reliably.
-- This is intentionally conservative: it only fills missing source_id values.

alter table public.sent_news
  add column if not exists source_id uuid references public.sources(id) on delete set null;


create index if not exists sent_news_link_idx on public.sent_news(link);
create index if not exists sources_base_url_idx on public.sources(base_url);
create index if not exists sources_latest_url_idx on public.sources(latest_url);
create index if not exists sources_rss_url_idx on public.sources(rss_url);

with source_hosts as (
  select
    id,
    status,
    discovery_status,
    lower(nullif(regexp_replace(regexp_replace(coalesce(base_url, ''), '^https?://(www\.)?', ''), '/.*$', ''), '')) as base_host,
    lower(nullif(regexp_replace(regexp_replace(coalesce(latest_url, ''), '^https?://(www\.)?', ''), '/.*$', ''), '')) as latest_host,
    lower(nullif(regexp_replace(regexp_replace(coalesce(rss_url, ''), '^https?://(www\.)?', ''), '/.*$', ''), '')) as rss_host,
    lower(nullif(coalesce(name, ''), '')) as source_name
  from public.sources
), sent_hosts as (
  select
    id,
    lower(nullif(regexp_replace(regexp_replace(coalesce(link, ''), '^https?://(www\.)?', ''), '/.*$', ''), '')) as link_host,
    lower(nullif(regexp_replace(regexp_replace(coalesce(source, ''), '^https?://(www\.)?', ''), '/.*$', ''), '')) as source_host,
    lower(nullif(coalesce(source, ''), '')) as source_name
  from public.sent_news
  where source_id is null
), ranked_matches as (
  select
    sent.id as sent_id,
    source.id as source_id,
    row_number() over (
      partition by sent.id
      order by
        case
          when sent.link_host is not null and sent.link_host in (source.base_host, source.latest_host, source.rss_host) then 1
          when sent.source_host is not null and sent.source_host in (source.base_host, source.latest_host, source.rss_host) then 2
          when sent.link_host is not null and (
            sent.link_host like '%.' || source.base_host or
            sent.link_host like '%.' || source.latest_host or
            sent.link_host like '%.' || source.rss_host
          ) then 3
          when sent.source_host is not null and (
            sent.source_host like '%.' || source.base_host or
            sent.source_host like '%.' || source.latest_host or
            sent.source_host like '%.' || source.rss_host
          ) then 4
          when sent.source_name is not null and sent.source_name = source.source_name then 5
          else 9
        end,
        case when source.status = 'active' then 0 else 1 end,
        case when source.discovery_status = 'accepted' then 0 else 1 end,
        source.id
    ) as rank
  from sent_hosts sent
  join source_hosts source on (
    (sent.link_host is not null and (
      sent.link_host in (source.base_host, source.latest_host, source.rss_host) or
      sent.link_host like '%.' || source.base_host or
      sent.link_host like '%.' || source.latest_host or
      sent.link_host like '%.' || source.rss_host
    )) or
    (sent.source_host is not null and (
      sent.source_host in (source.base_host, source.latest_host, source.rss_host) or
      sent.source_host like '%.' || source.base_host or
      sent.source_host like '%.' || source.latest_host or
      sent.source_host like '%.' || source.rss_host
    )) or
    (sent.source_name is not null and sent.source_name = source.source_name)
  )
)
update public.sent_news news
set source_id = ranked.source_id
from ranked_matches ranked
where ranked.rank = 1
  and news.id = ranked.sent_id
  and news.source_id is null;

