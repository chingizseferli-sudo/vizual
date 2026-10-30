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

spec = importlib.util.spec_from_file_location("site_monitor_google_fallback", os.path.join(HERE, "site_monitor.py"))
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
    """Records which feeds the read tried; only the Google News one returns an item."""
    urls = []

    def fake_rss(site, rss_urls):
        urls.extend(rss_urls)
        return [ITEM] if any("news.google.com" in url for url in rss_urls) else []

    monkeypatch.setattr(sm, "extract_links_from_rss", fake_rss)
    monkeypatch.setattr(sm, "extract_links_from_sitemap", lambda site: urls.append("sitemap") or [])
    monkeypatch.setattr(sm, "unique_items", lambda items: items)
    monkeypatch.setattr(sm, "mark_read_success", lambda *args, **kwargs: None)
    return urls


@pytest.mark.parametrize("status", [401, 500, 503, 520, 521])
def test_error_status_falls_back_to_google_news_without_touching_the_site(monkeypatch, requested, status):
    monkeypatch.setattr(sm, "safe_request", lambda *args, **kwargs: Response(status))
    items = sm.fetch_site(make_site(), {})
    assert items == [ITEM]
    assert all("news.google.com" in url for url in requested)
    assert "sitemap" not in requested


@pytest.mark.parametrize("error", [requests.Timeout("slow"), requests.exceptions.ConnectionError("refused")])
def test_unreachable_site_falls_back_to_google_news_only(monkeypatch, requested, error):
    def boom(*args, **kwargs):
        raise error

    monkeypatch.setattr(sm, "safe_request", boom)
    assert sm.fetch_site(make_site(), {}) == [ITEM]
    assert all("news.google.com" in url for url in requested)
    assert "sitemap" not in requested


def test_blocked_site_still_tries_its_own_feed_and_sitemap_first(monkeypatch, requested):
    monkeypatch.setattr(sm, "safe_request", lambda *args, **kwargs: Response(403))
    assert sm.fetch_site(make_site(), {}) == [ITEM]
    assert "sitemap" in requested
    assert any("news.google.com" in url for url in requested)


def test_missing_page_is_not_replaced_by_google_news(monkeypatch, requested):
    monkeypatch.setattr(sm, "safe_request", lambda *args, **kwargs: Response(404))
    assert sm.fetch_site(make_site(), {}) == []
    assert requested == []
