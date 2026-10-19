# Vizual security notes

## Threat model

1. The browser bundle and the anon key are public; anyone can call PostgREST/RPC directly, so **RLS and SQL privileges are the only real access control**. Admin routing in the SPA is cosmetic.
2. Tenants (customers) must never read or change another tenant's monitors, matches, change watches, alerts or Telegram chat ids.
3. Admin rights come only from `public.admin_users`; customer-writable tables (`user_profiles`) must never grant privilege or a paid plan.
4. Scraped third-party HTML/URLs (selector proxy, news sources, monitored items) are hostile input: they must not run script in the app origin.
5. Edge functions and workers hold the service-role key; their inputs (URLs, user ids) are untrusted (SSRF, injection).

## Findings

| # | Severity | Location | Finding | Status |
|---|----------|----------|---------|--------|
| 1 | Critical | `apps/web/src/routes/(auth)/monitor/watch-monitor.tsx:4116`, `apps/web/src/routes/(auth)/admin/monitor/picker.tsx:680` | Proxied third-party HTML rendered via `srcDoc` with `sandbox="allow-scripts allow-same-origin"`: page script ran in the app origin and could read the Supabase session from localStorage. Proxy sanitizer is regex-based and bypassable (`supabase/functions/selector-proxy/index.ts:40`). | Fixed (`allow-same-origin` removed) |
| 2 | High | `apps/web/src/routes/(auth)/monitor/watch-monitor.tsx:2411`, `.../admin/monitor/picker.tsx:436` | `message` listeners accepted any sender; a framed page could trigger `saveExtensionSelection` (creates a watch). | Fixed (checks `event.source`) |
| 3 | High | prod policy on `public.news` ("Allow public insert/update/delete news") | Anon can write/delete news. | Fixed in migration §3 |
| 4 | High | prod policy on `public.change_alerts` ("Allow authenticated read change alerts", `USING true`) | Any user reads all tenants' alerts incl. `telegram_chat_id`. | Fixed in migration §4 |
| 5 | High | prod: `discovery_logs`, `rejected_sources`, `sent_news` | Readable by anon. | Fixed in migration §5 (admin-only) |
| 6 | High | `supabase/migrations/202606190001_monitor_data_retention_30_days.sql:28`, `202606180001_source_health_fields.sql:35` | SECURITY DEFINER `cleanup_old_monitor_data` / `increment_source_fail` still executable by PUBLIC/anon (Postgres default); v1 allowed `days_to_keep=1` = anon data wipe. | Fixed in migration §7 |
| 7 | High | `supabase/migrations/202607070001_public_site_settings.sql:22`, `202606270003_rls_hardening_release1.sql:93` | `is_admin_user()` redefined on `user_profiles.role`; INSERT of own profile was unguarded (role=`admin` or paid `plan_id`). | Fixed in migration §1–2 |
| 8 | Medium | `supabase/migrations/202606290003_admin_users_separate_auth.sql:86` | Any admin could create superadmins. | Fixed (superadmin-only writes, §1) |
| 9 | Medium | `supabase/migrations/202606190002_prune_non_news_sources.sql:20` | `source_cleanup_archive` created via CTAS without RLS. | Fixed (§5, if table exists) |
| 10 | Medium | `apps/web/src/components/layout/customer-notifications.tsx:157`, `features/news/components/news-row-actions.tsx:64`, `watch-monitor.tsx:1612,2279` | `window.open` on scraped URLs allowed `javascript:`. | Fixed (`openExternalUrl`, http/https only) |
| 11 | Medium | `supabase/migrations/202606290001_customer_change_monitor_access.sql:29` | Customers insert `change_sources` directly: interval floor and watch-count limit were client-side only. | Interval floor fixed (§6); count limit **open** |
| 12 | Medium | `supabase/functions/_shared/url_safety.ts:103` | SSRF guard: DNS check is best-effort and not pinned (rebinding). Any authenticated user can use `selector-proxy` / `change-selector-test`, no rate limit. | Open |
| 13 | Low | `supabase/functions/admin-users/index.ts:220` | `user_id` not validated before use in REST filters/Admin API paths. | Fixed (UUID check) |
| 14 | Low | `supabase/functions/*/index.ts:4-6` | `Access-Control-Allow-Origin: *`; errors echo upstream response bodies. | Open |
| 15 | Low | `supabase/migrations/202607070003_public_site_assets_bucket.sql:13` | Public bucket allows `image/svg+xml` (script-capable, served from storage origin; admin-only upload). | Open |
| 16 | Info | `supabase/migrations/202606010000_baseline_core_schema.sql` | Owner policies for `user_monitors`/`monitor_keywords` (now in the baseline) allow direct inserts that bypass `create_user_monitor_with_limit`. | Open |
| 17 | High | Telegram: `apps/web/src/routes/(auth)/monitor/profile.tsx`, `apps/worker/rss/site_monitor.py` (`connect_telegram_users_from_updates`) | Bot linked any chat that sent `/start <auth user uuid>`; anyone who learned a user's UUID received that user's alerts. | Fixed: single-use 15-min tokens (`create_telegram_link_token`, migration `20261019000002`); UUID payloads rejected unless `TELEGRAM_ALLOW_LEGACY_UUID_LINK=true`. Deploy web + worker together after the migration. |

