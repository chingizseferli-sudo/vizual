"""Alert marks and instant emails.

A customer's alert is marked when the keyword is critical (monitor_keywords.is_critical),
the source is one of their priority sources (user_priority_sources), or a social post's
engagement reaches their threshold (user_profiles.engagement_alert_threshold). A marked
alert also goes by email when the customer turned alert_email on and SMTP is configured.
"""

import threading
import time
from datetime import datetime
from email.message import EmailMessage
from email.utils import formatdate, make_msgid

import email_reports

CACHE_SECONDS = 300
# Instant emails per customer per Baku day; more marked alerts still go to Telegram.
DAILY_EMAIL_LIMIT = 50

MARK_SUBJECTS = {"critical": "Kritik açar söz", "priority": "Prioritet mənbə", "engagement": "Yüksək engagement"}

MARK_LINES = {
    "critical": "🚨 KRİTİK AÇAR SÖZ",
    "priority": "⭐ PRİORİTET MƏNBƏ",
    "engagement": "🔥 YÜKSƏK ENGAGEMENT",
}

_cache = {"at": 0.0, "profiles": {}, "priority": {}}
_emails = {"day": None, "sent": {}, "keys": set()}
_lock = threading.Lock()


def refresh(http, base_url, headers, timeout, now=None):
    """Reloads alert settings and priority sources at most every CACHE_SECONDS.
    A failed read keeps the previous values."""
    now = time.time() if now is None else now
    if not base_url or now - _cache["at"] < CACHE_SECONDS:
        return
    _cache["at"] = now
    try:
        profiles = http.get(
            f"{base_url}/rest/v1/user_profiles",
            headers=headers,
            params={
                "select": "user_id,email,alert_email,engagement_alert_threshold",
                "or": "(alert_email.is.true,engagement_alert_threshold.not.is.null)",
            },
            timeout=timeout,
        )
        priority = http.get(
            f"{base_url}/rest/v1/user_priority_sources",
            headers=headers,
            params={"select": "user_id,source_id"},
            timeout=timeout,
        )
    except Exception as exc:
        print(f"Alert qaydaları oxunmadı: {type(exc).__name__}", flush=True)
        return
    if profiles.status_code == 200:
        _cache["profiles"] = {row["user_id"]: row for row in profiles.json() or [] if row.get("user_id")}
    else:
        print(f"Alert ayarları oxunmadı: {profiles.status_code}", flush=True)
    if priority.status_code == 200:
        by_source = {}
        for row in priority.json() or []:
            by_source.setdefault(str(row.get("source_id")), set()).add(row.get("user_id"))
        _cache["priority"] = by_source
    else:
        print(f"Prioritet mənbələr oxunmadı: {priority.status_code}", flush=True)


def priority_source_ids():
    return set(_cache["priority"])


def marks(user_id, matches, source_id=None, engagement=None):
    """Marks for one customer's alert, in display order."""
    result = []
    if any(match.get("is_critical") for match in matches):
        result.append("critical")
    if source_id and user_id in _cache["priority"].get(str(source_id), ()):
        result.append("priority")
    threshold = (_cache["profiles"].get(user_id) or {}).get("engagement_alert_threshold")
    if threshold and engagement is not None and engagement >= threshold:
        result.append("engagement")
    return result


def headline(alert_marks):
    if not alert_marks:
        return ""
    return "\n".join(MARK_LINES[mark] for mark in alert_marks) + "\n\n"


def _take_email_slot(user_id, now, key=None):
    """False when the daily limit is used or this alert (key) was already emailed today:
    a news item whose Telegram send failed is processed again and must not email twice."""
    day = now.strftime("%Y-%m-%d")
    with _lock:
        if _emails["day"] != day:
            _emails.update({"day": day, "sent": {}, "keys": set()})
        count = _emails["sent"].get(user_id, 0)
        if count >= DAILY_EMAIL_LIMIT or (key and (user_id, key) in _emails["keys"]):
            return False
        _emails["sent"][user_id] = count + 1
        if key:
            _emails["keys"].add((user_id, key))
        return True


def build_email(settings, recipient, alert_marks, text):
    message = EmailMessage()
    labels = ", ".join(MARK_SUBJECTS[mark] for mark in alert_marks)
    message["Subject"] = f"Vizual.Az bildiriş: {labels}"
    message["From"] = settings["sender"]
    message["To"] = recipient
    message["Date"] = formatdate(localtime=True)
    message["Message-ID"] = make_msgid(domain=settings["user"].rsplit("@", 1)[-1] or None)
    message.set_content(
        headline(alert_marks) + text + "\n\nBu bildirişləri Vizual.Az panelində Profil bölməsindən söndürə bilərsiniz.\n"
    )
    return message


def email_alert(user_id, alert_marks, text, key=None, now=None, send=None, background=True):
    """Sends a marked alert by email when the customer asked for it. Returns True when queued."""
    if not alert_marks:
        return False
    profile = _cache["profiles"].get(user_id) or {}
    recipient = (profile.get("email") or "").strip()
    if not profile.get("alert_email") or not recipient:
        return False
    settings = email_reports.smtp_settings()
    if not settings:
        return False
    if not _take_email_slot(user_id, now or datetime.now(email_reports.BAKU_TZ), key):
        return False
    message = build_email(settings, recipient, alert_marks, text)
    send = send or email_reports.send_message

    def deliver():
        try:
            send(settings, message)
        except Exception as exc:
            print(f"Alert emaili göndərilmədi: {type(exc).__name__}", flush=True)

    if background:
        threading.Thread(target=deliver, name="alert-email", daemon=True).start()
    else:
        deliver()
    return True
