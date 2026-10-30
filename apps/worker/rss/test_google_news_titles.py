import importlib.util
import os
import sys

import pytest

os.environ.setdefault("SUPABASE_URL", "")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "")

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

spec = importlib.util.spec_from_file_location("site_monitor_google_titles", os.path.join(HERE, "site_monitor.py"))
sm = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sm)

GOOGLE_LINK = "https://news.google.com/rss/articles/CBMiVEFVX3lxTE5EM3JsNnhyVlp6UlRPWXlQaXRqZHJrU2J3SnhBeUVUSEQ5My1ZaWNoS084RklKQjVjazZ0dlBLZGN2UFBBQm1pUEdlc1dITVpxcHVpWA?oc=5"


@pytest.fixture
def no_page_fetch(monkeypatch):
    def boom(*args, **kwargs):
        raise AssertionError("a Google News link must not be fetched for its title")

    monkeypatch.setattr(sm, "fetch_article_title_info", boom)


@pytest.mark.parametrize(
    "feed_title, headline",
    [
        ("Bakıda ağır qəza baş verib, iki nəfər ölüb - Report.az", "Bakıda ağır qəza baş verib, iki nəfər ölüb"),
        ("Prezident yeni sərəncam imzaladı – Azərbaycan24", "Prezident yeni sərəncam imzaladı"),
        ("Təhsil naziri yeni qaydalar barədə danışdı", "Təhsil naziri yeni qaydalar barədə danışdı"),
    ],
)
def test_google_news_headline_comes_from_the_feed_not_the_consent_page(no_page_fetch, feed_title, headline):
    info = sm.choose_best_article_title_info(feed_title, GOOGLE_LINK, source_domain="news.google.com")
    assert info["title"] == headline
    assert info["method"] == "google_news_title"


def test_google_news_title_that_is_only_a_publisher_name_is_rejected(no_page_fetch):
    info = sm.choose_best_article_title_info("Report.az", GOOGLE_LINK, source_domain="news.google.com")
    assert info["title"] == ""
