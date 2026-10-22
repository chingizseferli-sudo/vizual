import importlib.util
import os
from datetime import date, datetime
from zoneinfo import ZoneInfo

import pytest

BAKU = ZoneInfo("Asia/Baku")
USER = "11111111-2222-3333-4444-555555555555"


def load_module():
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "email_reports.py")
    spec = importlib.util.spec_from_file_location("email_reports_under_test", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FakeResponse:
    def __init__(self, status_code, payload=None):
        self.status_code = status_code
        self._payload = payload
        self.text = str(payload)

    def json(self):
        return self._payload


class FakeHttp:
    def __init__(self, recipients=None, claim="delivery-1", data=None):
        self.recipients = recipients if recipients is not None else {"weekly": [{"user_id": USER, "email": "a@x.az"}]}
        self.claim = claim
        self.data = data if data is not None else {
            "total": 12, "previous_total": 8,
            "keywords": [{"keyword": "ABB", "mentions": 9}, {"keyword": "SOCAR", "mentions": 3}],
            "sources": [{"source": "report.az", "mentions": 7}],
            "headlines": [{"title": "ABB <yeni> kredit", "url": "https://report.az/abb", "source": "report.az", "keyword": "ABB"},
                          {"title": "Pis link", "url": "javascript:alert(1)", "source": "x", "keyword": "ABB"}],
        }
        self.calls = []

    def post(self, url, json=None, **kwargs):
        name = url.rsplit("/", 1)[-1]
        self.calls.append(("POST", name, json))
        if name == "email_report_recipients":
            return FakeResponse(200, self.recipients.get(json["p_kind"], []))
        if name == "claim_email_report":
            return FakeResponse(200, self.claim)
        if name == "email_report_data":
            return FakeResponse(200, self.data)
        raise AssertionError(name)

    def patch(self, url, json=None, params=None, **kwargs):
        self.calls.append(("PATCH", url.rsplit("/", 1)[-1], json, params))
        return FakeResponse(204)

    def finished(self):
        return [call[2] for call in self.calls if call[0] == "PATCH"]


@pytest.fixture
def er(monkeypatch):
    monkeypatch.setenv("SMTP_HOST", "smtp.zoho.com")
    monkeypatch.setenv("SMTP_PORT", "465")
    monkeypatch.setenv("SMTP_USER", "info@vizual.az")
    monkeypatch.setenv("SMTP_PASSWORD", "s3cret-pass")
    monkeypatch.setenv("MAIL_FROM", "Vizual.Az <info@vizual.az>")
    return load_module()


def at(*args):
    return datetime(*args, tzinfo=BAKU)


def test_periods_are_last_finished_baku_period_and_wait_for_8am(er):
    # Monday 19 Oct 2026
    assert er.report_period("daily", at(2026, 10, 20, 7, 59)) is None
    assert er.report_period("daily", at(2026, 10, 20, 8, 0)) == (date(2026, 10, 19), date(2026, 10, 19))
    assert er.report_period("weekly", at(2026, 10, 19, 9)) == (date(2026, 10, 12), date(2026, 10, 18))
    assert er.report_period("weekly", at(2026, 10, 22, 9)) == (date(2026, 10, 12), date(2026, 10, 18))
    assert er.report_period("weekly", at(2026, 10, 19, 7)) is None  # Monday before 08:00
    assert er.report_period("monthly", at(2026, 11, 1, 8)) == (date(2026, 10, 1), date(2026, 10, 31))
    assert er.report_period("monthly", at(2026, 11, 1, 7)) is None
    assert er.report_period("monthly", at(2026, 1, 15, 12)) == (date(2025, 12, 1), date(2025, 12, 31))
    assert er.previous_period_start("monthly", date(2026, 3, 1)) == date(2026, 2, 1)
    assert er.previous_period_start("weekly", date(2026, 10, 12)) == date(2026, 10, 5)


def test_labels_and_change_text(er):
    assert er.period_label("weekly", date(2026, 9, 28), date(2026, 10, 4)) == "28 sentyabr – 4 oktyabr 2026"
    assert er.period_label("weekly", date(2026, 10, 13), date(2026, 10, 19)) == "13–19 oktyabr 2026"
    assert er.period_label("monthly", date(2026, 9, 1), date(2026, 9, 30)) == "Sentyabr 2026"
    assert er.change_text("weekly", 12, 8) == "Əvvəlki həftə: 8 (+50%)"
    assert er.change_text("daily", 2, 4) == "Dünənki gün: 4 (-50%)"
    assert er.change_text("monthly", 2, None) == ""


def test_weekly_report_is_sent_once_and_marked(er):
    http = FakeHttp()
    sent = []
    count = er.send_due_reports(http, "https://db", {}, now=at(2026, 10, 20, 9), send=lambda s, m: sent.append(m))
    assert count == 1 and len(sent) == 1
    message = sent[0]
    assert message["To"] == "a@x.az"
    assert message["Subject"] == "Vizual.Az · həftəlik hesabat · 12–18 oktyabr 2026"
    html = message.get_body(("html",)).get_content()
    text = message.get_body(("plain",)).get_content()
    assert "ABB &lt;yeni&gt; kredit" in html and "<yeni>" not in html
    assert 'href="https://report.az/abb"' in html and "javascript:" not in html
    assert "Əvvəlki həftə: 8 (+50%)" in text and "ABB: 9" in text
    assert http.finished() == [{"status": "sent", "mention_count": 12, "updated_at": http.finished()[0]["updated_at"]}]
    claim = [c[2] for c in http.calls if c[1] == "claim_email_report"][0]
    assert claim["p_period_start"] == "2026-10-12" and claim["p_period_end"] == "2026-10-18"
    data_call = [c[2] for c in http.calls if c[1] == "email_report_data"][0]
    assert data_call["p_from"].startswith("2026-10-12T00:00:00+04:00")
    assert data_call["p_to"].startswith("2026-10-19T00:00:00+04:00")
    assert data_call["p_prev_from"].startswith("2026-10-05T00:00:00+04:00")


def test_monthly_comparison_skipped_when_older_data_is_deleted(er):
    http = FakeHttp(recipients={"monthly": [{"user_id": USER, "email": "a@x.az"}]})
    er.send_due_reports(http, "https://db", {}, now=at(2026, 11, 1, 9), send=lambda s, m: None)
    data_call = [c[2] for c in http.calls if c[1] == "email_report_data"][0]
    assert data_call["p_prev_from"] is None


def test_already_claimed_report_is_not_sent(er):
    http = FakeHttp(claim=None)
    sent = []
    assert er.send_due_reports(http, "https://db", {}, now=at(2026, 10, 20, 9), send=lambda s, m: sent.append(m)) == 0
    assert not sent and not http.finished()


def test_empty_daily_is_skipped_not_sent(er):
    http = FakeHttp(recipients={"daily": [{"user_id": USER, "email": "a@x.az"}]},
                    data={"total": 0, "previous_total": 3, "keywords": [], "sources": [], "headlines": []})
    sent = []
    er.send_due_reports(http, "https://db", {}, now=at(2026, 10, 21, 9), send=lambda s, m: sent.append(m))
    assert not sent
    assert http.finished()[0]["status"] == "skipped"


def test_smtp_failure_marks_failed_without_leaking_password(er):
    http = FakeHttp()

    def boom(settings, message):
        raise RuntimeError("535 auth failed for info@vizual.az / s3cret-pass")

    assert er.send_due_reports(http, "https://db", {}, now=at(2026, 10, 20, 9), send=boom) == 0
    result = http.finished()[0]
    assert result["status"] == "failed"
    assert "s3cret-pass" not in result["error"] and "***" in result["error"]


def test_missing_smtp_settings_send_nothing(er, monkeypatch, capsys):
    monkeypatch.delenv("SMTP_PASSWORD")
    http = FakeHttp()
    assert er.send_due_reports(http, "https://db", {}, now=at(2026, 10, 20, 9), send=lambda s, m: None) == 0
    assert http.calls == []
    assert "SMTP_PASSWORD" in capsys.readouterr().out


def test_checks_at_most_every_ten_minutes(er):
    http = FakeHttp(recipients={})
    er.send_due_reports(http, "https://db", {}, now=at(2026, 10, 20, 9, 0))
    first = len(http.calls)
    er.send_due_reports(http, "https://db", {}, now=at(2026, 10, 20, 9, 5))
    assert len(http.calls) == first
    er.send_due_reports(http, "https://db", {}, now=at(2026, 10, 20, 9, 11))
    assert len(http.calls) > first


def test_budget_limits_emails_per_check(er):
    er.REPORTS_PER_CHECK = 2
    people = [{"user_id": f"u{i}", "email": f"u{i}@x.az"} for i in range(5)]
    http = FakeHttp(recipients={"daily": people, "weekly": people})
    sent = []
    er.send_due_reports(http, "https://db", {}, now=at(2026, 10, 20, 9), send=lambda s, m: sent.append(m))
    assert len(sent) == 2
    asked = [c[2]["p_limit"] for c in http.calls if c[1] == "email_report_recipients"]
    assert asked[0] == 2


def test_smtp_ssl_on_465(er, monkeypatch):
    seen = {}

    class FakeSMTP:
        def __init__(self, host, port, timeout=None, context=None):
            seen["connect"] = (host, port)

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def login(self, user, password):
            seen["login"] = (user, password)

        def send_message(self, message):
            seen["to"] = message["To"]

    monkeypatch.setattr(er.smtplib, "SMTP_SSL", FakeSMTP)
    settings = er.smtp_settings()
    er.send_message(settings, er.build_message(settings, "a@x.az", "daily", date(2026, 10, 19), date(2026, 10, 19), {"total": 1}))
    assert seen == {"connect": ("smtp.zoho.com", 465), "login": ("info@vizual.az", "s3cret-pass"), "to": "a@x.az"}
