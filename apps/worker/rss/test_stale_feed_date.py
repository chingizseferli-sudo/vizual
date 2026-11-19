from datetime import datetime, timedelta

import site_monitor as sm


NOW = datetime(2026, 11, 19, 20, 0, tzinfo=sm.BAKU_TZ)


def test_old_feed_date_is_stale():
    assert sm.feed_date_is_stale({"rss_published": "Wed, 18 Nov 2026 10:00:00 +0400"}, now=NOW)
    assert sm.feed_date_is_stale({"listing_published": "18.11.2026 10:00"}, now=NOW)


def test_recent_missing_or_mislabelled_dates_are_not_stale():
    assert not sm.feed_date_is_stale({"rss_published": (NOW - timedelta(minutes=20)).isoformat()}, now=NOW)
    # Local Baku time labelled as UTC looks 4 hours old; it must still be read.
    assert not sm.feed_date_is_stale({"rss_published": "Thu, 19 Nov 2026 19:40:00 GMT"}, now=NOW + timedelta(hours=4))
    assert not sm.feed_date_is_stale({}, now=NOW)
    assert not sm.feed_date_is_stale({"rss_published": "not a date"}, now=NOW)


def test_stale_item_skips_the_article_page(monkeypatch):
    opened = []
    monkeypatch.setattr(sm, "fetch_site", lambda site, patterns: [{
        "title": "Köhnə xəbər", "link": "https://news.az/old-1", "source": "news.az",
        "rss_published": "Mon, 16 Nov 2026 10:00:00 +0400", "source_context": "rss",
    }])
    monkeypatch.setattr(sm, "extract_publish_time_from_article", lambda *a, **k: opened.append(a) or (None, "missing"))
    monkeypatch.setattr(sm, "update_source_health", lambda *a, **k: None)
    monkeypatch.setattr(sm, "ARTICLE_VERDICT_CACHE", type(sm.ARTICLE_VERDICT_CACHE)())
    result = sm.process_site(1, 1, {"name": "News", "url": "https://news.az", "id": "s1"}, {}, [], [])
    assert result["reason"] == "old_news"
    assert opened == []
