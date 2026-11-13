import importlib.util
import os
import sys
from datetime import datetime, timedelta

os.environ.setdefault("SUPABASE_URL", "")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "")

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

from language_variants import find_language_variants

spec = importlib.util.spec_from_file_location("site_monitor_langs", os.path.join(HERE, "site_monitor.py"))
sm = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sm)

SWITCHER = '<a href="/az/">Azərbaycanca</a><a href="/en/"><img></a><a href="/lenta/">Все</a><a href="/news/1-abc">x</a>'


def test_switcher_links_found_from_russian_root():
    assert find_language_variants("https://1news.az/", SWITCHER) == ["https://1news.az/az/", "https://1news.az/en/"]


def test_own_language_and_other_hosts_skipped():
    html = '<a href="/az/">az</a><a href="https://other.com/en/">en</a><a href="/en/">en</a>'
    assert find_language_variants("https://1news.az/az/", html) == ["https://1news.az/en/"]


def test_hreflang_and_subdomain():
    html = '<link rel="alternate" hreflang="en-US" href="https://site.az/english/"><link rel="alternate" hreflang="x-default" href="/"><a href="https://ru.site.az/">ru</a>'
    assert find_language_variants("https://site.az/", html) == ["https://site.az/english/", "https://ru.site.az/"]


def test_no_variants_for_one_language_site():
    assert find_language_variants("https://site.az/", '<a href="/news/12345-abc">x</a><a href="/about/">a</a>') == []


def test_expand_adds_variants_without_health_id_and_skips_existing(monkeypatch):
    now = datetime.now(sm.BAKU_TZ)
    sm.LANGUAGE_VARIANTS_CACHE.clear()
    sm.LANGUAGE_VARIANTS_CACHE["1news.az"] = (now + timedelta(hours=1), ["https://1news.az/az/", "https://1news.az/en/"])
    parent = {"id": "p1", "name": "1news.az", "url": "https://1news.az/", "base_url": "https://1news.az/", "rss_url": "https://1news.az/rss", "url_patterns": ["x"], "monitor_method": "rss"}
    already = {"id": "p2", "name": "1news en", "url": "https://1news.az/en/", "base_url": "https://1news.az/en/"}
    result = sm.expand_language_variants([parent, already])
    assert len(result) == 3
    variant = result[2]
    assert variant["url"] == "https://1news.az/az/" and variant["id"] is None
    assert variant["name"] == "1news.az (AZ)" and variant["rss_url"] == "" and variant["monitor_method"] == "latest_page"
    assert parent["id"] == "p1" and parent["rss_url"]
