"""Daily, weekly and monthly email reports, sent over SMTP (Zoho: info@vizual.az).

Which customers get which report is decided in SQL (email_report_recipients):
the plan's limits.report_frequencies, the customer's opt-outs, and the
email_report_deliveries row that makes every report go out at most once.
Reports cover the last finished Baku-time period and go out on the next day
(daily), Monday (weekly) or the 1st (monthly), from the hour each customer
picked (user_profiles.email_report_hour, default 09:00 Baku).
"""

import html
import os
import smtplib
import ssl
from datetime import date, datetime, time, timedelta
from email.message import EmailMessage
from email.utils import formatdate, make_msgid
from zoneinfo import ZoneInfo

BAKU_TZ = ZoneInfo("Asia/Baku")
KINDS = ("daily", "weekly", "monthly")
# Results are deleted after 30 days; an older comparison period would read as zero.
DATA_RETENTION_DAYS = int(os.getenv("MONITOR_DATA_RETENTION_DAYS", "30"))
CHECK_EVERY = timedelta(minutes=max(1, int(os.getenv("EMAIL_REPORT_CHECK_MINUTES", "10"))))
REPORTS_PER_CHECK = max(1, int(os.getenv("EMAIL_REPORTS_PER_CHECK", "20")))
APP_URL = os.getenv("APP_URL", "https://vizual-web.vercel.app").strip().rstrip("/")

MONTHS_AZ = (
    "yanvar", "fevral", "mart", "aprel", "may", "iyun",
    "iyul", "avqust", "sentyabr", "oktyabr", "noyabr", "dekabr",
)
KIND_TITLE = {"daily": "Gündəlik hesabat", "weekly": "Həftəlik hesabat", "monthly": "Aylıq hesabat"}
PREVIOUS_LABEL = {"daily": "dünənki gün", "weekly": "əvvəlki həftə", "monthly": "əvvəlki ay"}

_state = {"last_check": None, "missing_logged": False}


def smtp_settings():
    """SMTP settings from the environment, or None when reports are not configured."""
    settings = {
        "host": os.getenv("SMTP_HOST", "").strip(),
        "port": int(os.getenv("SMTP_PORT", "465") or 465),
        "user": os.getenv("SMTP_USER", "").strip(),
        "password": os.getenv("SMTP_PASSWORD", ""),
        "sender": os.getenv("MAIL_FROM", "").strip() or "Vizual.Az <info@vizual.az>",
    }
    if not settings["host"] or not settings["user"] or not settings["password"]:
        return None
    return settings


def report_period(kind, now):
    """(first day, last day, latest send hour due) of the last finished period.

    On the day the report becomes due only customers whose chosen hour has
    come are due (hour <= now's Baku hour); later in the period everyone is,
    so a report missed while the worker was down still goes out.
    """
    local = now.astimezone(BAKU_TZ)
    today = local.date()
    if kind == "daily":
        send_day = today
        start = end = today - timedelta(days=1)
    elif kind == "weekly":
        send_day = today - timedelta(days=today.weekday())
        start, end = send_day - timedelta(days=7), send_day - timedelta(days=1)
    elif kind == "monthly":
        send_day = today.replace(day=1)
        end = send_day - timedelta(days=1)
        start = end.replace(day=1)
    else:
        raise ValueError(kind)
    return start, end, local.hour if today == send_day else 23


def previous_period_start(kind, start):
    if kind == "daily":
        return start - timedelta(days=1)
    if kind == "weekly":
        return start - timedelta(days=7)
    return (start - timedelta(days=1)).replace(day=1)


def day_start(day):
    return datetime.combine(day, time(0), BAKU_TZ)


def format_day(day):
    return f"{day.day} {MONTHS_AZ[day.month - 1]} {day.year}"


def period_label(kind, start, end):
    if kind == "daily":
        return format_day(start)
    if kind == "monthly":
        return f"{MONTHS_AZ[start.month - 1].capitalize()} {start.year}"
    if start.month == end.month:
        return f"{start.day}–{end.day} {MONTHS_AZ[end.month - 1]} {end.year}"
    if start.year == end.year:
        return f"{start.day} {MONTHS_AZ[start.month - 1]} – {format_day(end)}"
    return f"{format_day(start)} – {format_day(end)}"


def change_text(kind, total, previous):
    if previous is None:
        return ""
    if previous == 0:
        return f"{PREVIOUS_LABEL[kind].capitalize()}: 0"
    percent = round((total - previous) * 100 / previous)
    sign = "+" if percent > 0 else ""
    return f"{PREVIOUS_LABEL[kind].capitalize()}: {previous} ({sign}{percent}%)"


def safe_url(value):
    value = (value or "").strip()
    return value if value.startswith(("https://", "http://")) else ""


def report_subject(kind, start, end):
    return f"Vizual.Az · {KIND_TITLE[kind].lower()} · {period_label(kind, start, end)}"


