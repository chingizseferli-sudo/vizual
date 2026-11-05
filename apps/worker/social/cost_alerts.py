"""API balance and budget alerts for admins, by email and/or Telegram.

Checked by the social collector every COST_ALERT_CHECK_MINUTES:
- Apify account: this billing cycle's usage against the account's monthly
  usage limit (GET /v2/users/me/limits). Covers Facebook, X and LinkedIn.
- SocialFetch: spendable credits (GET /v1/balance, free) and billing state.
- Our own monthly budgets in social_settings (total and per platform).
- YouTube: the daily quota is used up.
- Anthropic: the rss worker saw a "credit balance is too low" error in the
  last 24 hours (runtime state anthropic_credit_low). Anthropic has no
  balance API for normal keys.

Each alert has an id that includes its period (month, billing cycle, day), and
goes out once per level ("warn" at social_settings.cost_alert_percent, "full"
at 100%). An id that no longer applies is forgotten, so a balance that is
topped up and runs low again alerts again.

Recipients: active admins (admin_users) with cost_alert_email /
cost_alert_telegram on. Telegram needs the admin's linked chat
(user_profiles.telegram_chat_id); email needs SMTP_* on the service.
"""

import os
from datetime import datetime, timedelta
from email.message import EmailMessage
from email.utils import formatdate, make_msgid

import requests

import email_reports
import site_monitor as sm

APIFY_BASE = "https://api.apify.com/v2"
SOCIALFETCH_BASE = "https://api.socialfetch.dev"
CHECK_EVERY = timedelta(minutes=max(5, int(os.getenv("COST_ALERT_CHECK_MINUTES", "30"))))
STATE_KEY = "cost_alerts_sent"
ANTHROPIC_STATE_KEY = "anthropic_credit_low"
ANTHROPIC_ALERT_HOURS = 24
DEFAULT_PERCENT = 80
DEFAULT_SOCIALFETCH_CREDITS = 1000
LEVEL_RANK = {"warn": 1, "full": 2}
BUDGET_LABELS = {
    "": "Sosial axtarış (cəmi)",
    "facebook": "Facebook",
    "instagram": "Instagram",
    "x": "X",
    "linkedin": "LinkedIn",
}
HTTP_TIMEOUT = 30

_state = {"last_check": None}


def alert_percent(settings):
    value = settings.get("cost_alert_percent")
    return int(value) if value not in (None, "") else DEFAULT_PERCENT


def socialfetch_alert_credits(settings):
    value = settings.get("socialfetch_alert_credits")
    return int(value) if value not in (None, "") else DEFAULT_SOCIALFETCH_CREDITS


# Providers ----------------------------------------------------------------------------


def apify_limits(token):
    """{"used", "limit", "cycle"} of this Apify billing cycle, or None."""
    if not token:
        return None
    response = requests.get(
        f"{APIFY_BASE}/users/me/limits",
        headers={"Authorization": f"Bearer {token}"},
        timeout=HTTP_TIMEOUT,
    )
    if response.status_code != 200:
        print(f"Apify limit oxunmadı: {response.status_code}", flush=True)
        return None
    data = (response.json() or {}).get("data") or {}
    limit = (data.get("limits") or {}).get("maxMonthlyUsageUsd")
    if not limit:
        return None
    return {
        "used": float((data.get("current") or {}).get("monthlyUsageUsd") or 0),
        "limit": float(limit),
        "cycle": str((data.get("monthlyUsageCycle") or {}).get("startAt") or "")[:10],
    }


def socialfetch_balance(api_key):
    """{"balance", "billing_alert", "refill_state"} or None."""
    if not api_key:
        return None
    response = requests.get(
        f"{SOCIALFETCH_BASE}/v1/balance",
        headers={"x-api-key": api_key, "Accept": "application/json"},
        timeout=HTTP_TIMEOUT,
    )
    if response.status_code != 200:
        print(f"SocialFetch balansı oxunmadı: {response.status_code}", flush=True)
        return None
    data = (response.json() or {}).get("data") or {}
    if data.get("balance") is None:
        return None
    return {
        "balance": int(data.get("balance") or 0),
        "billing_alert": data.get("billingAlert") or "none",
        "refill_state": data.get("refillState"),
    }


# Findings -----------------------------------------------------------------------------


