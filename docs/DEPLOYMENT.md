# Deployment

| Piece | Platform | Config |
|---|---|---|
| Web | Vercel, root directory `apps/web` | `apps/web/vercel.json`, env from `apps/web/.env.example` |
| Workers | Railway, one service per `WORKER` value, all from `apps/worker/Dockerfile` | `apps/worker/railway.json`, env from `apps/worker/.env.example` |
| Database | Supabase (single project) | `supabase/` |

## Railway services
| Service | `WORKER` | Type |
|---|---|---|
| vizual-rss | `rss` | always on |
| vizual-page-change | `page_change` | always on |
| vizual-discovery | `discovery` | cron `0 */6 * * *` |
| vizual-discovery-deep | `discovery_deep` | cron `0 23 * * *` |

Cut-over: deploy the new services with `DISABLE_TELEGRAM_SEND=1` first, compare output with the old services for a day, then switch Telegram on and stop the old services.

## Database changes
1. Add a migration in `supabase/migrations/`.
2. Apply to staging, run RLS tests.
3. Apply to production with `supabase db push` after a fresh backup.

## Backups
Supabase Pro daily backups (7 days). Additionally a weekly `pg_dump` to off-site storage (see `docs/DECISIONS.md`).
