from datetime import datetime, timedelta, timezone

import cost_alerts as ca

NOW = datetime(2026, 11, 5, 9, 0, tzinfo=timezone.utc)


class FakeResponse:
    def __init__(self, status_code, payload=None):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


def ids(alerts):
    return {alert["id"]: alert["level"] for alert in alerts}


def test_budgets_warn_at_percent_and_full_at_limit():
    settings = {"monthly_budget_usd": 100, "facebook_monthly_budget_usd": 50, "instagram_monthly_budget_usd": 20,
                "x_monthly_budget_usd": None}
    usage = {"usd": 79.99, "facebook_usd": 50, "instagram_usd": 16, "x_usd": 999}
    assert ids(ca.find_alerts(settings, NOW, usage)) == {
        "budget_facebook:2026-11": "full",
        "budget_instagram:2026-11": "warn",
    }
    settings["cost_alert_percent"] = 70
    assert ids(ca.find_alerts(settings, NOW, usage))["budget_total:2026-11"] == "warn"


def test_apify_account_limit():
    apify = {"used": 85.0, "limit": 100.0, "cycle": "2026-10-20"}
    alerts = ca.find_alerts({}, NOW, {}, apify=apify)
    assert ids(alerts) == {"apify_account:2026-10-20": "warn"}
    assert "$85.00 / $100.00" in alerts[0]["text"]
    assert ids(ca.find_alerts({}, NOW, {}, apify={**apify, "used": 100.0})) == {"apify_account:2026-10-20": "full"}
    assert ca.find_alerts({}, NOW, {}, apify={**apify, "used": 10.0}) == []


def test_socialfetch_balance_levels():
    healthy = {"balance": 5000, "billing_alert": "none", "refill_state": "healthy"}
    assert ca.find_alerts({}, NOW, {}, socialfetch=healthy) == []
    low = {**healthy, "balance": 900}
    assert ids(ca.find_alerts({}, NOW, {}, socialfetch=low)) == {"socialfetch_balance": "warn"}
    assert ca.find_alerts({"socialfetch_alert_credits": 500}, NOW, {}, socialfetch=low) == []
    assert ids(ca.find_alerts({}, NOW, {}, socialfetch={**healthy, "balance": 0})) == {"socialfetch_balance": "full"}
    payment = {**healthy, "billing_alert": "payment_action_required"}
    assert ids(ca.find_alerts({}, NOW, {}, socialfetch=payment)) == {"socialfetch_balance": "warn"}


def test_youtube_and_anthropic():
    settings = {"youtube_enabled": True, "youtube_daily_quota": 9000}
    assert ca.find_alerts(settings, NOW, {}, youtube_used=8900) == []
    assert ids(ca.find_alerts(settings, NOW, {}, youtube_used=9000)) == {"youtube_quota:2026-11-05": "full"}
    assert ids(ca.find_alerts({}, NOW, {}, anthropic_low_at=NOW - timedelta(hours=2))) == {"anthropic_credit": "full"}
    assert ca.find_alerts({}, NOW, {}, anthropic_low_at=NOW - timedelta(hours=30)) == []


def test_each_level_is_sent_once_and_rearms_when_cleared():
    warn = [{"id": "socialfetch_balance", "level": "warn", "text": "x"}]
    due, state = ca.due_alerts(warn, {})
    assert due == warn and state == {"socialfetch_balance": "warn"}
    assert ca.due_alerts(warn, state) == ([], state)

    full = [{"id": "socialfetch_balance", "level": "full", "text": "x"}]
    due, state = ca.due_alerts(full, state)
    assert due == full and state == {"socialfetch_balance": "full"}
    # Falling back to warn after full sends nothing.
    assert ca.due_alerts(warn, state) == ([], {"socialfetch_balance": "full"})
    # Topped up: forgotten, so the next low balance alerts again.
    assert ca.due_alerts([], state) == ([], {})


def test_deliver_uses_each_admins_channels():
    recipients = [{"email": "a@vizual.az", "chat_id": "111"}, {"email": "", "chat_id": "222"}]
    telegram, emails = [], []
    sent = ca.deliver(
        [{"id": "x", "level": "full", "text": "Apify bitdi"}],
        recipients,
        send_telegram=lambda text, chat_id, bypass_pause: telegram.append((chat_id, bypass_pause, text)) or True,
        send_email=lambda smtp, message: emails.append(message["To"]),
        smtp={"sender": "Vizual <info@vizual.az>", "user": "info@vizual.az"},
    )
    assert sent == 3
    assert [chat for chat, _, _ in telegram] == ["111", "222"]
    assert all(bypass for _, bypass, _ in telegram)
    assert "🔴 Apify bitdi" in telegram[0][2]
    assert emails == ["a@vizual.az"]
    # No SMTP configured: Telegram only.
    assert ca.deliver([{"id": "x", "level": "warn", "text": "t"}], recipients[:1],
                      send_telegram=lambda *a, **k: True, smtp=None) == 1


def test_provider_parsing(monkeypatch):
    def fake_get(url, **kwargs):
        if url.endswith("/users/me/limits"):
            return FakeResponse(200, {"data": {
                "monthlyUsageCycle": {"startAt": "2026-10-20T00:00:00.000Z"},
                "limits": {"maxMonthlyUsageUsd": 49},
                "current": {"monthlyUsageUsd": 40.5},
            }})
        return FakeResponse(200, {"data": {"balance": 120, "billingAlert": "none", "refillState": "healthy"}})

    monkeypatch.setattr(ca.requests, "get", fake_get)
    assert ca.apify_limits("token") == {"used": 40.5, "limit": 49.0, "cycle": "2026-10-20"}
    assert ca.socialfetch_balance("key") == {"balance": 120, "billing_alert": "none", "refill_state": "healthy"}
    assert ca.apify_limits("") is None


def test_check_saves_state_only_after_delivery(monkeypatch):
    saved = {}
    monkeypatch.setattr(ca, "_state", {"last_check": None})
    monkeypatch.setattr(ca, "apify_limits", lambda token: None)
    monkeypatch.setattr(ca, "socialfetch_balance", lambda key: None)
    monkeypatch.setattr(ca, "anthropic_low_since", lambda: None)
    monkeypatch.setattr(ca.sm, "load_runtime_state", lambda key: (True, None))
    monkeypatch.setattr(ca.sm, "save_runtime_state", lambda key, value: saved.update({key: value}))
    monkeypatch.setattr(ca, "load_recipients", lambda: [{"email": "", "chat_id": "1"}])
    monkeypatch.setattr(ca.sm, "send_telegram", lambda *a, **k: False)
    settings = {"monthly_budget_usd": 10}
    ca.check(settings, NOW, lambda: {"usd": 10}, lambda: 0, "", "")
    assert saved == {}

    monkeypatch.setattr(ca.sm, "send_telegram", lambda *a, **k: True)
    ca.check(settings, NOW + timedelta(minutes=5), lambda: {"usd": 10}, lambda: 0, "", "")
    assert saved == {}  # throttled
    ca.check(settings, NOW + timedelta(minutes=31), lambda: {"usd": 10}, lambda: 0, "", "")
    assert saved == {ca.STATE_KEY: {"budget_total:2026-11": "full"}}


def test_check_can_be_switched_off(monkeypatch):
    monkeypatch.setattr(ca, "_state", {"last_check": None})
    monkeypatch.setattr(ca, "find_alerts", lambda *a, **k: (_ for _ in ()).throw(AssertionError("ran")))
    ca.check({"cost_alerts_enabled": False}, NOW, dict, int, "", "")
