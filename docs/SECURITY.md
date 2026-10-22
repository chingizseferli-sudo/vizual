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
| 11 | Medium | `supabase/migrations/202606290001_customer_change_monitor_access.sql:29` | Customers insert `change_sources` directly: interval floor and watch-count limit were client-side only. | Fixed: interval floor (`20261019000001` §6); `max_watches` count limit on customer inserts (`20261019000003` §4) |
| 12 | Medium | `supabase/functions/_shared/url_safety.ts:103` | SSRF guard: DNS check is best-effort and not pinned (rebinding). Any authenticated user can use `selector-proxy` / `change-selector-test`, no rate limit. | Partly fixed: 60 req/10 min per user (`_shared/rate_limit.ts`, fails open if the RPC is missing), IPv4-compatible/NAT64/6to4/Teredo literals blocked. Edge rebinding **open**: Deno `fetch` cannot pin the resolved IP. The worker has the same guard pinned (#21). |
| 13 | Low | `supabase/functions/admin-users/index.ts:220` | `user_id` not validated before use in REST filters/Admin API paths. | Fixed (UUID check) |
| 14 | Low | `supabase/functions/*/index.ts:4-6` | `Access-Control-Allow-Origin: *`; errors echo upstream response bodies. | Fixed in code (`_shared/cors.ts`, `selector-proxy` no longer returns `technicalError`); takes effect once the `ALLOWED_ORIGINS` function secret is set. Admin-only functions still return upstream error text to admins. |
| 15 | Low | `supabase/migrations/202607070003_public_site_assets_bucket.sql:13` | Public bucket allows `image/svg+xml` (script-capable, served from storage origin; admin-only upload). | Fixed: bucket and upload form PNG/JPEG/WebP only (`20261019000003` §7). SVGs already uploaded stay until replaced. |
| 16 | Info | `supabase/migrations/202606010000_baseline_core_schema.sql` | Owner policies for `user_monitors`/`monitor_keywords` (now in the baseline) allow direct inserts that bypass `create_user_monitor_with_limit`. | Fixed: direct `user_monitors` INSERT policy dropped, RPC serialised per user; keyword cap (`limits.max_keywords`, else 20 × `max_watches`) and 1–200 chars (`20261019000003` §2–3); customers cannot reactivate a monitor past `max_watches`, existing excess monitors set inactive with `inactive_reason='plan_limit'` (`20261020000002`) |
| 17 | High | Telegram: `apps/web/src/routes/(auth)/monitor/profile.tsx`, `apps/worker/rss/site_monitor.py` (`connect_telegram_users_from_updates`) | Bot linked any chat that sent `/start <auth user uuid>`; anyone who learned a user's UUID received that user's alerts. | Fixed: single-use 15-min tokens (`create_telegram_link_token`, migration `20261019000002`); UUID payloads rejected unless `TELEGRAM_ALLOW_LEGACY_UUID_LINK=true`. Deploy web + worker together after the migration. |
| 18 | Medium | `user_profiles` / `user_monitors` owner UPDATE policies | Customers could write `telegram_chat_id` (pointing the bot at any chat without the one-time token) and `user_profiles.email` (spoofing what admins see). | Fixed: only unlink (NULL) allowed for customers (`20261019000003` §2, §5) |
| 19 | Medium | git history: `supabase/migrations/202606290004_assign_global_watches_to_chingiz.sql` (commit `9405824`, deleted in `d95bb05`) | A customer's personal email address is in the public repository history. No keys, JWTs or tokens found in tree or history. | **Open**: owner decides on a history rewrite (`git filter-repo`) + force push, or accepts it |
| 20 | Low | `apps/web/vercel.json` | No security headers (clickjacking, no CSP). | Fixed: CSP, `frame-ancestors 'none'`/`X-Frame-Options`, nosniff, Referrer-Policy, Permissions-Policy, HSTS, COOP. `script-src` keeps `'unsafe-inline'` because the srcdoc selector picker inherits the CSP; removing it needs the picker script served as a file or the preview on its own origin |
| 21 | Medium | `apps/worker/page_change/change_monitor.py` (`safe_http_request`) | Resolve-then-connect: DNS rebinding could reach private addresses. | Fixed: connections check the connected peer before sending (`_PeerCheckMixin`), env proxies ignored |
| 22 | Low | `public.is_admin_user()`, `cleanup_source_domain` | `is_admin_user()` executable by anon; `cleanup_source_domain` without `search_path`. | Fixed: `subscription_plans` read policy split per role, EXECUTE revoked from anon (`20261019000003` §6) |
| 23 | Low | `change_sources.telegram_chat_id` (watch form) | Customers may type any chat id for page-watch alerts (by design: group chats), so the bot can message any chat that has it. | Open (product decision) |
| 24 | Low | `apps/worker/rss/site_monitor.py` (`fetch_page`, `fetch_site`) | News source fetches have no SSRF guard; sources are admin- or discovery-managed, not customer input. | Open |
| 25 | Info | `telegram_link_tokens`, `source_cleanup_archive`, `edge_rate_limits` | RLS on with no policies and grants revoked: deny-all for API roles, service role only. | Intended |

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

## Owner steps (dashboard, not in code)

- Apply `supabase/migrations/20261019000003_plan_limits_and_privileges.sql` (`supabase db push`) before deploying the edge functions; their rate limit fails open without it. Customers then see `PLAN_WATCH_LIMIT_REACHED` / `PLAN_KEYWORD_LIMIT_REACHED` when over plan.
- Auth → Providers → Email/Password: enable **leaked password protection**, minimum length ≥ 8 with character requirements, keep email confirmation on.
- Auth → URL Configuration: Site URL and Redirect URLs list only the production domain(s) (password reset and sign-up use `window.location.origin`).
- Auth → Rate limits: review sign-up/sign-in/email limits; consider CAPTCHA on sign-up (anyone can sign up and call `selector-proxy`).
- Admin two-step login (`20261022000002_admin_requires_mfa.sql`): `is_admin_user()` and edge-function `requireAdmin` accept only aal2 (TOTP-verified) sessions; `/admin/mfa` enrolls or challenges after the password. Keep Auth → Multi-Factor → TOTP enabled. Lost phone: Authentication → Users → the admin → delete the MFA factor; the next sign-in enrolls a new one.
- Edge Functions → Secrets: set `ALLOWED_ORIGINS` (e.g. `https://vizual.az,https://www.vizual.az`), then redeploy all four functions.
- Storage → `public-site-assets`: replace any existing `.svg` logo/icon.
- Decide on finding #19 (history rewrite).