No service-role or other secret is referenced via `VITE_*` or client code (only `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_TELEGRAM_BOT_USERNAME`). No `dangerouslySetInnerHTML`; `textarea.innerHTML` entity decoding is inert. Sign-in redirect is restricted to `/monitor*` / `/admin*`.

## Applying `supabase/migrations/20261019000001_security_hardening.sql`

The migration is idempotent and runs as part of `supabase db push` on the new project (2026-10-19). The checklist below still applies to any database created before the baseline.

1. **Before**: `apps/worker` already uses the service-role key for `sent_news`, `discovery_logs` and `rejected_sources` and never writes `news`; confirm any other deployed worker (e.g. tehsilbot) also writes `news`, `sent_news`, `discovery_logs`, `rejected_sources`, `notification_logs` with the **service-role** key. In-repo, `news` is written only by the admin UI (`features/news/*`, `routes/(auth)/admin/news/$id/edit.tsx`) using an authenticated admin session, not the anon role. Confirm `public.admin_users` exists and holds every real admin, and at least one `superadmin`.
2. Check for duplicate indexes: `select indexdef from pg_indexes where schemaname='public' and tablename in ('monitor_matches','monitor_alerts','user_monitors','monitor_keywords','change_events','change_snapshots','change_alerts');` — drop §8 lines already covered. On large tables run them as `CREATE INDEX CONCURRENTLY` by hand instead.
3. Apply on **staging** (`psql "$STAGING_DB_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20261019000001_security_hardening.sql`) and read the WARNING/NOTICE output.
4. Verify on staging: anon `insert into news` fails; customer A cannot see customer B's `change_alerts`; anon cannot `select` `sent_news`/`discovery_logs`; `select public.cleanup_old_monitor_data(30)` as anon fails; admin news CRUD, admin logs/sources pages, customer watch-monitor and notifications still work; workers still write.
5. Apply to production in a low-traffic window, then record it in `supabase_migrations.schema_migrations` (`supabase migration repair --status applied 20261019000001`).

## Secrets handling rules

- Only the Supabase URL, anon key and public bot username may use the `VITE_` prefix; everything with `VITE_` ships to every browser.
- `SUPABASE_SERVICE_ROLE_KEY`, Telegram bot tokens, AI/provider keys live only in Supabase Edge Function secrets, Vercel server env (never `VITE_`), GitHub Actions secrets, or the worker host.
- Never commit `.env*` (except `.env.example` with placeholders); rotate any key that reaches git history, logs or a ticket.
- Edge functions must authenticate the caller (`requireAuthenticated`/`requireAdmin`) before using the service-role key, and must not return the key or raw upstream errors.
- New tables: enable RLS in the same migration, `revoke all ... from anon`, and add explicit policies. New SECURITY DEFINER functions: `set search_path = ''`, check `auth.uid()`/`is_admin_user()` inside, and `revoke execute ... from public, anon`.