def percent_level(used, limit, percent):
    if limit <= 0 or used >= limit:
        return "full"
    if used * 100 >= limit * percent:
        return "warn"
    return None


def find_alerts(settings, now, usage, youtube_used=0, apify=None, socialfetch=None, anthropic_low_at=None):
    """Pure: the alerts that apply now. Each: {"id", "level", "text"}."""
    percent = alert_percent(settings)
    month = f"{now:%Y-%m}"
    alerts = []

    if apify:
        level = percent_level(apify["used"], apify["limit"], percent)
        if level:
            alerts.append({
                "id": f"apify_account:{apify['cycle'] or month}",
                "level": level,
                "text": (
                    f"Apify hesabı (Facebook, X, LinkedIn): bu ay ${apify['used']:.2f} / "
                    f"${apify['limit']:.2f} istifadə olunub ({apify['used'] * 100 / apify['limit']:.0f}%)."
                    + (" Limit dolub: Apify axtarışları dayanacaq." if level == "full" else "")
                ),
            })

    if socialfetch:
        balance = socialfetch["balance"]
        threshold = socialfetch_alert_credits(settings)
        exhausted = (
            balance <= 0
            or socialfetch["refill_state"] == "exhausted"
            or socialfetch["billing_alert"] == "suspended"
        )
        if exhausted or balance <= threshold or socialfetch["billing_alert"] == "payment_action_required":
            text = f"SocialFetch (Instagram): balansda {balance} kredit qalıb (xəbərdarlıq həddi {threshold})."
            if socialfetch["billing_alert"] == "payment_action_required":
                text += " Ödəniş tələb olunur."
            if exhausted:
                text += " Kredit bitib və ya hesab dayandırılıb: Instagram axtarışı işləmir."
            alerts.append({"id": "socialfetch_balance", "level": "full" if exhausted else "warn", "text": text})

    for platform, label in BUDGET_LABELS.items():
        key = f"{platform}_monthly_budget_usd" if platform else "monthly_budget_usd"
        budget = settings.get(key)
        if budget in (None, ""):
            continue
        spent = float(usage.get(f"{platform}_usd" if platform else "usd") or 0)
        level = percent_level(spent, float(budget), percent)
        if level:
            alerts.append({
                "id": f"budget_{platform or 'total'}:{month}",
                "level": level,
                "text": (
                    f"{label} aylıq büdcəsi: ${spent:.2f} / ${float(budget):.2f}."
                    + (" Büdcə dolub: axtarış ay sonuna qədər dayanıb." if level == "full" else "")
                ),
            })

    if settings.get("youtube_enabled"):
        quota = int(settings.get("youtube_daily_quota") or 9000)
        if youtube_used >= quota:
            alerts.append({
                "id": f"youtube_quota:{now:%Y-%m-%d}",
                "level": "full",
                "text": f"YouTube gündəlik kvotası dolub ({youtube_used} / {quota} vahid): axtarış sabaha qədər dayanıb.",
            })

    if anthropic_low_at and now - anthropic_low_at <= timedelta(hours=ANTHROPIC_ALERT_HOURS):
        alerts.append({
            "id": "anthropic_credit",
            "level": "full",
            "text": "Anthropic (Claude API): kredit balansı bitib. Rəqib təhlili işləmir; console.anthropic.com-da balansı artırın.",
        })
    return alerts


def due_alerts(alerts, sent):
    """(alerts to send now, new sent state). A level is sent once; ids that no
    longer apply are dropped from the state, so they can alert again later."""
    due = [alert for alert in alerts if LEVEL_RANK[alert["level"]] > LEVEL_RANK.get(sent.get(alert["id"]), 0)]
    state = {alert["id"]: max(alert["level"], sent.get(alert["id"]) or alert["level"], key=LEVEL_RANK.get) for alert in alerts}
    return due, state


# Delivery -----------------------------------------------------------------------------


