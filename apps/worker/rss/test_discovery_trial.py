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


def test_low_google_news_activity_is_not_a_final_rejection():
    assert not d.is_hard_rejected(site("review", "insufficient_news_activity: 0/15 in last 24h"))


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