def report_text(kind, start, end, data):
    total = int(data.get("total") or 0)
    lines = [
        f"Vizual.Az — {KIND_TITLE[kind].lower()}",
        period_label(kind, start, end),
        "",
        f"Açar sözləriniz üzrə tapılan xəbərlər: {total}",
    ]
    change = change_text(kind, total, data.get("previous_total"))
    if change:
        lines.append(change)
    keywords = data.get("keywords") or []
    if keywords:
        lines += ["", "Açar sözlər:"] + [f"  {row.get('keyword')}: {row.get('mentions', 0)}" for row in keywords]
    sources = data.get("sources") or []
    if sources:
        lines += ["", "Ən çox yazan mənbələr:"] + [f"  {row.get('source')}: {row.get('mentions', 0)}" for row in sources]
    headlines = data.get("headlines") or []
    if headlines:
        lines += ["", "Son xəbərlər:"]
        for row in headlines:
            lines.append(f"  • {row.get('title')} ({row.get('source')})")
            if safe_url(row.get("url")):
                lines.append(f"    {row.get('url')}")
    lines += [
        "",
        f"Bütün nəticələr: {APP_URL}/monitor/results",
        f"Hesabatları Profil səhifəsində söndürə bilərsiniz: {APP_URL}/monitor/profile",
    ]
    return "\n".join(lines)


def _rows(rows, empty_text):
    if not rows:
        return f'<tr><td style="padding:8px 0;color:#6b7280;font-size:14px">{empty_text}</td></tr>'
    return "".join(
        '<tr>'
        f'<td style="padding:7px 0;border-bottom:1px solid #eef0f3;font-size:14px;color:#111827">{html.escape(str(name))}</td>'
        f'<td style="padding:7px 0;border-bottom:1px solid #eef0f3;font-size:14px;color:#111827;text-align:right;font-weight:600">{count}</td>'
        '</tr>'
        for name, count in rows
    )


def _section(title, body):
    return (
        '<tr><td style="padding:20px 24px 4px">'
        f'<div style="font-size:13px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px">{title}</div>'
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0">{body}</table>'
        '</td></tr>'
    )


def report_html(kind, start, end, data):
    total = int(data.get("total") or 0)
    change = change_text(kind, total, data.get("previous_total"))
    keywords = [(row.get("keyword"), row.get("mentions", 0)) for row in data.get("keywords") or []]
    sources = [(row.get("source"), row.get("mentions", 0)) for row in data.get("sources") or []]
    headline_rows = []
    for row in data.get("headlines") or []:
        title = html.escape(str(row.get("title") or ""))
        url = safe_url(row.get("url"))
        link = (
            f'<a href="{html.escape(url, quote=True)}" style="color:#1d4ed8;text-decoration:none;font-weight:600">{title}</a>'
            if url else f'<span style="font-weight:600">{title}</span>'
        )
        meta = " · ".join(html.escape(str(part)) for part in (row.get("source"), row.get("keyword")) if part)
        headline_rows.append(
            '<tr><td style="padding:9px 0;border-bottom:1px solid #eef0f3;font-size:14px;line-height:1.4;color:#111827">'
            f'{link}<div style="font-size:12px;color:#6b7280;margin-top:2px">{meta}</div></td></tr>'
        )
    headlines = "".join(headline_rows) or (
        '<tr><td style="padding:8px 0;color:#6b7280;font-size:14px">Bu dövrdə yeni xəbər tapılmadı.</td></tr>'
    )
    change_html = (
        f'<div style="font-size:13px;color:#6b7280;margin-top:4px">{html.escape(change)}</div>' if change else ""
    )
    return f"""<!doctype html>
<html lang="az"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{html.escape(report_subject(kind, start, end))}</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e5e7eb">
<tr><td style="padding:22px 24px;background:#0f172a;color:#ffffff">
<div style="font-size:18px;font-weight:700">Vizual.Az</div>
<div style="font-size:14px;color:#cbd5e1;margin-top:2px">{KIND_TITLE[kind]} · {html.escape(period_label(kind, start, end))}</div>
</td></tr>
<tr><td style="padding:22px 24px 6px">
<div style="font-size:14px;color:#6b7280">Açar sözləriniz üzrə tapılan xəbərlər</div>
<div style="font-size:34px;font-weight:800;color:#111827;line-height:1.2;margin-top:4px">{total}</div>
{change_html}
</td></tr>
{_section("Açar sözlər", _rows(keywords, "Aktiv açar söz yoxdur."))}
{_section("Ən çox yazan mənbələr", _rows(sources, "Bu dövrdə mənbə yoxdur."))}
{_section("Son xəbərlər", headlines)}
<tr><td style="padding:22px 24px">
<a href="{APP_URL}/monitor/results" style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 18px;border-radius:9px">Bütün nəticələrə bax</a>
</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #eef0f3;font-size:12px;line-height:1.5;color:#6b7280">
Bu hesabatı planınıza görə alırsınız. <a href="{APP_URL}/monitor/profile" style="color:#6b7280">Profil səhifəsində</a> söndürə bilərsiniz.
</td></tr>
</table>
</td></tr>
</table>
</body></html>"""


