-- Prevent duplicate Watch Monitor rows for the same owner, URL and selector.
-- Admin/global watches use a fixed sentinel owner key because user_id is NULL.

create unique index if not exists idx_change_sources_owner_url_selector_unique
on public.change_sources (
  coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid),
  url,
  selector
)
where url is not null
  and selector is not null
  and length(trim(url)) > 0
  and length(trim(selector)) > 0;
