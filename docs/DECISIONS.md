# Decisions

Short, dated, final. Add a line, don't write an essay.

- 2026-10-18: Production database is Supabase `npkctnzvyemfetsfkzcm`. The `tehsilbot` project (`xhfmlktxedbgxmatzqiq`) is legacy (only `sent_news`) and will be removed.
- 2026-10-19: Both old Supabase projects deleted. New production project `wqxkymgilurvbvsymcvy` is built only from `supabase/migrations` (baseline added); users, admins, plans, monitors, keywords and sources were carried over from a data backup. News, matches, alerts and logs were not carried over.
- 2026-10-18: One Python worker image + one Postgres. No microservices, no queue service until measured need (pgmq first).
- 2026-10-18: Retention: archive first, then delete (sources disabled → archived → purged after 180 days).
- 2026-10-18: Brave Search does not cover Instagram/Facebook (0 relevant AZ posts in a 20-keyword test); not used for social.
- 2026-10-18: Facebook via Apify keyword search (162/200 relevant), Instagram via SocialFetch hashtag feed (292/483 relevant). Both unofficial; shown as beta.
- 2026-10-19: Cheapest combination: Apify Starter ($19) + SocialFetch Starter ($29). Default social check interval 6 h. Facebook always `monitorMode`.
- 2026-10-19: Four repos merged into this monorepo. Node AI/content pipeline (regex "sentiment", macro-F1 0.33) removed; sentiment returns only after a real evaluation reaches macro-F1 ≥ 0.70.

- 2026-10-19: Empty reads (`selector_empty`, `rss_empty`, ...) count toward `consecutive_fail_count`; after 3 in a row (`EMPTY_READ_FAIL_THRESHOLD`) the source gets `last_error`. Requires `SOURCE_HEALTH_ENABLED=true`.
- 2026-10-20: Customers see keywords, not monitors. One hidden monitor per customer holds all keywords; limits count active keywords (`limits.max_keywords`, else 20 × `max_watches`). `max_watches` now limits only web page watches.
- 2026-10-23: Web page watching removed (UI, `page_change` worker, `change_*` tables, `max_watches`; migration `20261023000006`). Keyword limit is `limits.max_keywords`; unset means unlimited.
