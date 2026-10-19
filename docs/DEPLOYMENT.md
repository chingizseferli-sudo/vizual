# Deployment

| Piece | Platform | Config |
|---|---|---|
| Web | Vercel, Root Directory `apps/web`; Ignored Build Step `git diff --quiet HEAD^ HEAD -- .` | `apps/web/vercel.json`, env from `apps/web/.env.example` |
| Workers | Railway, one service per `WORKER` value; Root Directory `apps/worker`, Dockerfile builder, Watch Paths `apps/worker/**` | `apps/worker/railway.json`, env from `apps/worker/.env.example` |
| Database | Supabase (single project) | `supabase/` |

## Railway services
| Service | `WORKER` | Type |
|---|---|---|
| vizual-rss | `rss` | always on |
| vizual-page-change | `page_change` | always on |
| vizual-discovery | `discovery` | cron `0 */6 * * *` |
| vizual-discovery-deep | `discovery_deep` | cron `0 23 * * *` |

Order on a new project: `supabase db push` → restore the data backup → Railway services → Vercel. The old `tehsilbot` and `vizual-bg-worker` services pointed at the deleted database and must stay stopped.

## Database changes
`supabase/migrations/` builds the whole schema on an empty project, so the migration ledger is the source of truth.
1. Add a migration in `supabase/migrations/` (idempotent: `if not exists`, `drop policy if exists`).
2. Test it on a local or branch database.
3. Take a backup, then `npx supabase link --project-ref wqxkymgilurvbvsymcvy` and `npx supabase db push`.

## Backups
Supabase Pro daily backups (7 days). Additionally a weekly `pg_dump` to off-site storage (see `docs/DECISIONS.md`).
