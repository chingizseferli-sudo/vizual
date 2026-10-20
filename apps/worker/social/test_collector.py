import importlib.util
import os
from datetime import datetime, timedelta, timezone

import pytest


def load_collector():
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "collector.py")
    spec = importlib.util.spec_from_file_location("social_collector_under_test", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FakeResponse:
    def __init__(self, status_code, payload=None):
        self.status_code = status_code
        self._payload = payload
        self.text = str(payload)
        self.headers = {}

    def json(self):
        return self._payload


class FakeRequests:
    """Routes calls by (METHOD, last URL path segment)."""

    def __init__(self, routes):
        self.routes = routes
        self.calls = []

    def _call(self, method, url, **kwargs):
        name = url.split("?", 1)[0].rstrip("/").rsplit("/", 1)[-1]
        self.calls.append({"method": method, "name": name, "url": url, **kwargs})
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
        return [c for c in self.calls if c["method"] == method and c["name"] == name]


NOW = datetime(2026, 10, 20, 9, 0, tzinfo=timezone.utc)
USER_A, USER_B = "user-a", "user-b"
PLAN_PRO = "plan-pro"


@pytest.fixture()
def col(monkeypatch):
    module = load_collector()
    module.APIFY_TOKEN = "apify-token"
    module.SOCIALFETCH_API_KEY = "sf-key"
    sm = module.sm
    sm.BOT_TOKEN = "123:abc"
    sm.SUPABASE_URL = "https://example.supabase.co"
    sm.SUPABASE_SERVICE_ROLE_KEY = "service"
    sm.DISABLE_TELEGRAM_SEND = False
    sm.BOT_SETTINGS_CACHE.update({"paused": False, "fetched_at": 0.0})
    monkeypatch.setattr(module.time, "sleep", lambda _s: None)
    monkeypatch.setattr(sm.time, "sleep", lambda _s: None)
    return module


def use(col, routes):
    fake = FakeRequests(routes)
    col.requests = fake
    col.sm.requests = fake
    return fake


def keyword_row(keyword, user_id, status="active", chat="777"):
    return {
        "id": f"k-{keyword}-{user_id}",
        "keyword": keyword,
        "monitor_id": f"m-{user_id}",
        "user_monitors": {"id": f"m-{user_id}", "name": f"Monitor {user_id}", "user_id": user_id,
                          "status": status, "notify_telegram": True, "telegram_chat_id": chat},
    }


def test_interval_is_shortest_of_override_plan_and_default(col):
    rows = [keyword_row("BDU", USER_A), keyword_row("bdu", USER_B), keyword_row("AZAL", USER_A),
            keyword_row("Off", USER_B, status="inactive")]
    profiles = [
        {"user_id": USER_A, "plan_id": None, "social_interval_minutes": None},
        {"user_id": USER_B, "plan_id": PLAN_PRO, "social_interval_minutes": None},
    ]
    plans = [{"id": PLAN_PRO, "limits": {"social_interval_minutes": 180}}]
    targets = col.keyword_intervals(rows, profiles, plans, 360)
    assert targets == {"bdu": {"keyword": "BDU", "interval": 180}, "azal": {"keyword": "AZAL", "interval": 360}}

    profiles[0]["social_interval_minutes"] = 60
    assert col.keyword_intervals(rows, profiles, plans, 360)["bdu"]["interval"] == 60


def test_due_keywords_respects_last_check(col):
    use(col, {("GET", "social_keyword_state"): FakeResponse(200, [
        {"keyword_fold": "bdu", "last_checked_at": (NOW - timedelta(minutes=30)).isoformat()},
        {"keyword_fold": "azal", "last_checked_at": (NOW - timedelta(minutes=400)).isoformat()},
    ])})
    targets = {"bdu": {"keyword": "BDU", "interval": 60}, "azal": {"keyword": "AZAL", "interval": 360},
               "socar": {"keyword": "SOCAR", "interval": 360}}
    assert col.due_keywords("facebook", targets, NOW) == ["azal", "socar"]


def test_instagram_hashtag_keeps_azerbaijani_letters(col):
    assert col.instagram_hashtag("Azərişıq") == "azərişıq"
    assert col.instagram_hashtag("Bakı metrosu") == "bakımetrosu"
    assert col.instagram_hashtag("DİM") == "dim"


def base_routes(settings, cache, usage=None):
    return {
        ("GET", "social_settings"): FakeResponse(200, [settings]),
        ("GET", "monitor_keywords"): FakeResponse(200, cache),
        # One response serves both the interval read and the chat lookup (profile is the source of truth);
        # the inactive-owner read (status=neq.active) finds nobody.
        ("GET", "user_profiles"): lambda kw: FakeResponse(200, [] if kw["params"].get("status") == "neq.active" else [
            {"user_id": USER_A, "plan_id": None, "social_interval_minutes": None, "telegram_chat_id": "777"}]),
        ("GET", "subscription_plans"): FakeResponse(200, []),
        ("GET", "sources"): FakeResponse(200, [
            {"id": "src-fb", "base_url": "https://www.facebook.com"},
            {"id": "src-ig", "base_url": "https://www.instagram.com"},
        ]),
        ("GET", "social_keyword_state"): FakeResponse(200, []),
        ("POST", "social_keyword_state"): FakeResponse(201, None),
        ("GET", "bot_runtime_state"): FakeResponse(200, [{"value": usage}] if usage else []),
        ("POST", "bot_runtime_state"): FakeResponse(201, None),
        ("POST", "monitor_matches"): FakeResponse(201, [{"id": "match-1"}]),
        ("GET", "monitor_alerts"): FakeResponse(200, []),
        ("POST", "monitor_alerts"): FakeResponse(201, [{"id": "alert-1"}]),
        ("GET", "bot_settings"): FakeResponse(200, [{"notifications_paused": False}]),
        ("POST", "sendMessage"): FakeResponse(200, {"ok": True}),
    }


FB_SETTINGS = {"facebook_enabled": True, "instagram_enabled": False, "default_interval_minutes": 360, "monthly_budget_usd": 20}


def apify_routes(items):
    return {
        ("POST", "runs"): FakeResponse(201, {"data": {"id": "run-1", "status": "RUNNING"}}),
        ("GET", "run-1"): FakeResponse(200, {"data": {"id": "run-1", "status": "SUCCEEDED",
                                                       "defaultDatasetId": "ds-1", "usageTotalUsd": 0.12}}),
        ("GET", "items"): FakeResponse(200, items),
    }


def fb_item(post_id, text, hours_ago, query="BDU"):
    return {"post_id": post_id, "url": f"https://www.facebook.com/p/{post_id}", "message": text,
            "author": {"name": "Page"}, "search_query": query,
            "published_at": (NOW - timedelta(hours=hours_ago)).isoformat()}


def test_facebook_tick_alerts_once_for_fresh_whole_word_match(col):
    items = [
        fb_item("1", "BDU-da qəbul imtahanı başladı", 2),
        fb_item("2", "ABDU şirkəti yeni ofis açdı", 2),
        fb_item("3", "BDU köhnə xəbər", 100),
    ]
    stored = []

    def insert_item(kwargs):
        stored.append(kwargs["json"])
        return FakeResponse(201, [{"id": "item-1"}])

    fake = use(col, {**base_routes(FB_SETTINGS, [keyword_row("BDU", USER_A)]), **apify_routes(items),
                     ("POST", "monitored_items"): insert_item})
    col.run_tick(NOW)

    run_input = fake.find("POST", "runs")[0]["json"]
    assert run_input["searchQueries"] == ["BDU"]
    assert run_input["monitorMode"] is True and run_input["sortBy"] == "recent"
    assert fake.find("POST", "runs")[0]["headers"]["Authorization"] == "Bearer apify-token"

    assert len(stored) == 1
    assert stored[0]["source_id"] == "src-fb"
    assert stored[0]["item_hash"] == "facebook:1"
    assert stored[0]["title"].startswith("Page: BDU-da")
    sends = fake.find("POST", "sendMessage")
    assert len(sends) == 1
    assert sends[0]["data"]["chat_id"] == "777"
    assert "Facebook" in sends[0]["data"]["text"]

    state = fake.find("POST", "social_keyword_state")[0]["json"]
    assert state == [{"platform": "facebook", "keyword_fold": "bdu", "last_checked_at": state[0]["last_checked_at"],
                      "last_result_count": 3, "last_error": None}]
    usage = [c for c in fake.find("POST", "bot_runtime_state") if c["json"]["key"].startswith("social_usage_")]
    assert usage[0]["json"]["value"] == {"usd": 0.12, "calls": 1}


def test_already_stored_post_is_not_alerted_again(col):
    fake = use(col, {**base_routes(FB_SETTINGS, [keyword_row("BDU", USER_A)]),
                     **apify_routes([fb_item("1", "BDU xəbəri", 1)]),
                     ("POST", "monitored_items"): FakeResponse(201, [])})
    col.run_tick(NOW)
    assert fake.find("POST", "monitored_items")
    assert not fake.find("POST", "monitor_matches")
    assert not fake.find("POST", "sendMessage")


def test_keywords_of_inactive_accounts_are_not_searched(col):
    routes = base_routes(FB_SETTINGS, [keyword_row("BDU", USER_A), keyword_row("AZAL", USER_B)])
    profiles = routes[("GET", "user_profiles")]
    # USER_A's demo expired: only USER_B's keyword is paid for.
    routes[("GET", "user_profiles")] = lambda kw: (
        FakeResponse(200, [{"user_id": USER_A}]) if kw["params"].get("status") == "neq.active" else profiles(kw))
    fake = use(col, {**routes, **apify_routes([])})
    col.run_tick(NOW)
    assert fake.find("POST", "runs")[0]["json"]["searchQueries"] == ["AZAL"]


def test_budget_exhausted_skips_provider(col):
    fake = use(col, {**base_routes(FB_SETTINGS, [keyword_row("BDU", USER_A)], usage={"usd": 20.0, "calls": 90})})
    col.run_tick(NOW)
    assert not fake.find("POST", "runs")
    assert not fake.find("POST", "social_keyword_state")


def test_disabled_platforms_make_no_calls(col):
    fake = use(col, {("GET", "social_settings"): FakeResponse(200, [{"facebook_enabled": False, "instagram_enabled": False}])})
    col.run_tick(NOW)
    assert [c["name"] for c in fake.calls] == ["social_settings"]


def test_instagram_searches_each_keyword_hashtag(col):
    settings = {"facebook_enabled": False, "instagram_enabled": True, "default_interval_minutes": 360, "monthly_budget_usd": None}
    media = {"meta": {"creditsCharged": 1}, "data": {"lookupStatus": "found", "media": [
        {"id": "ig1", "url": "https://www.instagram.com/p/ig1", "caption": "Azərişıq işıqları söndürdü",
         "createdAt": (NOW - timedelta(hours=1)).isoformat(), "owner": {"handle": "baku"}},
    ]}}
    fake = use(col, {**base_routes(settings, [keyword_row("Azərişıq", USER_A)]),
                     ("GET", "media"): FakeResponse(200, media),
                     ("POST", "monitored_items"): FakeResponse(201, [{"id": "item-ig"}])})
    col.run_tick(NOW)
    call = fake.find("GET", "media")[0]
    assert "/hashtags/" in call["url"] and call["params"] == {"tab": "recent"}
    assert call["headers"]["x-api-key"] == "sf-key"
    assert fake.find("POST", "monitored_items")[0]["json"]["source_id"] == "src-ig"
    assert len(fake.find("POST", "sendMessage")) == 1
