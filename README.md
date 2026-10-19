# Vizual

Media monitoring and reputation analytics for Azerbaijan. Customers enter keywords; Vizual watches news sites, RSS, page changes and social sources, shows matches in a web panel and sends Telegram alerts.

| Path | What | Runs on |
|---|---|---|
| `apps/web` | Public site, customer panel (`/monitor`), admin panel (`/admin`). React 19, Vite, TanStack, Supabase JS | Vercel |
| `apps/worker` | Python workers in one image: `rss` (news keyword monitor + Telegram bot), `page_change` (page change monitor), discovery jobs | Railway |
| `supabase` | The only database: migrations, edge functions, rollback scripts | Supabase |
| `docs` | Architecture, deployment, decisions, security | |

## Quick start

```bash
# web
cd apps/web && corepack enable && pnpm install && pnpm dev

# worker
cd apps/worker && python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt && pytest -q
WORKER=rss DRY_RUN=1 ./start.sh
```

Env vars: `apps/web/.env.example`, `apps/worker/.env.example`. Never commit real keys.

Read next: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md), [docs/DECISIONS.md](docs/DECISIONS.md), [docs/SECURITY.md](docs/SECURITY.md).
