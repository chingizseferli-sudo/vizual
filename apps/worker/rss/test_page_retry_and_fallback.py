import importlib.util
import os
import sys

import pytest
import requests

os.environ.setdefault("SUPABASE_URL", "")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "")

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

spec = importlib.util.spec_from_file_location("site_monitor_page_retry", os.path.join(HERE, "site_monitor.py"))
sm = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sm)

ITEM = {"title": "Yeni xəbər", "url": "https://yerli.az/x"}


class Response:
    def __init__(self, status):
        self.status_code = status
        self.url = "https://yerli.az"
        self.text = ""
        self.content = b""
        self.encoding = "utf-8"
        self.headers = {}


def make_site():
    return {"name": "yerli.az", "url": "https://yerli.az", "base_url": "https://yerli.az", "monitor_method": "latest_page"}


@pytest.fixture
def requested(monkeypatch):
    """Records which feeds the read tried; the site's own feed returns an item."""
    urls = []

    def fake_rss(site, rss_urls):
        urls.extend(rss_urls)
        return [ITEM] if not any("news.google.com" in url for url in rss_urls) else []

    monkeypatch.setattr(sm, "extract_links_from_rss", fake_rss)
    monkeypatch.setattr(sm, "extract_links_from_sitemap", lambda site: urls.append("sitemap") or [])
    monkeypatch.setattr(sm, "unique_items", lambda items: items)
    monkeypatch.setattr(sm, "mark_read_success", lambda *args, **kwargs: None)
    monkeypatch.setattr(sm.time, "sleep", lambda seconds: None)
    return urls


def test_blocked_site_tries_its_own_feed_and_never_google_news(monkeypatch, requested):
    monkeypatch.setattr(sm, "safe_request", lambda *args, **kwargs: Response(403))
    assert sm.fetch_site(make_site(), {}) == [ITEM]
    assert not any("news.google.com" in url for url in requested)


@pytest.mark.parametrize("status", [401, 404, 500, 520])
def test_broken_site_is_not_replaced_by_google_news(monkeypatch, requested, status):
    calls = []
    monkeypatch.setattr(sm, "safe_request", lambda *args, **kwargs: calls.append(1) or Response(status))
    assert sm.fetch_site(make_site(), {}) == []
    assert requested == []
    assert len(calls) == 1, "a site that never worked is not retried"


def test_unreachable_site_gives_nothing_and_is_not_retried_without_history(monkeypatch, requested):
    calls = []

    def boom(*args, **kwargs):
        calls.append(1)
        raise requests.Timeout("slow")

    monkeypatch.setattr(sm, "safe_request", boom)
    assert sm.fetch_site(make_site(), {}) == []
    assert requested == [] and len(calls) == 1


def test_site_that_worked_before_gets_one_more_try_after_a_timeout(monkeypatch, requested):
    answers = [requests.Timeout("slow"), Response(200)]

    def flaky(*args, **kwargs):
        answer = answers.pop(0)
        if isinstance(answer, Exception):
            raise answer
        return answer

    monkeypatch.setattr(sm, "safe_request", flaky)
    site = dict(make_site(), last_success_at="2026-11-08T10:00:00+04:00")
    response = sm.request_page_with_one_retry(site, site["url"], method="latest_page", headers={})
    assert response.status_code == 200 and answers == []


def test_site_that_worked_before_is_retried_only_once(monkeypatch, requested):
    calls = []

    def always_down(*args, **kwargs):
        calls.append(1)
        return Response(503)

    monkeypatch.setattr(sm, "safe_request", always_down)
    site = dict(make_site(), last_success_at="2026-11-08T10:00:00+04:00")
    assert sm.request_page_with_one_retry(site, site["url"], method="latest_page", headers={}).status_code == 503
    assert len(calls) == 2


def test_transient_failures_are_probed_again_within_minutes_then_back_off():
    from datetime import timedelta
    for reason in ("timeout", "http_503", "http_520"):
        assert sm.source_backoff_interval(reason, fail_count=1) == timedelta(minutes=10)
        assert sm.source_backoff_interval(reason, fail_count=3) == timedelta(minutes=30)
        assert sm.source_backoff_interval(reason, fail_count=6) == timedelta(hours=2)
        assert sm.source_backoff_interval(reason, fail_count=12) == timedelta(hours=6)
