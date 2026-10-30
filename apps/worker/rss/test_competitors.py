import importlib.util
import json
import os
from datetime import date, datetime
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest

import competitor_ai


def load_site_monitor():
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "site_monitor.py")
    spec = importlib.util.spec_from_file_location("site_monitor_competitors", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FakeResponse:
    def __init__(self, status_code, payload=None):
        self.status_code = status_code
        self._payload = payload
        self.text = json.dumps(payload)

    def json(self):
        return self._payload


class FakeRequests:
    """Routes calls by (METHOD, last URL segment)."""

    def __init__(self, routes):
        self.routes = routes
        self.calls = []

    def _call(self, method, url, **kwargs):
        name = url.rstrip("/").rsplit("/", 1)[-1]
        self.calls.append({"method": method, "name": name, **kwargs})
        handler = self.routes.get((method, name))
        if handler is None:
            raise AssertionError(f"unexpected {method} {name}")
        return handler(kwargs) if callable(handler) else handler

    def get(self, url, **kwargs):
        return self._call("GET", url, **kwargs)

    def post(self, url, **kwargs):
        return self._call("POST", url, **kwargs)

    def patch(self, url, **kwargs):
        return self._call("PATCH", url, **kwargs)

    def find(self, method, name):
        return [call for call in self.calls if call["method"] == method and call["name"] == name]


class FakeClaude:
    """Stands in for anthropic.Anthropic: answers each messages.create with the next reply."""

    def __init__(self, replies):
        self.replies = list(replies)
        self.requests = []
        self.messages = SimpleNamespace(create=self.create)

    def create(self, **kwargs):
        self.requests.append(kwargs)
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        if isinstance(reply, str):
            return SimpleNamespace(stop_reason=reply, content=[])
        return SimpleNamespace(
            stop_reason="end_turn",
            content=[SimpleNamespace(type="thinking", thinking=""), SimpleNamespace(type="text", text=json.dumps(reply))],
        )


USER_ID = "11111111-2222-3333-4444-555555555555"
BAKCELL = "c0000000-0000-0000-0000-000000000001"
NAR = "c0000000-0000-0000-0000-000000000002"
KEYWORDS = [
    {"competitor_id": BAKCELL, "user_id": USER_ID, "keyword": "Bakcell"},
    {"competitor_id": BAKCELL, "user_id": USER_ID, "keyword": "Bakcell LLC"},
    {"competitor_id": NAR, "user_id": USER_ID, "keyword": "Nar"},
]


@pytest.fixture()
def sm():
    module = load_site_monitor()
    module.SUPABASE_URL = "https://example.supabase.co"
    module.SUPABASE_SERVICE_ROLE_KEY = "service"
    return module


def test_competitor_hits_one_per_competitor_and_short_names_whole_word(sm):
    hits = sm.find_competitor_hits("Bakcell LLC yeni tarif təqdim etdi", KEYWORDS)
    assert hits == [{"competitor_id": BAKCELL, "matched_keyword": "Bakcell"}]
    assert sm.find_competitor_hits("Narıngül festivalı başladı", KEYWORDS) == []
    assert [hit["competitor_id"] for hit in sm.find_competitor_hits("Nar və Bakcell şəbəkəsi", KEYWORDS)] == [BAKCELL, NAR]
    assert sm.find_competitor_hits("Bakcell", None) == []


def test_signature_changes_with_competitors_and_stays_empty_when_unknown(sm):
    monitor_cache = [{"id": "k1", "keyword": "ABB", "match_type": "contains", "monitor_id": "m1"}]
    plain = sm.combined_keywords_signature(monitor_cache, [])
    assert plain == sm.keywords_signature(monitor_cache)
    with_competitors = sm.combined_keywords_signature(monitor_cache, KEYWORDS)
    assert with_competitors and with_competitors != plain
    assert sm.combined_keywords_signature(None, KEYWORDS) == ""


def test_competitor_only_verdict_expires_when_keywords_change(sm):
    sm.remember_article_verdict("https://x.az/1", "competitor_only", "sig-a")
    assert sm.cached_article_verdict("https://x.az/1", "sig-a") == "competitor_only"
    assert sm.cached_article_verdict("https://x.az/1", "sig-b") == ""


def test_classify_headlines_batches_and_marks_skipped(monkeypatch):
    monkeypatch.setattr(competitor_ai, "CLASSIFY_BATCH_SIZE", 2)
    items = [{"id": f"i{n}", "title": f"Başlıq {n}"} for n in range(1, 6)]
    client = FakeClaude([
        {"results": [{"n": 1, "sentiment": "positive", "topic": "tarif"}, {"n": 9, "sentiment": "negative", "topic": "x"}]},
        RuntimeError("overloaded"),
        {"results": [{"n": 1, "sentiment": "negative", "topic": "  şəbəkə nasazlığı  "}]},
    ])
    labels = competitor_ai.classify_headlines(client, items)
    assert labels == {
        "i1": {"sentiment": "positive", "topic": "tarif"},
        "i2": {"sentiment": None, "topic": None},
        "i5": {"sentiment": "negative", "topic": "şəbəkə nasazlığı"},
    }
    request = client.requests[0]
    assert request["model"] == "claude-haiku-5-5"
    assert request["output_config"]["effort"] == "low"
    assert request["output_config"]["format"]["type"] == "json_schema"
    assert "1. Başlıq 1" in request["messages"][0]["content"]


def test_refusal_or_cut_off_reply_leaves_batch_for_next_run():
    client = FakeClaude(["refusal"])
    assert competitor_ai.classify_headlines(client, [{"id": "i1", "title": "x"}]) == {}


def test_make_client_needs_api_key(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    assert competitor_ai.make_client() is None


def test_classify_pending_sentiment_saves_labels(sm):
    fake = FakeRequests({
        ("POST", "items_needing_sentiment"): FakeResponse(200, [{"id": "i1", "title": "Bakcell mükafat aldı"}]),
        ("PATCH", "monitored_items"): FakeResponse(204, None),
    })
    sm.requests = fake
    client = FakeClaude([{"results": [{"n": 1, "sentiment": "positive", "topic": "mükafat"}]}])
    assert sm.classify_pending_sentiment(client) == 1
    patch = fake.find("PATCH", "monitored_items")[0]
    assert patch["params"] == {"id": "eq.i1"}
    assert patch["json"]["ai_sentiment"] == "positive" and patch["json"]["ai_topic"] == "mükafat"
    assert patch["json"]["ai_classified_at"]


def stats_rows(mentions):
    return [
        {"kind": "own", "competitor_id": None, "name": None, "mentions": mentions, "positive": 1, "neutral": 0, "negative": 0},
        {"kind": "competitor", "competitor_id": BAKCELL, "name": "Bakcell", "mentions": mentions, "positive": 0, "neutral": 1, "negative": 1},
    ]


def summary_routes(stats, existing=()):
    return {
        ("GET", "competitor_insights"): FakeResponse(200, [{"user_id": user} for user in existing]),
        ("POST", "competitor_stats"): FakeResponse(200, stats),
        ("GET", "monitor_matches"): FakeResponse(200, [{"monitored_items": {"title": "ABB yeni filial açdı"}}]),
        ("GET", "competitor_matches"): FakeResponse(200, [{"monitored_items": {"title": "Bakcell şəbəkəsində nasazlıq"}}]),
        ("POST", "competitor_insights"): FakeResponse(201, None),
    }


def test_daily_summary_written_once_per_customer(sm):
    fake = FakeRequests(summary_routes(stats_rows(3), existing=["someone-else"]))
    sm.requests = fake
    client = FakeClaude([{"summary": "Bakcell bu həftə daha çox xəbərdə keçir."}])
    assert sm.write_competitor_summaries(client, [USER_ID, "someone-else"], date(2026, 10, 22)) == 1
    prompt = client.requests[0]["messages"][0]["content"]
    assert "Bakcell: 3 xəbər" in prompt and "Bakcell şəbəkəsində nasazlıq" in prompt and "ABB yeni filial açdı" in prompt
    saved = fake.find("POST", "competitor_insights")[0]["json"]
    assert saved["user_id"] == USER_ID and saved["insight_date"] == "2026-10-22"
    assert saved["summary"].startswith("Bakcell") and saved["model"] == "claude-haiku-5-5"
    assert fake.find("GET", "monitor_matches")[0]["params"]["user_monitors.user_id"] == f"eq.{USER_ID}"


def test_no_news_saves_stats_without_calling_ai(sm):
    fake = FakeRequests(summary_routes(stats_rows(0)))
    sm.requests = fake
    client = FakeClaude([])
    assert sm.write_competitor_summaries(client, [USER_ID], date(2026, 10, 22)) == 1
    saved = fake.find("POST", "competitor_insights")[0]["json"]
    assert saved["summary"] is None and saved["model"] is None
    assert not client.requests


def test_failed_summary_is_not_saved(sm):
    fake = FakeRequests(summary_routes(stats_rows(2)))
    sm.requests = fake
    client = FakeClaude([RuntimeError("down")])
    assert sm.write_competitor_summaries(client, [USER_ID], date(2026, 10, 22)) == 0
    assert not fake.find("POST", "competitor_insights")


def test_ai_skipped_without_api_key_or_competitors(sm, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    fake = FakeRequests({})
    sm.requests = fake
    sm.competitor_ai_if_needed(KEYWORDS)
    sm.competitor_ai_if_needed([])
    assert fake.calls == []


def test_ai_schedule_labels_every_30_minutes_and_summarises_after_nine(sm):
    calls = []
    sm.COMPETITOR_AI.update(client=object(), client_ready=True)
    sm.classify_pending_sentiment = lambda client: calls.append("label")
    sm.write_competitor_summaries = lambda client, users, today: calls.append(("summary", tuple(users), today))
    baku = ZoneInfo("Asia/Baku")
    sm.competitor_ai_if_needed(KEYWORDS, now=datetime(2026, 10, 22, 8, 0, tzinfo=baku))
    sm.competitor_ai_if_needed(KEYWORDS, now=datetime(2026, 10, 22, 8, 20, tzinfo=baku))
    sm.competitor_ai_if_needed(KEYWORDS, now=datetime(2026, 10, 22, 9, 5, tzinfo=baku))
    sm.competitor_ai_if_needed(KEYWORDS, now=datetime(2026, 10, 22, 9, 10, tzinfo=baku))
    assert calls == ["label", "label", ("summary", (USER_ID,), date(2026, 10, 22))]


def test_competitor_only_article_is_saved_without_telegram(sm, monkeypatch):
    item = {"title": "Bakcell yeni tarif təqdim etdi", "link": "https://news.az/bakcell-tarif", "source": "news.az"}
    saved = []
    monkeypatch.setattr(sm, "fetch_site", lambda site, patterns: [dict(item)])
    monkeypatch.setattr(sm, "choose_best_article_title_info", lambda title, link, source_domain=None, from_feed=False: {"title": title})
    monkeypatch.setattr(sm, "exists", lambda link, title=None: False)
    monkeypatch.setattr(sm, "extract_publish_time_from_article", lambda link, return_source=False: ("now", "meta"))
    monkeypatch.setattr(sm, "evaluate_publish_freshness", lambda *args, **kwargs: ("2026-10-22 10:00", "fresh"))
    monkeypatch.setattr(sm, "title_rejection_reason", lambda *args, **kwargs: "")
    monkeypatch.setattr(sm, "find_matching_user_monitors", lambda title, cache: [])
    monkeypatch.setattr(sm, "save_to_vizual_monitor", lambda site, item, title, published: "item-1")
    monkeypatch.setattr(sm, "save_competitor_matches", lambda item_id, hits: saved.append((item_id, hits)))
    monkeypatch.setattr(sm, "match_user_monitors", lambda *args: pytest.fail("no customer match expected"))
    monkeypatch.setattr(sm, "send_telegram", lambda *args, **kwargs: pytest.fail("no Telegram for competitors"))
    monkeypatch.setattr(sm, "update_source_health", lambda site, result: None)
    site = {"name": "News", "url": "https://news.az", "id": "s1"}
    result = sm.process_site(1, 1, site, {}, [], KEYWORDS)
    assert result["reason"] == "competitor_only"
    assert saved == [("item-1", [{"competitor_id": BAKCELL, "matched_keyword": "Bakcell"}])]
