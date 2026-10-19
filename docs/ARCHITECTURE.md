# Architecture

Scale target: up to 1,000 customers (expected ~100). One Postgres, a few worker processes, no microservices.

```
Vercel: apps/web ──(anon key + RLS)──► Supabase Postgres ◄──(service role)── Railway: apps/worker
                                             │                               ├─ rss          (loop)
                                             │                               ├─ page_change  (loop)
                                             │                               └─ discovery*   (cron)
Customers ◄── Telegram Bot API ◄─────────────┴───────────────────────────────┘
```

## Data model (source-centric)
- Global: `sources` (news sites/RSS), `monitored_items` (collected articles). Collected once, shared by all tenants.
- Per tenant: `user_monitors`, `monitor_keywords`, `monitor_matches`, `monitor_alerts`, `change_sources`, `change_alerts`, `user_profiles`.
- A keyword match fans out from one `monitored_items` row to every tenant whose keywords match. Cost does not grow with tenant count.

## Workers (`apps/worker`)
One Docker image; `WORKER` picks the process (see `start.sh`).
- `rss`: polls sources, extracts articles, matches keywords (Azerbaijani-aware folding), writes matches, sends Telegram alerts, links Telegram chats via `/start`.
- `page_change`: fetches customer-selected page regions (SSRF-guarded), detects changes, writes `change_alerts`, sends Telegram.
- `discovery`, `discovery_deep`, `sync_sources`, `auto_configure`, `readability`: one-shot jobs for source maintenance.

## Telegram bot
- Linking: the profile page calls `create_telegram_link_token()` (random, single-use, 15 min) and opens `t.me/<bot>?start=<token>`; the `rss` worker redeems it from `telegram_link_tokens`. Raw `/start <user uuid>` is rejected unless `TELEGRAM_ALLOW_LEGACY_UUID_LINK=true`.
- Commands: `/start <token>`, `/status`, `/monitors` (monitors and keywords), `/pause` and `/resume` (this chat's alerts, link kept), `/stop` (unlinks the chat), `/help`. Admins (an active `admin_users` row whose profile has this chat) also get `/stats`, `/errors` (sources with 3+ failed reads), `/pause_all` and `/resume_all` (`bot_settings.notifications_paused`). Replies ignore the global pause.
- The `rss` service long-polls commands in its own thread, so replies don't wait for a news cycle. It fills Telegram's "/" menu with `setMyCommands` at start and hourly; admin commands are scoped to admin chats.
- `/admin/telegram`: `bot_settings.notifications_paused` pauses customer alerts (worker re-reads every 60 s, skipped sends count as `telegram_disabled`); `bot_runtime_state` holds the `getUpdates` offset and heartbeat (`last_poll_at`, `last_error`, `last_send_ok_at`), with `telegram_offset.json` only as fallback before migration `20261019000002` is applied.

## Social sources (next step)
- Facebook: Apify `topapi/facebook-search-posts-scraper`, keyword search, `monitorMode`.
- Instagram: SocialFetch `GET /v2/instagram/hashtags/{tag}/media?tab=recent`.
- Both are unofficial scraping vendors: treat as "beta" sources behind one provider interface so either can be swapped. Results land in `monitored_items` with `platform` and `external_id`.

## Known gaps
- `site_health.json` lives on ephemeral disk; move to a DB table (Telegram offset already moved to `bot_runtime_state`).
- `DB_LOCK` serialises all worker DB calls; fine at current scale, revisit before 100 customers.