def load_recipients():
    """[{"email", "chat_id"}]: active admins, each channel only where it is on."""
    response = requests.get(
        f"{sm.SUPABASE_URL}/rest/v1/admin_users",
        headers=sm.supabase_headers(),
        params={"select": "user_id,email,cost_alert_email,cost_alert_telegram", "status": "eq.active", "limit": "100"},
        timeout=sm.REQUEST_TIMEOUT,
    )
    if response.status_code != 200:
        print(f"Xərc xəbərdarlığı alanlar oxunmadı (migration 20261105000001?): {response.status_code}", flush=True)
        return []
    admins = [row for row in response.json() or [] if row.get("user_id")]
    if not admins:
        return []
    profiles = requests.get(
        f"{sm.SUPABASE_URL}/rest/v1/user_profiles",
        headers=sm.supabase_headers(),
        params={"select": "user_id,email,telegram_chat_id", "user_id": f"in.({','.join(row['user_id'] for row in admins)})"},
        timeout=sm.REQUEST_TIMEOUT,
    )
    by_user = {row.get("user_id"): row for row in (profiles.json() or [])} if profiles.status_code == 200 else {}
    recipients = []
    for admin in admins:
        profile = by_user.get(admin["user_id"]) or {}
        email = (admin.get("email") or profile.get("email") or "").strip() if admin.get("cost_alert_email") else ""
        chat_id = sm.clean_text(profile.get("telegram_chat_id")) if admin.get("cost_alert_telegram") else ""
        if email or chat_id:
            recipients.append({"email": email, "chat_id": chat_id})
    return recipients


def alert_body(alerts):
    lines = [("🔴 " if alert["level"] == "full" else "🟠 ") + alert["text"] for alert in alerts]
    return "⚠️ Vizual: API xərc xəbərdarlığı\n\n" + "\n".join(lines) + f"\n\nAdmin panel: {email_reports.APP_URL}/admin/social"


def build_email(smtp, recipient, body):
    message = EmailMessage()
    message["Subject"] = "Vizual: API balansı / büdcə xəbərdarlığı"
    message["From"] = smtp["sender"]
    message["To"] = recipient
    message["Date"] = formatdate(localtime=True)
    message["Message-ID"] = make_msgid(domain=smtp["user"].rsplit("@", 1)[-1] or None)
    message.set_content(body)
    return message


def deliver(alerts, recipients, send_telegram=None, send_email=None, smtp=None):
    """Returns how many messages went out."""
    send_telegram = send_telegram or sm.send_telegram
    send_email = send_email or email_reports.send_message
    body = alert_body(alerts)
    sent = 0
    for recipient in recipients:
        if recipient["chat_id"] and send_telegram(body, chat_id=recipient["chat_id"], bypass_pause=True):
            sent += 1
        if recipient["email"] and smtp:
            try:
                send_email(smtp, build_email(smtp, recipient["email"], body))
                sent += 1
            except Exception as exc:
                print(f"Xərc xəbərdarlığı emaili getmədi: {sm.redact_secrets(exc)}", flush=True)
    return sent


# Check --------------------------------------------------------------------------------


def anthropic_low_since():
    ok, value = sm.load_runtime_state(ANTHROPIC_STATE_KEY)
    if not ok or not isinstance(value, dict) or not value.get("at"):
        return None
    try:
        return datetime.fromisoformat(value["at"])
    except ValueError:
        return None


def check(settings, now, read_usage, read_youtube_used, apify_token, socialfetch_key):
    """Runs at most every CHECK_EVERY. read_*: callables, so a skipped check reads nothing. Never raises."""
    last = _state["last_check"]
    if last and now - last < CHECK_EVERY:
        return
    _state["last_check"] = now
    if settings.get("cost_alerts_enabled") is False:
        return
    try:
        alerts = find_alerts(
            settings,
            now,
            read_usage(),
            youtube_used=read_youtube_used(),
            apify=apify_limits(apify_token),
            socialfetch=socialfetch_balance(socialfetch_key),
            anthropic_low_at=anthropic_low_since(),
        )
        ok, sent = sm.load_runtime_state(STATE_KEY)
        if not ok:
            return
        due, state = due_alerts(alerts, sent if isinstance(sent, dict) else {})
        if due:
            recipients = load_recipients()
            if not recipients:
                print("Xərc xəbərdarlığı var, amma onu alan admin yoxdur.", flush=True)
                return
            if not deliver(due, recipients, smtp=email_reports.smtp_settings()):
                return
        if state != sent:
            sm.save_runtime_state(STATE_KEY, state)
    except Exception as exc:
        print(f"Xərc xəbərdarlığı xətası: {sm.redact_secrets(exc)}", flush=True)
