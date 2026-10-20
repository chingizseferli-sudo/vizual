-- sent_news.link is the worker's "already sent" key, but the baseline created it
-- as a plain index. Two workers (or two threads reading the same article from two
-- sources) could both reserve a link and both send the alert. Make it unique.

delete from public.sent_news newer
using public.sent_news older
where newer.link = older.link
  and (newer.created_at, newer.id) > (older.created_at, older.id);

create unique index if not exists sent_news_link_key on public.sent_news (link);
drop index if exists public.sent_news_link_idx;

-- The same headline stored twice by one source under different URLs within a
-- day is one story: keep the first copy. Matches and alerts of the removed copy
-- go with it (on delete cascade).
delete from public.monitored_items newer
using public.monitored_items older
where newer.source_id = older.source_id
  and lower(btrim(newer.title)) = lower(btrim(older.title))
  and (newer.created_at, newer.id) > (older.created_at, older.id)
  and newer.created_at - older.created_at < interval '1 day';
