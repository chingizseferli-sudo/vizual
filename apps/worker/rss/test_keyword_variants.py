from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

import keyword_variants_ai
from test_competitors import FakeClaude, FakeRequests, FakeResponse, load_site_monitor

BAKU = ZoneInfo("Asia/Baku")


@pytest.fixture()
def sm():
    module = load_site_monitor()
    module.SUPABASE_URL = "https://example.supabase.co"
    module.SUPABASE_SERVICE_ROLE_KEY = "service"
    return module


def row(row_id, keyword, aliases=None, suggestions=None, user="u1", monitor="m1"):
    return {
        "id": row_id,
        "keyword": keyword,
        "aliases": aliases or [],
        "alias_suggestions": suggestions,
        "monitor_id": monitor,
        "status": "active",
        "user_monitors": {"id": monitor, "user_id": user, "name": "M", "status": "active"},
    }


def test_clean_variants_drops_keyword_repeats_and_bad_lengths():
    assert keyword_variants_ai.clean_variants(
        "Azərbaycan Hava Yolları",
        ["Azerbaijan  Airlines", "azerbaijan airlines", "azərbaycan hava yolları", "A", "AZAL", "x" * 101, "Азербайджанские авиалинии", "AHY", "extra"],
    ) == ["Azerbaijan Airlines", "AZAL", "Азербайджанские авиалинии", "AHY"]


def test_suggest_variants_maps_numbers_and_keeps_empty_answers():
    client = FakeClaude([{"results": [{"n": 1, "variants": ["Azerbaijan Airlines", "АЗАЛ"]}, {"n": 9, "variants": ["x y"]}]}])
    assert keyword_variants_ai.suggest_variants(client, ["AZAL", "təhsil"]) == {
        "AZAL": ["Azerbaijan Airlines", "АЗАЛ"],
        "təhsil": [],
    }
    assert "1. AZAL\n2. təhsil" in client.requests[0]["messages"][0]["content"]


def test_failed_batch_is_left_out_to_be_asked_again():
    client = FakeClaude([RuntimeError("overloaded")])
    assert keyword_variants_ai.suggest_variants(client, ["AZAL"]) == {}


def test_alias_match_reports_the_customer_keyword(sm, monkeypatch):
    monkeypatch.setattr(sm, "get_user_telegram_chat_id", lambda user_id: "chat")
    cache = [row("k1", "Azərbaycan Hava Yolları", aliases=["Azerbaijan Airlines", "Азербайджанские авиалинии"])]
    english = sm.find_matching_user_monitors("Azerbaijan Airlines resumes Baku-London flights", cache)
    russian = sm.find_matching_user_monitors("Азербайджанские авиалинии открыли новый рейс", cache)
    assert [match["keyword"] for match in english] == ["Azərbaycan Hava Yolları"]
    assert [match["keyword"] for match in russian] == ["Azərbaycan Hava Yolları"]
    assert sm.find_matching_user_monitors("Turkish Airlines resumes flights", cache) == []


def test_alias_found_only_in_article_text_matches(sm):
    cache = [row("k1", "Azərbaycan Hava Yolları", aliases=["AZAL"])]
    item = {"link": "https://news.az/x", "rss_text": "Bu gün AZAL Bakı-London reysini bərpa etdiyini açıqlayıb."}
    matcher = sm.article_keyword_matcher("Reys bərpa olunur", item["rss_text"])
    assert sm.find_matching_user_monitors("Reys bərpa olunur", cache, matcher=matcher)


def test_signature_changes_when_aliases_change(sm):
    plain, with_alias = [row("k1", "AZAL")], [row("k1", "AZAL", aliases=["Azerbaijan Airlines"])]
    assert sm.keywords_signature(plain) != sm.keywords_signature(with_alias)


def test_variants_are_asked_once_per_distinct_keyword_and_saved(sm, monkeypatch):
    patches = []
    fake = FakeRequests({("PATCH", "monitor_keywords"): lambda kwargs: patches.append(kwargs) or FakeResponse(204)})
    monkeypatch.setattr(sm, "requests", fake)
    client = FakeClaude([{"results": [{"n": 1, "variants": ["Azerbaijan Airlines"]}, {"n": 2, "variants": []}]}])
    monkeypatch.setattr(sm, "competitor_ai_client", lambda: client)
    cache = [
        row("k1", "AZAL", user="u1"),
        row("k2", "azal", user="u2"),
        row("k3", "təhsil", user="u1"),
        row("k4", "BDU", suggestions=["BSU"]),
        {key: value for key, value in row("k5", "Nar").items() if key != "alias_suggestions"},
    ]
    sm.keyword_variants_if_needed(cache, now=datetime(2026, 11, 16, 12, 0, tzinfo=BAKU))

    assert len(client.requests) == 1
    assert "1. AZAL\n2. təhsil" in client.requests[0]["messages"][0]["content"]
    saved = sorted((p["params"]["id"], tuple(p["json"]["alias_suggestions"])) for p in patches)
    assert saved == [("in.(k1,k2)", ("Azerbaijan Airlines",)), ("in.(k3)", ())]

    # Rows still unsaved in the next cycle reuse the answers without a new call.
    sm.keyword_variants_if_needed([row("k6", "AZAL", user="u3")], now=datetime(2026, 11, 16, 12, 5, tzinfo=BAKU))
    assert len(client.requests) == 1
    assert patches[-1]["params"]["id"] == "in.(k6)"


def test_failed_call_waits_before_asking_again(sm, monkeypatch):
    monkeypatch.setattr(sm, "requests", FakeRequests({}))
    client = FakeClaude([RuntimeError("overloaded"), {"results": [{"n": 1, "variants": ["Azerbaijan Airlines"]}]}])
    monkeypatch.setattr(sm, "competitor_ai_client", lambda: client)
    cache = [row("k1", "AZAL")]
    sm.keyword_variants_if_needed(cache, now=datetime(2026, 11, 16, 12, 0, tzinfo=BAKU))
    sm.keyword_variants_if_needed(cache, now=datetime(2026, 11, 16, 12, 10, tzinfo=BAKU))
    assert len(client.requests) == 1


def test_no_api_key_means_no_calls(sm, monkeypatch):
    monkeypatch.setattr(sm, "requests", FakeRequests({}))
    monkeypatch.setattr(sm, "competitor_ai_client", lambda: None)
    sm.keyword_variants_if_needed([row("k1", "AZAL")], now=datetime(2026, 11, 16, 12, 0, tzinfo=BAKU))
