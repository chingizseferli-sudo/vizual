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

## Pull requests and merging
After you open a PR, or when asked to land work, go through every open PR against `main` (yours first, then oldest first):
1. Check it against the latest `origin/main`. If it does not merge cleanly, do not resolve conflicts on someone else's branch: leave it open and comment what conflicts.
2. Run the checks on the merged result locally (GitHub Actions can fail on billing, so a red or missing CI run is not a verdict): `apps/web`: `pnpm install --frozen-lockfile && pnpm audit --prod --audit-level high && pnpm typecheck && pnpm lint && pnpm build`; `apps/worker`: `pytest -q`. Never loosen the audit gate or skip a test to get green.
3. Squash-merge to `main` only if all checks pass AND the PR touches none of these, which need the owner's own steps after merge:
   - `supabase/migrations/` (owner runs `npx supabase db push`)
   - `supabase/functions/` (owner runs `npx supabase functions deploy <name>`)
   - new env vars or secrets (Vercel, Railway, Supabase)
   - Railway/CI setup: `Dockerfile`, `railway.json`, `start.sh`, `.github/workflows/`
   - anything that raises paid API usage (Apify, SocialFetch, Anthropic, YouTube quota)
   Such PRs stay open; tell the owner the exact steps they need.
4. Merge one PR at a time and re-check the next one against the new `main`.
5. A push to `main` deploys to production (Vercel + Railway). If unsure a PR is safe, do not merge; ask.

## Where things are
- Keyword matching: `apps/worker/rss/site_monitor.py` (`keyword_fold`, `keyword_matches_title`).
- Telegram delivery and bot commands: `apps/worker/rss/site_monitor.py` (`send_telegram`, `connect_telegram_users_from_updates`).
- Customer and admin routes: `apps/web/src/routes/(auth)/monitor`, `apps/web/src/routes/(auth)/admin`.

Sub-agents for this repo live in `.claude/agents/`.
