# Agent instructions (Claude Code, Codex, any coding agent)

Keep it small and verified. This repo replaced four repos and a pile of AI-written notes; do not recreate that.

## Rules
- One database: Supabase project `wqxkymgilurvbvsymcvy` ("vizual", production). Never run SQL against production from an agent. `supabase/migrations/` rebuilds the full schema from zero (baseline `202606010000`); new schema is a new migration, tested locally first.
- Every table customers can read needs RLS scoped to `auth.uid()`; admin checks happen in SQL (`public.is_admin_user()`), never only in the UI.
- Workers use the service-role key; it must never reach `apps/web` (no `VITE_*` secrets).
- Social data (Apify, SocialFetch) is fetched only through `apps/worker`. Facebook search always uses `monitorMode` + `sortBy=recent`; query each unique keyword once and fan out to tenants.
- Do not add new markdown files for status, milestones or plans. Update the existing docs or the PR description.
- Do not add code "for later". Delete dead code instead of commenting it out.
- Before finishing: `apps/web`: `pnpm typecheck && pnpm lint && pnpm build`; `apps/worker`: `pytest -q`.

## Where things are
- Keyword matching: `apps/worker/rss/site_monitor.py` (`keyword_fold`, `keyword_matches_title`).
- Telegram delivery and bot commands: `apps/worker/rss/site_monitor.py` (`send_telegram`, `connect_telegram_users_from_updates`).
- Customer and admin routes: `apps/web/src/routes/(auth)/monitor`, `apps/web/src/routes/(auth)/admin`.

Sub-agents for this repo live in `.claude/agents/`.
