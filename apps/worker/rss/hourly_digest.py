"""One-shot hourly digest: sends every Telegram-linked customer an HTML report
(same look as the Results page export) of the matches found in the previous
full hour. Run by a Railway cron at minute 0 (WORKER=digest). Stateless: the
window is derived from the clock, so no table or column is needed."""
import html
import json
import os
import sys
from datetime import datetime, timedelta
from urllib.parse import urlparse

import requests

import site_monitor as sm

HERE = os.path.dirname(os.path.abspath(__file__))
PAGE_LIMIT = 1000
MAX_PAGES = 20


def window_for(now):
    """Previous full hour in Baku time: [start, end)."""
    end = now.astimezone(sm.BAKU_TZ).replace(minute=0, second=0, microsecond=0)
    return end - timedelta(hours=1), end


def fetch_json(path, params):
    response = requests.get(
        f"{sm.SUPABASE_URL}/rest/v1/{path}",
        headers=sm.supabase_headers(),
        params=params,
        timeout=max(sm.REQUEST_TIMEOUT, 20),
    )
    if response.status_code != 200:
        raise RuntimeError(f"{path} oxuna bilmədi: {response.status_code} | {response.text[:200]}")
    return response.json() or []


def load_recipients():
    """chat_id -> set of monitor ids (telegram linked, notifications on, owner active)."""
    inactive = sm.inactive_account_user_ids()
    if inactive is None:
        raise RuntimeError("hesab statusu oxuna bilmədi")
    rows = fetch_json(
        "user_monitors",
        {"select": "id,user_id,status,notify_telegram,telegram_chat_id", "status": "eq.active"},
    )
    recipients = {}
    for row in rows:
        chat_id = sm.clean_text(row.get("telegram_chat_id"))
        if not chat_id or row.get("notify_telegram") is False or row.get("user_id") in inactive:
            continue
        recipients.setdefault(chat_id, set()).add(row.get("id"))
    return recipients


def load_window_matches(start, end):
    matches = []
    for page in range(MAX_PAGES):
        batch = fetch_json(
            "monitor_matches",
            {
                "select": "monitor_id,matched_keyword,created_at,monitored_items(title,url,published_at,detected_at)",
                "and": f"(created_at.gte.{start.isoformat()},created_at.lt.{end.isoformat()})",
                "order": "created_at.desc",
                "limit": str(PAGE_LIMIT),
                "offset": str(page * PAGE_LIMIT),
            },
        )
        matches.extend(batch)
        if len(batch) < PAGE_LIMIT:
            break
    return matches


def build_rows(matches, monitor_ids):
    """One row per news item, keywords merged, newest first."""
    by_url = {}
    for match in matches:
        if match.get("monitor_id") not in monitor_ids:
            continue
        item = match.get("monitored_items") or {}
        url = sm.clean_text(item.get("url"))
        if not url:
            continue
        row = by_url.setdefault(
            url,
            {
                "url": url,
                "title": sm.clean_text(item.get("title")) or url,
                "source": (urlparse(url).hostname or "-").removeprefix("www."),
                "when": item.get("published_at") or item.get("detected_at") or match.get("created_at"),
                "keywords": [],
            },
        )
        keyword = sm.clean_text(match.get("matched_keyword"))
        if keyword and keyword not in row["keywords"]:
            row["keywords"].append(keyword)
    return sorted(by_url.values(), key=lambda row: row["when"] or "", reverse=True)


def format_when(value):
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00")).astimezone(sm.BAKU_TZ)
    except (TypeError, ValueError):
        return "-", "-"
    return parsed.strftime("%d.%m.%Y"), parsed.strftime("%H:%M")


def logo_uri():
    from urllib.parse import quote

    with open(os.path.join(HERE, "assets", "vizual-icon.svg"), encoding="utf-8") as handle:
        return "data:image/svg+xml;charset=utf-8," + quote(handle.read(), safe="")


