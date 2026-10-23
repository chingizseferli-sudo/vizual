#!/bin/sh
# Single image, several Railway services: pick the process with WORKER.
#   rss            long-running news/RSS keyword monitor (site_monitor.py)
#   social         long-running Facebook/Instagram keyword collector (social/collector.py)
#   discovery      one-shot fast source discovery   (Railway cron, e.g. "0 */6 * * *")
#   discovery_deep one-shot deep discovery          (Railway cron, e.g. "0 23 * * *")
#   sync_sources   one-shot JSON -> Supabase sources sync (manual)
#   auto_configure one-shot problem-source auto configuration (manual)
#   readability    one-shot source readability report (manual)
set -eu

case "${WORKER:-}" in
  rss)
    cd /app/rss
    # site_monitor defaults to RUN_ONCE=1 (GitHub Actions); a service must loop.
    export RUN_ONCE="${RUN_ONCE:-0}"
    exec python -u site_monitor.py
    ;;
  social)
    cd /app/social
    exec python -u collector.py
    ;;
  discovery)
    cd /app/rss
    exec python -u discovery_bot.py --mode fast
    ;;
  discovery_deep)
    cd /app/rss
    exec python -u discovery_bot.py --mode deep --add-to-config
    ;;
  sync_sources)
    cd /app/rss
    exec python -u sync_sources_to_supabase.py
    ;;
  auto_configure)
    cd /app/rss
    exec python -u auto_configure_sources.py
    ;;
  readability)
    cd /app/rss
    exec python -u test_sources_readability.py
    ;;
  *)
    echo "Set WORKER to one of: rss, social, discovery, discovery_deep, sync_sources, auto_configure, readability" >&2
    exit 64
    ;;
esac
