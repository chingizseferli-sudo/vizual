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
body{margin:0;color:#172033;background:#f5f8ff;font-family:"Segoe UI",Tahoma,Arial,sans-serif}
.page{max-width:1180px;margin:0 auto;padding:34px}
.hero{border-radius:22px;padding:28px;color:#fff;background:linear-gradient(135deg,#1463ff 0%,#14b8a6 58%,#f59e0b 120%)}
.brand{display:flex;align-items:center;gap:12px;margin-bottom:26px}
.logo{width:52px;height:52px;border-radius:14px}
.brand strong{font-size:20px}
h1{margin:0;font-size:34px;line-height:1.05}
.hero p{margin:12px 0 0;color:rgba(255,255,255,.88);font-size:16px}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:22px}
.stat{border:1px solid rgba(255,255,255,.22);border-radius:14px;padding:14px;background:rgba(255,255,255,.14)}
.stat span{display:block;color:rgba(255,255,255,.78);font-size:12px;font-weight:800;text-transform:uppercase}
.stat strong{display:block;margin-top:6px;font-size:24px}
.table-wrap{margin-top:24px;overflow:hidden;border:1px solid #dce6f3;border-radius:18px;background:#fff}
table{width:100%;border-collapse:collapse}
th,td{padding:14px 16px;text-align:left;vertical-align:top;border-bottom:1px solid #e8eef7}
th{color:#315078;background:#eef5ff;font-size:12px;text-transform:uppercase;font-weight:900}
th:last-child,td:last-child{width:150px}
tr:nth-child(even) td{background:#fbfdff}
a{color:#0f4fd7;font-weight:800;text-decoration:none}
.keyword-pill{display:inline-block;border-radius:999px;padding:4px 10px;margin:0 4px 4px 0;font-size:12px;font-weight:900;color:#0f766e;background:#dcfdfa}
.date-cell strong{display:block;font-size:14px;white-space:nowrap}
.date-cell span{display:inline-block;margin-top:6px;border-radius:999px;padding:4px 10px;color:#0f4fd7;background:#eaf1ff;font-size:12px;font-weight:900}
.footer{margin-top:18px;color:#61708a;font-size:12px}
@media (max-width:760px){.page{padding:18px}.stats{grid-template-columns:1fr}.table-wrap{overflow-x:auto}table{min-width:820px}}
"""


def render_html(rows, start, end, generated_at):
    esc = lambda value: html.escape(str(value), quote=True)
    body = []
    for row in rows:
        day, hour = format_when(row["when"])
        pills = "".join(f'<span class="keyword-pill">{esc(keyword)}</span>' for keyword in row["keywords"])
        body.append(
            f"<tr><td>{esc(row['source'])}</td>"
            f'<td><a href="{esc(row["url"])}" target="_blank" rel="noreferrer">{esc(row["title"])}</a></td>'
            f"<td>{pills}</td>"
            f'<td><div class="date-cell"><strong>{esc(day)}</strong><span>{esc(hour)}</span></div></td></tr>'
        )
    interval = f"{start:%d.%m.%Y %H:%M} – {end:%H:%M}"
    return f"""<!doctype html>
<html lang="az"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Vizual.Az · Media Monitorinq Hesabatı</title><style>{STYLE}</style></head>
<body><main class="page">
<section class="hero">
<div class="brand"><img class="logo" src="{logo_uri()}" alt="Vizual.Az"><strong>Vizual.Az</strong></div>
<h1>Media Monitorinq Hesabatı</h1>
<p>Son saat üzrə tapılan uyğun xəbər nəticələri.</p>
<div class="stats">
<div class="stat"><span>Interval</span><strong>{esc(interval)}</strong></div>
<div class="stat"><span>Nəticə sayı</span><strong>{len(rows)}</strong></div>
<div class="stat"><span>Hazırlandı</span><strong>{esc(generated_at)}</strong></div>
</div></section>
<section class="table-wrap"><table><thead><tr><th>Mənbə</th><th>Başlıq</th><th>Açar söz</th><th>Dərc vaxtı</th></tr></thead>
<tbody>{''.join(body)}</tbody></table></section>
<div class="footer">Vizual.Az tərəfindən avtomatik yaradılıb.</div>
</main></body></html>"""


CAPTION_LIMIT = 1024
CAPTION_HEADLINES = 5


def build_caption(rows, start, end):
    """Telegram caption (HTML parse mode, max 1024 chars): header plus the top headlines."""
    esc = lambda value: html.escape(str(value), quote=True)
    head = f"📰 <b>Vizual.Az · Saatlıq hesabat</b>\n🕐 {start:%d.%m.%Y %H:%M} – {end:%H:%M}\n📌 {len(rows)} xəbər\n"
    lines = []
    for row in rows[:CAPTION_HEADLINES]:
        title = row["title"] if len(row["title"]) <= 70 else row["title"][:67].rstrip() + "…"
        lines.append(f'• <a href="{esc(row["url"])}">{esc(title)}</a> <i>({esc(row["source"])})</i>')
    extra = len(rows) - len(lines)
    tail = f"\n… və daha {extra} xəbər faylda" if extra > 0 else ""
    caption = head + "\n" + "\n".join(lines) + tail
    while len(caption) > CAPTION_LIMIT and lines:
        lines.pop()
        extra = len(rows) - len(lines)
        caption = head + "\n" + "\n".join(lines) + f"\n… və daha {extra} xəbər faylda"
    return caption


def send_document(chat_id, filename, content, caption=""):
    """Telegram sendDocument; returns True on success. Respects the global pause."""
    if sm.DISABLE_TELEGRAM_SEND or sm.notifications_paused() or not sm.BOT_TOKEN or not chat_id:
        return False
    try:
        with sm.TELEGRAM_LOCK:
            response = requests.post(
                f"https://api.telegram.org/bot{sm.BOT_TOKEN}/sendDocument",
                data={"chat_id": chat_id, "caption": caption, "parse_mode": "HTML"},
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
        filename = f"vizual-{end:%Y-%m-%d}-{start:%H%M}-{end:%H%M}.html"
        caption = build_caption(rows, start, end)
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
