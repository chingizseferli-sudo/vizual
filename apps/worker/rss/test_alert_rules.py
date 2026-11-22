from datetime import datetime

import alert_rules as ar
import email_reports


class FakeResponse:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


class FakeHttp:
    def __init__(self, profiles, priority):
        self.calls = []
        self.answers = {"user_profiles": profiles, "user_priority_sources": priority}

    def get(self, url, **kwargs):
        name = url.rsplit("/", 1)[-1]
        self.calls.append((name, kwargs["params"]))
        return FakeResponse(200, self.answers[name])


NOW = datetime(2026, 11, 21, 12, 0, tzinfo=email_reports.BAKU_TZ)
SMTP = {"host": "smtp", "port": 465, "user": "info@vizual.az", "password": "x", "sender": "Vizual <info@vizual.az>"}


def load(monkeypatch, profiles=(), priority=()):
    monkeypatch.setattr(ar, "_cache", {"at": 0.0, "profiles": {}, "priority": {}})
    monkeypatch.setattr(ar, "_emails", {"day": None, "sent": {}, "keys": set()})
    http = FakeHttp(list(profiles), list(priority))
    ar.refresh(http, "https://db", {}, 5, now=1000.0)
    return http


def test_refresh_reads_only_customers_with_alert_settings_and_caches(monkeypatch):
    http = load(monkeypatch, [{"user_id": "u1", "alert_email": True}], [{"user_id": "u1", "source_id": "s1"}])
    assert http.calls[0][1]["or"] == "(alert_email.is.true,engagement_alert_threshold.not.is.null)"
    assert ar.priority_source_ids() == {"s1"}
    ar.refresh(http, "https://db", {}, 5, now=1000.0 + ar.CACHE_SECONDS - 1)
    assert len(http.calls) == 2


def test_marks_and_headline(monkeypatch):
    load(monkeypatch, [{"user_id": "u1", "engagement_alert_threshold": 100}], [{"user_id": "u1", "source_id": "s1"}])
    matches = [{"user_id": "u1", "is_critical": False}, {"user_id": "u1", "is_critical": True}]
    assert ar.marks("u1", matches, "s1", engagement=100) == ["critical", "priority", "engagement"]
    assert ar.marks("u1", matches[:1], "s2", engagement=99) == []
    # Another customer's priority source does not mark this customer's alert.
    assert ar.marks("u2", [{"user_id": "u2"}], "s1") == []
    assert ar.headline(["critical", "priority"]) == "🚨 KRİTİK AÇAR SÖZ\n⭐ PRİORİTET MƏNBƏ\n\n"
    assert ar.headline([]) == ""


def test_email_goes_only_to_customers_who_asked_once_per_alert(monkeypatch):
    load(monkeypatch, [{"user_id": "u1", "email": "a@b.az", "alert_email": True},
                       {"user_id": "u2", "email": "c@d.az", "alert_email": False}])
    monkeypatch.setattr(email_reports, "smtp_settings", lambda: SMTP)
    sent = []

    def send(settings, message):
        sent.append(message)

    assert ar.email_alert("u1", ["critical"], "Yeni uyğun xəbər", key="L1", now=NOW, send=send, background=False)
    assert not ar.email_alert("u1", ["critical"], "Yeni uyğun xəbər", key="L1", now=NOW, send=send, background=False)
    assert not ar.email_alert("u1", [], "x", key="L2", now=NOW, send=send, background=False)
    assert not ar.email_alert("u2", ["critical"], "x", key="L3", now=NOW, send=send, background=False)
    assert len(sent) == 1
    assert sent[0]["To"] == "a@b.az" and sent[0]["Subject"] == "Vizual.Az bildiriş: Kritik açar söz"
    assert sent[0].get_content().startswith("🚨 KRİTİK AÇAR SÖZ\n\nYeni uyğun xəbər")


def test_email_daily_limit_and_missing_smtp(monkeypatch):
    load(monkeypatch, [{"user_id": "u1", "email": "a@b.az", "alert_email": True}])
    monkeypatch.setattr(email_reports, "smtp_settings", lambda: None)
    assert not ar.email_alert("u1", ["critical"], "x", key="L0", now=NOW, send=lambda *_: None, background=False)
    monkeypatch.setattr(email_reports, "smtp_settings", lambda: SMTP)
    results = [ar.email_alert("u1", ["priority"], "x", key=f"L{i}", now=NOW, send=lambda *_: None, background=False)
               for i in range(ar.DAILY_EMAIL_LIMIT + 1)]
    assert results.count(True) == ar.DAILY_EMAIL_LIMIT and results[-1] is False
