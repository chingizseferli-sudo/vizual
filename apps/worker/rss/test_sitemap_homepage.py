import importlib.util
import os
import sys

import pytest

os.environ.setdefault("SUPABASE_URL", "")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "")

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

spec = importlib.util.spec_from_file_location("site_monitor_sitemap_homepage", os.path.join(HERE, "site_monitor.py"))
sm = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sm)

OLD = {"title": "Köhnə xəbər", "link": "https://yerli.az/manset/2040-kohne.html"}
NEW = {"title": "Yeni xəbər", "link": "https://yerli.az/manset/10320-yeni.html"}


def make_site(method="sitemap"):
    return {
        "name": "yerli.az",
        "url": "https://yerli.az/sitemap.xml",
        "base_url": "https://yerli.az",
        "monitor_method": method,
    }


@pytest.fixture
def reads(monkeypatch):
    calls = []

    def fake_once(site, patterns_data):
        calls.append((site["monitor_method"], site["url"]))
        return [NEW] if site["monitor_method"] == "homepage" else [OLD]

    monkeypatch.setattr(sm, "fetch_site_once", fake_once)
    return calls


def test_homepage_articles_come_before_a_stale_sitemap(reads):
    items = sm.fetch_site(make_site(), {})
    assert [item["link"] for item in items] == [NEW["link"], OLD["link"]]
    assert reads == [("sitemap", "https://yerli.az/sitemap.xml"), ("homepage", "https://yerli.az")]


def test_other_methods_do_not_read_the_homepage_twice(reads):
    sm.fetch_site(make_site("latest_page"), {})
    assert reads == [("latest_page", "https://yerli.az/sitemap.xml")]


def test_sitemap_items_stay_when_the_homepage_is_empty(monkeypatch):
    monkeypatch.setattr(sm, "fetch_site_once", lambda site, data: [] if site["monitor_method"] == "homepage" else [OLD])
    assert sm.fetch_site(make_site(), {}) == [OLD]
