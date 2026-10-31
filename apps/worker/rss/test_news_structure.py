from datetime import datetime, timedelta, timezone

import news_structure as ns

NOW = datetime(2026, 10, 31, 12, 0, tzinfo=timezone.utc)
TEXT = "<p>" + "söz " * 120 + "</p>"


def page(published, markup=True, text=TEXT):
    ld = (
        '<script type="application/ld+json">{"@type":"NewsArticle","datePublished":"%s"}</script>' % published
        if markup
        else ""
    )
    return f"<html><head>{ld}</head><body><article>{text}</article></body></html>"


def hours_ago(hours):
    return (NOW - timedelta(hours=hours)).isoformat()


def test_jsonld_article_with_date_and_text_is_evidence():
    info = ns.article_evidence(page(hours_ago(5)), NOW)
    assert info["markup"] and info["published"] is not None and info["words"] >= 80


def test_azerbaijani_numeric_date_in_time_tag_is_read():
    html = '<html><body><time>30-10-2026, 09:30</time><article>%s</article></body></html>' % TEXT
    info = ns.article_evidence(html, NOW)
    assert info["published"] == datetime(2026, 10, 30, 5, 30, tzinfo=timezone.utc)


def test_future_and_nonsense_dates_are_ignored():
    assert ns.parse_published("2031-01-01T00:00:00+04:00", NOW) is None
    assert ns.parse_published("tezliklə", NOW) is None


def evidence(published_hours, words=150):
    return [{"published": NOW - timedelta(hours=h) if h is not None else None, "markup": True, "words": words} for h in published_hours]


def test_active_news_site_passes():
    ok, reason, stats = ns.judge_articles(evidence([2, 9, 30, 50, 100, 140]), NOW)
    assert ok, reason
    assert stats["fresh_72h"] >= 1 and stats["fresh_7d"] >= 3


def test_company_site_with_old_news_section_is_rejected():
    ok, reason, _ = ns.judge_articles(evidence([2000, 2500, 3000, 4000]), NOW)
    assert not ok and reason.startswith("stale")


def test_site_whose_articles_have_no_dates_is_rejected():
    ok, reason, _ = ns.judge_articles(evidence([None, None, None, None]), NOW)
    assert not ok and reason.startswith("undated")


def test_site_with_one_fresh_post_a_month_is_rejected():
    ok, reason, _ = ns.judge_articles(evidence([5, 400, 900]), NOW)
    assert not ok and reason.startswith("stale")


def test_site_without_a_recent_post_is_rejected():
    ok, reason, _ = ns.judge_articles(evidence([80, 100, 120, 150]), NOW)
    assert not ok and reason == "nothing_in_72h"


def test_pages_without_article_text_are_rejected():
    ok, reason, _ = ns.judge_articles(evidence([2, 9, 30, 50], words=10), NOW)
    assert not ok and reason.startswith("no_article_text")


def test_too_few_readable_articles_is_rejected():
    ok, reason, _ = ns.judge_articles(evidence([2, 9]), NOW)
    assert not ok and reason == "too_few_articles:2"


def test_feed_with_fresh_entries_passes_when_pages_cannot_be_read():
    dates = [NOW - timedelta(hours=h) for h in (1, 20, 60, 100)]
    assert ns.judge_feed_dates(dates, NOW)[0]
    assert not ns.judge_feed_dates([NOW - timedelta(days=40)], NOW)[0]