STYLE = """
*{box-sizing:border-box}
body{margin:0;color:#172033;background:#f1f5fb;font-family:"Segoe UI",Tahoma,Arial,sans-serif;-webkit-text-size-adjust:100%}
.page{max-width:760px;margin:0 auto;padding:16px}
.hero{border-radius:18px;padding:18px 20px;color:#fff;background:linear-gradient(135deg,#1463ff 0%,#14b8a6 100%)}
.brand{display:flex;align-items:center;gap:10px}
.logo{width:38px;height:38px;border-radius:10px}
.brand strong{font-size:18px}
.brand em{margin-left:auto;font-style:normal;font-size:12px;opacity:.85}
.hero h1{margin:14px 0 0;font-size:22px;line-height:1.2}
.meta{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.chip{border-radius:999px;padding:5px 12px;font-size:13px;font-weight:700;background:rgba(255,255,255,.2)}
.list{display:grid;gap:10px;margin-top:14px}
.card{display:block;border:1px solid #dce6f3;border-left:4px solid #1463ff;border-radius:14px;padding:14px 16px;background:#fff;color:inherit;text-decoration:none}
.card:hover{box-shadow:0 8px 24px rgba(40,55,85,.12)}
.card h2{margin:0;font-size:16px;line-height:1.4;color:#0f2a6b}
.info{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;margin-top:8px;font-size:13px;color:#61708a}
.info b{color:#315078}
.time{border-radius:999px;padding:2px 9px;color:#0f4fd7;background:#eaf1ff;font-weight:800}
.tags{margin-top:8px}
.pill{display:inline-block;border-radius:999px;padding:3px 10px;margin:0 4px 4px 0;font-size:12px;font-weight:800;color:#0f766e;background:#dcfdfa}
.footer{margin:18px 4px;color:#61708a;font-size:12px;text-align:center}
@media (prefers-color-scheme:dark){
body{background:#0e1524;color:#e6ecf7}
.card{background:#16203a;border-color:#243456;border-left-color:#4d8bff}
.card h2{color:#cfe0ff}.info,.footer{color:#9db0cf}.info b{color:#c3d3ee}
.time{color:#a9c6ff;background:#1f3566}.pill{color:#7ee6d8;background:#0f3a3a}
}
"""


def render_html(rows, start, end, generated_at):
    esc = lambda value: html.escape(str(value), quote=True)
    cards = []
    for row in rows:
        day, hour = format_when(row["when"])
        pills = "".join(f'<span class="pill">{esc(keyword)}</span>' for keyword in row["keywords"])
        cards.append(
            f'<a class="card" href="{esc(row["url"])}" target="_blank" rel="noreferrer">'
            f"<h2>{esc(row['title'])}</h2>"
            f'<div class="info"><b>{esc(row["source"])}</b><span>{esc(day)}</span><span class="time">{esc(hour)}</span></div>'
            f'<div class="tags">{pills}</div></a>'
        )
    interval = f"{start:%d.%m.%Y %H:%M} – {end:%H:%M}"
    return f"""<!doctype html>
<html lang="az"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Vizual.Az · Saatlıq hesabat</title><style>{STYLE}</style></head>
<body><main class="page">
<section class="hero">
<div class="brand"><img class="logo" src="{logo_uri()}" alt="Vizual.Az"><strong>Vizual.Az</strong><em>Hazırlandı: {esc(generated_at)}</em></div>
<h1>Saatlıq media hesabatı</h1>
<div class="meta"><span class="chip">{esc(interval)}</span><span class="chip">{len(rows)} xəbər</span></div>
</section>
<section class="list">{''.join(cards)}</section>
<div class="footer">Vizual.Az tərəfindən avtomatik yaradılıb.</div>
</main></body></html>"""


def send_document(chat_id, filename, content, caption=""):
    """Telegram sendDocument; returns True on success. Respects the global pause."""
    if sm.DISABLE_TELEGRAM_SEND or sm.notifications_paused() or not sm.BOT_TOKEN or not chat_id:
        return False
    try:
        with sm.TELEGRAM_LOCK:
            response = requests.post(
                f"https://api.telegram.org/bot{sm.BOT_TOKEN}/sendDocument",
                data={"chat_id": chat_id, "caption": caption},
                files={"document": (filename, content.encode("utf-8"), "text/html")},
                timeout=60,
            )
    except Exception as exc:
        print(f"Digest network_error: chat={chat_id} | {sm.redact_secrets(exc)}", flush=True)
        return False
    parsed = sm.parse_telegram_response(response)
    if not parsed["ok"]:
        print(f"Digest Telegram xətası: chat={chat_id} | {parsed['reason']} | {parsed['description'][:200]}", flush=True)
    return bool(parsed["ok"])


def run(now=None):
    now = now or datetime.now(sm.BAKU_TZ)
    start, end = window_for(now)
    if not sm.supabase_ready():
        print("Supabase hazır deyil; digest buraxıldı.", flush=True)
        return 1
    if sm.notifications_paused():
        print("Bildirişlər dayandırılıb; digest göndərilmədi.", flush=True)
        return 0
    recipients = load_recipients()
    matches = load_window_matches(start, end)
    generated_at = now.astimezone(sm.BAKU_TZ).strftime("%d.%m.%Y %H:%M")
    sent = skipped = failed = 0
    for chat_id, monitor_ids in recipients.items():
        rows = build_rows(matches, monitor_ids)
        if not rows:
            skipped += 1
            continue
        filename = f"vizual-{end:%Y-%m-%d-%H%M}.html"
        caption = f"Saatlıq hesabat: {start:%H:%M}–{end:%H:%M}, {len(rows)} xəbər"
        if send_document(chat_id, filename, render_html(rows, start, end, generated_at), caption):
            sent += 1
        else:
            failed += 1
    print(
        json.dumps({"window": [start.isoformat(), end.isoformat()], "chats": len(recipients),
                    "sent": sent, "no_matches": skipped, "failed": failed}),
        flush=True,
    )
    return 1 if failed and not sent else 0


if __name__ == "__main__":
    sys.exit(run())
