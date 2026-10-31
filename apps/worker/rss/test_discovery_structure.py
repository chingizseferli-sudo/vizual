import discovery_bot as d

HOME = """
<a href="/xeber/12345-prezident-yeni-serencam-imzaladi">Prezident yeni sərəncam imzaladı bu gün</a>
<a href="/xeber/12346-baki-da-aqir-qeza-bas-verib">Bakıda ağır qəza baş verib iki nəfər</a>
<a href="/about">Haqqımızda</a>
<a href="https://other.az/xeber/1-bashqa-sayt-xeberi">Başqa saytın xəbəri burada</a>
<a href="/xeber/12347-qisa">Qısa</a>
"""


def test_article_links_come_from_the_same_site_and_headline_links_first():
    links = d.pick_article_links(HOME, "https://yerli.az")
    assert links[0].endswith("12345-prezident-yeni-serencam-imzaladi")
    assert links[1].endswith("12346-baki-da-aqir-qeza-bas-verib")
    assert not any("other.az" in link or "about" in link for link in links)


def test_unreadable_pages_fall_back_to_the_feed(monkeypatch):
    from datetime import datetime, timedelta, timezone

    class Session:
        def get(self, *args, **kwargs):
            raise OSError("blocked")

    now = datetime.now(timezone.utc)
    monkeypatch.setattr(d, "feed_publish_dates", lambda url: [now - timedelta(hours=h) for h in (1, 30, 70)])
    ok, reason, _ = d.verify_news_structure(Session(), "https://yerli.az", HOME, "https://yerli.az/rss")
    assert ok, reason
    ok, reason, _ = d.verify_news_structure(Session(), "https://yerli.az", HOME, None)
    assert not ok and reason == "too_few_articles:0"


def test_site_failing_the_structure_check_is_a_hard_reject(monkeypatch):
    html = "<html>" + "xəbər " * 10 + "</html>"
    monkeypatch.setattr(d, "page_news_stats", lambda session, url: (True, 12, 0, html))
    monkeypatch.setattr(d, "find_working_rss", lambda session, url, text: (None, 0))
    monkeypatch.setattr(d, "verify_news_structure", lambda *args: (False, "stale:0_in_7d", {}))
    result = d.analyze_section(object(), "Yerli xəbər", "https://yerli.az")
    assert result["status"] == "rejected"
    assert d.is_hard_rejected(result)
