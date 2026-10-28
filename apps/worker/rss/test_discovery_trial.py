import discovery_bot as d


def site(status, reason="", score=40):
    return {"url": "https://yeni.az/xeber", "name": "yeni.az", "status": status, "reason": reason, "score": score}


def test_approved_and_review_both_enter_trial():
    for status in ("approved", "review"):
        payload = d.build_source_payload(site(status))
        assert payload["discovery_status"] == "accepted"
        assert payload["status"] == "inactive"
        assert "[trial passes=0 fails=0 since=" in payload["notes"]


def test_rejected_stays_rejected_without_trial_tag():
    payload = d.build_source_payload(site("rejected"))
    assert payload["discovery_status"] == "rejected"
    assert "[trial" not in (payload["notes"] or "")


def test_low_google_news_activity_does_not_reject_a_site(monkeypatch):
    html = "<html>" + "xəbər " * 10 + "</html>"

    class Session:
        pass

    monkeypatch.setattr(d, "page_news_stats", lambda session, url: (True, 12, 0, html))
    monkeypatch.setattr(d, "find_working_rss", lambda session, url, text: (None, 0))
    monkeypatch.setattr(d, "google_news_activity_count", lambda session, domain, hours: 0)
    monkeypatch.setattr(d, "guess_selector_and_xpath", lambda session, url: ("article", [], 10))
    result = d.analyze_section(Session(), "Yerli xəbər", "https://yerli.az")
    assert result["status"] != "rejected"
    assert "insufficient_news_activity" not in result["reason"]


def test_non_azerbaijani_page_is_rejected_for_good(monkeypatch):
    monkeypatch.setattr(d, "page_news_stats", lambda session, url: (True, 12, 0, "Последние новости России"))
    monkeypatch.setattr(d, "find_working_rss", lambda session, url, text: (None, 0))
    result = d.analyze_section(object(), "Новости", "https://novosti.com")
    assert result["status"] == "rejected"
    assert d.is_hard_rejected(result)


def test_site_with_too_few_news_links_is_rejected(monkeypatch):
    html = "<html>" + "xəbər " * 10 + "</html>"
    monkeypatch.setattr(d, "page_news_stats", lambda session, url: (True, 2, 0, html))
    monkeypatch.setattr(d, "find_working_rss", lambda session, url, text: (None, 0))
    monkeypatch.setattr(d, "google_news_activity_count", lambda session, domain, hours: 0)
    result = d.analyze_section(object(), "Kiçik", "https://kicik.az")
    assert result["status"] == "rejected"


def test_store_and_encyclopedia_domains_are_not_candidates():
    for url in ("https://apps.apple.com/az/app/x", "https://az.wikipedia.org/wiki/X"):
        assert d.is_bad_url(url)


def test_rotating_queries_change_every_run_and_cover_all_regions():
    first = d.rotating_queries(0)
    assert first != d.rotating_queries(1)
    seen = set()
    for slot in range(len(d.REGION_NAMES)):
        seen.update(q for q in d.rotating_queries(slot) if q.endswith(" xəbərləri") and "Azərbaycan" not in q)
    assert len(seen) == len(d.REGION_NAMES)


def test_fast_mode_queries_fit_the_limit():
    assert len(d.build_search_queries("fast", slot=3)) <= d.get_mode_settings("fast")["max_queries"]


def test_commercial_and_subdomain_rejections_stay_final():
    assert d.is_hard_rejected(site("rejected", "commercial_site_not_news"))
    assert d.is_hard_rejected(site("rejected", "subdomain_rejected"))


def test_unreachable_site_is_not_reachable():
    class Dead:
        def get(self, *args, **kwargs):
            raise d.requests.RequestException("down")

    class Live:
        def get(self, *args, **kwargs):
            return type("R", (), {"status_code": 403})()

    assert not d.site_reachable(Dead(), "https://dead.az")
    assert d.site_reachable(Live(), "https://blocks-us.az")


def test_queries_cover_domains_other_than_az():
    for mode in ("fast", "deep"):
        queries = d.build_search_queries(mode)
        assert any(q.startswith("site:.com ") for q in queries)
        assert any(q.startswith("site:.info ") for q in queries)
        assert any(q.startswith("site:.media ") for q in queries)
    assert len(d.build_search_queries("fast")) <= d.get_mode_settings("fast")["max_queries"]


def test_azerbaijani_language_keeps_non_az_domains_for_review():
    az_page = "Azərbaycan xəbər gündəm cəmiyyət siyasət"
    assert d.is_azerbaijani_source("yeni.az")
    assert d.is_azerbaijani_source("yeni.com", az_page)
    assert d.is_azerbaijani_source("yeni.info", "", ["Azərbaycan xəbər dili siqnalı var (4)"])
    assert not d.is_azerbaijani_source("example.com", "latest world headlines and sports")