def build_message(settings, recipient, kind, start, end, data):
    message = EmailMessage()
    message["Subject"] = report_subject(kind, start, end)
    message["From"] = settings["sender"]
    message["To"] = recipient
    message["Date"] = formatdate(localtime=True)
    message["Message-ID"] = make_msgid(domain=settings["user"].rsplit("@", 1)[-1] or None)
    message.set_content(report_text(kind, start, end, data))
    message.add_alternative(report_html(kind, start, end, data), subtype="html")
    return message


def send_message(settings, message):
    context = ssl.create_default_context()
    if settings["port"] == 465:
        with smtplib.SMTP_SSL(settings["host"], settings["port"], timeout=30, context=context) as server:
            server.login(settings["user"], settings["password"])
            server.send_message(message)
    else:
        with smtplib.SMTP(settings["host"], settings["port"], timeout=30) as server:
            server.starttls(context=context)
            server.login(settings["user"], settings["password"])
            server.send_message(message)


def _rpc(http, base_url, headers, timeout, name, payload):
    response = http.post(f"{base_url}/rest/v1/rpc/{name}", headers=headers, json=payload, timeout=timeout)
    if response.status_code != 200:
        raise RuntimeError(f"{name}: {response.status_code} {response.text[:200]}")
    return response.json()


def _finish(http, base_url, headers, timeout, delivery_id, payload):
    payload = {**payload, "updated_at": datetime.now(BAKU_TZ).isoformat()}
    http.patch(
        f"{base_url}/rest/v1/email_report_deliveries",
        headers={**headers, "Prefer": "return=minimal"},
        params={"id": f"eq.{delivery_id}"},
        json=payload,
        timeout=timeout,
    )


def send_due_reports(http, base_url, headers, timeout=10, now=None, send=send_message):
    """Called every rss cycle; does real work at most every CHECK_EVERY."""
    if not base_url:
        return 0
    now = now or datetime.now(BAKU_TZ)
    last = _state["last_check"]
    if last and now - last < CHECK_EVERY:
        return 0
    _state["last_check"] = now
    settings = smtp_settings()
    if settings is None:
        if not _state["missing_logged"]:
            print("Email hesabatları söndürülüb: SMTP_HOST, SMTP_USER və ya SMTP_PASSWORD yoxdur.", flush=True)
            _state["missing_logged"] = True
        return 0

    budget = REPORTS_PER_CHECK
    sent = 0
    for kind in KINDS:
        if budget <= 0:
            break
        start, end, max_hour = report_period(kind, now)
        try:
            recipients = _rpc(http, base_url, headers, timeout, "email_report_recipients", {
                "p_kind": kind, "p_period_start": start.isoformat(), "p_limit": budget,
                "p_max_hour": max_hour,
            }) or []
        except Exception as exc:
            print(f"Email hesabatı alıcıları oxunmadı ({kind}): {exc}", flush=True)
            continue
        previous_start = previous_period_start(kind, start)
        oldest_kept = now.astimezone(BAKU_TZ).date() - timedelta(days=DATA_RETENTION_DAYS)
        for recipient in recipients:
            if budget <= 0:
                break
            user_id, email = recipient.get("user_id"), recipient.get("email")
            try:
                delivery_id = _rpc(http, base_url, headers, timeout, "claim_email_report", {
                    "p_user_id": user_id, "p_kind": kind,
                    "p_period_start": start.isoformat(), "p_period_end": end.isoformat(),
                    "p_recipient": email,
                })
            except Exception as exc:
                print(f"Email hesabatı rezerv olunmadı ({kind}): {exc}", flush=True)
                continue
            if not delivery_id:
                continue
            try:
                data = _rpc(http, base_url, headers, timeout, "email_report_data", {
                    "p_user_id": user_id,
                    "p_from": day_start(start).isoformat(),
                    "p_to": day_start(end + timedelta(days=1)).isoformat(),
                    "p_prev_from": day_start(previous_start).isoformat() if previous_start >= oldest_kept else None,
                }) or {}
                total = int(data.get("total") or 0)
                # A daily email that only says "nothing today" is noise.
                if kind == "daily" and total == 0:
                    _finish(http, base_url, headers, timeout, delivery_id, {"status": "skipped", "mention_count": 0})
                    continue
                budget -= 1
                send(settings, build_message(settings, email, kind, start, end, data))
                _finish(http, base_url, headers, timeout, delivery_id, {"status": "sent", "mention_count": total})
                sent += 1
            except Exception as exc:
                error = str(exc).replace(settings["password"], "***")[:300]
                print(f"Email hesabatı göndərilmədi ({kind}, {email}): {error}", flush=True)
                _finish(http, base_url, headers, timeout, delivery_id, {"status": "failed", "error": error})
    if sent:
        print(f"Email hesabatları göndərildi: {sent}", flush=True)
    return sent
