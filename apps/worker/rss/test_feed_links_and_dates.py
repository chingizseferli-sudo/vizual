from datetime import datetime, timedelta

import site_monitor as sm


def test_feed_link_with_doubled_scheme_is_read():
    results = []
    reason = sm.add_item(
        results, "https://sports.az/feed/", "Azərbaycan millisinin heyətində dəyişiklik",
        "https:https://sports.az/az/azerbaycan-futbolu/71344/", [], {"source_context": "rss", "url_patterns": []},
    )
    assert reason == "" and results[0]["link"] == "https://sports.az/az/azerbaycan-futbolu/71344/"


def test_category_then_numeric_id_is_an_article():
    assert sm.is_article_like_link("https://sports.az/az/diger/71343/")


def _fmt(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%S+04:00")


def test_date_a_few_hours_ahead_is_a_clock_offset_not_the_future():
    soon = datetime.now(sm.BAKU_TZ) + timedelta(hours=1)
    assert sm.get_freshness_status(_fmt(soon)) == "fresh"


def test_date_days_ahead_is_still_the_future():
    assert sm.get_freshness_status(_fmt(datetime.now(sm.BAKU_TZ) + timedelta(days=3))) == "future_date"


def test_body_date_in_the_future_does_not_beat_an_old_feed_date():
    now = datetime.now(sm.BAKU_TZ)
    rss = _fmt(now - timedelta(days=6))
    published, status = sm.evaluate_publish_freshness(
        "Kredit kampaniyası", "31 yanvar 2027", rss_time=rss, source_context="rss",
    )
    assert status == "old_news"


def test_body_date_in_the_future_without_any_feed_date_stays_future():
    _, status = sm.evaluate_publish_freshness("Tədbir", _fmt(datetime.now(sm.BAKU_TZ) + timedelta(days=30)))
    assert status == "future_date"
