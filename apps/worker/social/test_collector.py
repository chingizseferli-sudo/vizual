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


def test_custom_minute_override_is_used_and_scheduled(col):
    rows = [keyword_row("BDU", USER_A), keyword_row("bdu", USER_B)]
    profiles = [
        {"user_id": USER_A, "plan_id": PLAN_PRO, "social_interval_minutes": 45},
        {"user_id": USER_B, "plan_id": PLAN_PRO, "social_interval_minutes": None},
    ]
    plans = [{"id": PLAN_PRO, "limits": {"social_interval_minutes": 1440}}]
    targets = col.keyword_intervals(rows, profiles, plans, 360)
    assert targets["bdu"]["interval"] == 45

    use(col, {("GET", "social_keyword_state"): FakeResponse(200, [
        {"keyword_fold": "bdu", "last_checked_at": (NOW - timedelta(minutes=44)).isoformat()},
    ])})
    assert col.due_keywords("facebook", targets, NOW) == []
    use(col, {("GET", "social_keyword_state"): FakeResponse(200, [
        {"keyword_fold": "bdu", "last_checked_at": (NOW - timedelta(minutes=46)).isoformat()},
    ])})
    assert col.due_keywords("facebook", targets, NOW) == ["bdu"]


def test_instagram_hashtag_keeps_azerbaijani_letters(col):
    assert col.instagram_hashtag("Azərişıq") == "azərişıq"
    assert col.instagram_hashtag("Bakı metrosu") == "bakımetrosu"
    assert col.instagram_hashtag("DİM") == "dim"


def base_routes(settings, cache, usage=None, social_ids=None):
    ids = [row["id"] for row in cache] if social_ids is None else social_ids
    return {
        ("GET", "social_settings"): FakeResponse(200, [settings]),
        ("POST", "social_keyword_ids_for_worker"): FakeResponse(200, [{"keyword_id": i} for i in ids]),
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
    assert len(state) == 1 and state[0]["platform"] == "facebook" and state[0]["keyword_fold"] == "bdu"
    assert state[0]["last_result_count"] == 3 and state[0]["last_error"] is None
    stats = state[0]["last_stats"]
    assert {k: stats[k] for k in col.STAT_KEYS} == {
        "raw": 3, "no_url": 0, "no_date": 0, "too_old": 1, "no_match": 1, "duplicate": 0,
        "stored": 1, "matched_users": 1, "alerted": 1}
    assert len(stats["samples"]) == 3 and stats["samples"][0]["url"].endswith("/1")
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


def test_only_keywords_chosen_for_social_are_searched(col):
    rows = [keyword_row("BDU", USER_A), keyword_row("AZAL", USER_B)]
    # USER_B did not pick AZAL for FB/IG (or their plan has no social keywords).
    fake = use(col, {**base_routes(FB_SETTINGS, rows, social_ids=["k-BDU-user-a"]), **apify_routes([])})
    col.run_tick(NOW)
    assert fake.find("POST", "runs")[0]["json"]["searchQueries"] == ["BDU"]


def test_missing_social_keyword_function_searches_nothing(col):
    routes = base_routes(FB_SETTINGS, [keyword_row("BDU", USER_A)])
    routes[("POST", "social_keyword_ids_for_worker")] = FakeResponse(404, {"code": "PGRST202"})
    fake = use(col, {**routes, **apify_routes([])})
    col.run_tick(NOW)
    assert not fake.find("POST", "runs")
    assert not fake.find("GET", "monitor_keywords")


def test_budget_exhausted_skips_provider(col):
    fake = use(col, {**base_routes(FB_SETTINGS, [keyword_row("BDU", USER_A)], usage={"usd": 20.0, "calls": 90})})
    col.run_tick(NOW)
    assert not fake.find("POST", "runs")
    assert not fake.find("POST", "social_keyword_state")


def test_disabled_platforms_make_no_calls(col):
    fake = use(col, {("GET", "social_settings"): FakeResponse(200, [{"facebook_enabled": False, "instagram_enabled": False}]),
                     ("POST", "bot_runtime_state"): FakeResponse(201, None)})
    col.run_tick(NOW)
    assert [c["name"] for c in fake.calls] == ["social_settings", "bot_runtime_state"]
    beat = fake.find("POST", "bot_runtime_state")[0]["json"]
    assert beat["key"] == "social_heartbeat"
    assert beat["value"] == {"at": NOW.isoformat(), "facebook_enabled": False, "instagram_enabled": False,
                             "instagram_accounts_enabled": False, "telegram_channels_enabled": False,
                             "apify_key": True, "socialfetch_key": True, "keywords": 0}


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


@pytest.mark.parametrize("keyword,text,expected", [
    ("Kapital Bank", "Kapital Bankın yeni kampaniyası", True),
    ("Kapital Bank", "#kapitalbank #baku", True),
    ("Kapital Bank", "#KapitalBankda endirim", True),
    ("Kapital Bank", "kapital-bank xəbərləri", True),
    ("Kapital Bank", "Bankın kapitalı artdı", False),
    ("Azərişıq", "AZƏRİŞIQ işıqları söndürdü", True),
    ("Azərişıq", "#azerisiq", True),
    ("BDU", "#bdu tələbələri", True),
    ("BDU", "ABDU şirkəti", False),
    ("DİM", "dimensional design", False),
    ("Bakı metrosu", "#bakımetrosu dayandı", True),
])
def test_social_keyword_matcher(col, keyword, text, expected):
    assert col.social_keyword_matches(keyword, text) is expected


def ig_settings():
    return {"facebook_enabled": False, "instagram_enabled": True, "default_interval_minutes": 360, "monthly_budget_usd": None}


def ig_media(caption, created=True):
    item = {"id": "ig1", "url": "https://www.instagram.com/p/ig1", "caption": caption, "owner": {"handle": "baku"}}
    if created:
        item["createdAt"] = (NOW - timedelta(hours=1)).isoformat()
    return {"meta": {"creditsCharged": 1}, "data": {"lookupStatus": "found", "media": [item]}}


def test_instagram_hashtag_post_matches_its_keyword_without_caption_text(col):
    # The hashtag was in a comment; the caption does not repeat it.
    fake = use(col, {**base_routes(ig_settings(), [keyword_row("Kapital Bank", USER_A)]),
                     ("GET", "media"): FakeResponse(200, ig_media("Yeni filial açıldı!", created=False)),
                     ("POST", "monitored_items"): FakeResponse(201, [{"id": "item-ig"}])})
    col.run_tick(NOW)
    assert fake.find("POST", "monitor_matches")[0]["json"]["matched_keyword"] == "Kapital Bank"
    assert len(fake.find("POST", "sendMessage")) == 1
    stats = fake.find("POST", "social_keyword_state")[0]["json"][0]["last_stats"]
    assert stats["stored"] == 1 and stats["no_date"] == 0


def test_facebook_suffix_and_hashtag_match_multiword_keyword(col):
    items = [fb_item("1", "Kapital Bankın yeni tətbiqi", 1, query="Kapital Bank"),
             fb_item("2", "#kapitalbank endirim", 1, query="Kapital Bank"),
             fb_item("3", "Tamam başqa mövzu", 1, query="Kapital Bank")]
    ids = iter(["item-1", "item-2"])
    fake = use(col, {**base_routes(FB_SETTINGS, [keyword_row("Kapital Bank", USER_A)]), **apify_routes(items),
                     ("POST", "monitored_items"): lambda kw: FakeResponse(201, [{"id": next(ids)}])})
    col.run_tick(NOW)
    assert len(fake.find("POST", "monitored_items")) == 2
    stats = fake.find("POST", "social_keyword_state")[0]["json"][0]["last_stats"]
    assert stats["stored"] == 2 and stats["no_match"] == 1


def test_social_post_does_not_reach_users_without_social(col):
    # USER_B tracks the same word but did not get it for FB/IG (plan or choice).
    rows = [keyword_row("BDU", USER_A), keyword_row("BDU", USER_B, chat="888")]
    fake = use(col, {**base_routes(FB_SETTINGS, rows, social_ids=["k-BDU-user-a"]),
                     **apify_routes([fb_item("1", "BDU xəbəri", 1)]),
                     ("POST", "monitored_items"): FakeResponse(201, [{"id": "item-1"}])})
    col.run_tick(NOW)
    assert [c["json"]["monitor_id"] for c in fake.find("POST", "monitor_matches")] == ["m-user-a"]
    assert [c["data"]["chat_id"] for c in fake.find("POST", "sendMessage")] == ["777"]


def test_state_is_written_without_stats_before_migration(col):
    calls = []

    def state(kw):
        calls.append(kw["json"])
        if "last_stats" in kw["json"][0]:
            return FakeResponse(400, {"message": "Could not find the 'last_stats' column"})
        return FakeResponse(201, None)

    fake = use(col, {**base_routes(FB_SETTINGS, [keyword_row("BDU", USER_A)]), **apify_routes([]),
                     ("POST", "social_keyword_state"): state})
    col.run_tick(NOW)
    assert len(calls) == 2 and "last_stats" not in calls[1][0]
    assert fake.find("POST", "runs")


# Watched Instagram pages and Telegram channels ------------------------------------------

TG_HTML = """
<html><body>
<div class="tgme_channel_info_header_title"><span dir="auto">APA xəbər</span></div>
<div class="tgme_widget_message_wrap"><div class="tgme_widget_message js-widget_message" data-post="apa_az/101">
  <div class="tgme_widget_message_text js-message_text" dir="auto">Kapital Bankın yeni filialı açıldı</div>
  <a class="tgme_widget_message_date" href="https://t.me/apa_az/101"><time datetime="{fresh}" class="time">10:00</time></a>
</div></div>
<div class="tgme_widget_message_wrap"><div class="tgme_widget_message js-widget_message" data-post="apa_az/100">
  <div class="tgme_widget_message_text js-message_text" dir="auto">Kapital Bank köhnə xəbər</div>
  <a class="tgme_widget_message_date" href="https://t.me/apa_az/100"><time datetime="{old}" class="time">09:00</time></a>
</div></div>
<div class="tgme_widget_message_wrap"><div class="tgme_widget_message js-widget_message" data-post="apa_az/99">
  <div class="tgme_widget_message_text js-message_text" dir="auto">Hava proqnozu</div>
  <a class="tgme_widget_message_date" href="https://t.me/apa_az/99"><time datetime="{fresh}" class="time">08:00</time></a>
</div></div>
</body></html>
""".replace("{fresh}", (NOW - timedelta(hours=1)).isoformat()).replace("{old}", (NOW - timedelta(days=5)).isoformat())


def test_parse_telegram_preview(col):
    posts, title = col.parse_telegram_preview(TG_HTML, "apa_az")
    assert title == "APA xəbər"
    assert [p["url"] for p in posts] == ["https://t.me/apa_az/101", "https://t.me/apa_az/100", "https://t.me/apa_az/99"]
    assert posts[0]["text"] == "Kapital Bankın yeni filialı açıldı"
    assert posts[0]["published_at"] == NOW - timedelta(hours=1)
    assert posts[0]["external_id"] == "apa_az/101" and posts[0]["author"] == "APA xəbər"


def account_routes(settings, cache, accounts, social_ids=None):
    routes = base_routes(settings, cache, social_ids=social_ids)
    routes[("GET", "sources")] = FakeResponse(200, [
        {"id": "src-fb", "base_url": "https://www.facebook.com"},
        {"id": "src-ig", "base_url": "https://www.instagram.com"},
        {"id": "src-tg", "base_url": "https://t.me"},
    ])
    routes[("GET", "social_watched_accounts")] = lambda kw: FakeResponse(
        200, [a for a in accounts if kw["params"]["platform"] == f"eq.{a['platform']}"])
    routes[("PATCH", "social_watched_accounts")] = FakeResponse(204, None)
    return routes


class HtmlResponse:
    status_code = 200

    def __init__(self, text):
        self.text = text


def fake_telegram(col, monkeypatch, html=TG_HTML):
    seen = []

    def fake_request(url, **_kwargs):
        seen.append(url)
        return HtmlResponse(html)

    monkeypatch.setattr(col.sm, "safe_request", fake_request)
    monkeypatch.setattr(col.sm, "decode_response_text", lambda response: response.text)
    return seen


TG_SETTINGS = {"facebook_enabled": False, "instagram_enabled": False, "telegram_channels_enabled": True,
               "default_interval_minutes": 360, "monthly_budget_usd": None}


def test_telegram_channel_alerts_every_active_keyword_owner(col, monkeypatch):
    seen = fake_telegram(col, monkeypatch)
    stored = []

    def insert_item(kwargs):
        stored.append(kwargs["json"])
        return FakeResponse(201, [{"id": f"item-{len(stored)}"}])

    # Telegram is a news source: a keyword NOT picked for FB/IG still matches.
    fake = use(col, {**account_routes(TG_SETTINGS, [keyword_row("Kapital Bank", USER_A)],
                                      [{"id": "acc-1", "platform": "telegram", "handle": "apa_az"}], social_ids=[]),
                     ("POST", "monitored_items"): insert_item})
    col.run_tick(NOW)
    assert seen == ["https://t.me/s/apa_az"]
    assert len(stored) == 1
    assert stored[0]["source_id"] == "src-tg" and stored[0]["url"] == "https://t.me/apa_az/101"
    assert stored[0]["item_hash"] == "telegram:apa_az/101"
    sends = fake.find("POST", "sendMessage")
    assert len(sends) == 1 and "Telegram" in sends[0]["data"]["text"] and "https://t.me/apa_az/101" in sends[0]["data"]["text"]
    state = fake.find("PATCH", "social_watched_accounts")[0]
    assert state["params"] == {"id": "eq.acc-1"}
    stats = state["json"]["last_stats"]
    assert {k: stats[k] for k in ("raw", "too_old", "no_match", "stored", "alerted")} == {
        "raw": 3, "too_old": 1, "no_match": 1, "stored": 1, "alerted": 1}
    assert state["json"]["last_error"] is None and state["json"]["last_post_count"] == 3
    # Telegram needs no FB/IG keyword list and no provider.
    assert not fake.find("POST", "social_keyword_ids_for_worker")


def test_telegram_channel_not_due_is_skipped(col, monkeypatch):
    seen = fake_telegram(col, monkeypatch)
    fresh = (NOW - timedelta(minutes=5)).isoformat()
    use(col, account_routes(TG_SETTINGS, [keyword_row("Kapital Bank", USER_A)],
                            [{"id": "acc-1", "platform": "telegram", "handle": "apa_az", "last_checked_at": fresh}]))
    col.run_tick(NOW)
    assert seen == []


def test_telegram_without_preview_reports_error(col, monkeypatch):
    fake_telegram(col, monkeypatch, html="<html><body>no posts</body></html>")
    fake = use(col, account_routes(TG_SETTINGS, [keyword_row("Kapital Bank", USER_A)],
                                   [{"id": "acc-1", "platform": "telegram", "handle": "wrongname"}]))
    col.run_tick(NOW)
    assert fake.find("PATCH", "social_watched_accounts")[0]["json"]["last_error"] == "telegram:no_preview"


IG_PAGE_SETTINGS = {"facebook_enabled": False, "instagram_enabled": False, "instagram_accounts_enabled": True,
                    "default_interval_minutes": 360, "monthly_budget_usd": 50}


def ig_profile_media(*items):
    return {"meta": {"creditsCharged": 1}, "data": {"lookupStatus": "found", "media": list(items)}}


def test_instagram_page_matches_caption_without_hashtag(col):
    media = ig_profile_media(
        {"id": "p1", "url": "https://www.instagram.com/p/p1/", "caption": "Bu gün Kapital Bankın prezentasiyası oldu",
         "createdAt": (NOW - timedelta(hours=2)).isoformat(), "owner": {"handle": "report.az"}},
        {"id": "p2", "url": "https://www.instagram.com/p/p2/", "caption": "İdman xəbərləri",
         "createdAt": (NOW - timedelta(hours=2)).isoformat(), "owner": {"handle": "report.az"}},
        {"id": "p3", "url": "https://www.instagram.com/p/p3/", "caption": "Kapital Bank, sabitlənmiş köhnə post",
         "createdAt": (NOW - timedelta(days=40)).isoformat(), "owner": {"handle": "report.az"}},
    )
    stored = []

    def insert_item(kwargs):
        stored.append(kwargs["json"])
        return FakeResponse(201, [{"id": "item-p1"}])

    fake = use(col, {**account_routes(IG_PAGE_SETTINGS, [keyword_row("Kapital Bank", USER_A)],
                                      [{"id": "acc-ig", "platform": "instagram", "handle": "report.az"}]),
                     ("GET", "media"): FakeResponse(200, media),
                     ("POST", "monitored_items"): insert_item})
    col.run_tick(NOW)
    call = fake.find("GET", "media")[0]
    assert "/profiles/report.az/media" in call["url"] and call["params"] == {"tab": "posts"}
    assert call["headers"]["x-api-key"] == "sf-key"
    assert len(stored) == 1 and stored[0]["url"] == "https://www.instagram.com/p/p1/"
    # Same hash as a hashtag result for the same post, so it is stored once.
    assert stored[0]["item_hash"] == "instagram:p1" and stored[0]["source_id"] == "src-ig"
    assert len(fake.find("POST", "sendMessage")) == 1
    usage = [c for c in fake.find("POST", "bot_runtime_state") if c["json"]["key"].startswith("social_usage_")]
    assert usage[0]["json"]["value"]["calls"] == 1


def test_instagram_page_post_does_not_reach_users_without_social(col):
    media = ig_profile_media(
        {"id": "p1", "url": "https://www.instagram.com/p/p1/", "caption": "Kapital Bank xəbəri",
         "createdAt": (NOW - timedelta(hours=1)).isoformat(), "owner": {"handle": "report.az"}})
    rows = [keyword_row("Kapital Bank", USER_A), keyword_row("Kapital Bank", USER_B, chat="888")]
    fake = use(col, {**account_routes(IG_PAGE_SETTINGS, rows, [{"id": "acc-ig", "platform": "instagram", "handle": "report.az"}],
                                      social_ids=["k-Kapital Bank-user-a"]),
                     ("GET", "media"): FakeResponse(200, media),
                     ("POST", "monitored_items"): FakeResponse(201, [{"id": "item-p1"}])})
    col.run_tick(NOW)
    chats = [c["data"]["chat_id"] for c in fake.find("POST", "sendMessage")]
    assert chats == ["777"]


def test_private_instagram_page_reports_error(col):
    media = {"meta": {"creditsCharged": 1}, "data": {"lookupStatus": "private", "media": []}}
    fake = use(col, {**account_routes(IG_PAGE_SETTINGS, [keyword_row("Kapital Bank", USER_A)],
                                      [{"id": "acc-ig", "platform": "instagram", "handle": "closed.page"}]),
                     ("GET", "media"): FakeResponse(200, media)})
    col.run_tick(NOW)
    assert fake.find("PATCH", "social_watched_accounts")[0]["json"]["last_error"] == "profile:private"


def test_instagram_pages_without_key_make_no_calls(col):
    col.SOCIALFETCH_API_KEY = ""
    fake = use(col, {("GET", "social_settings"): FakeResponse(200, [IG_PAGE_SETTINGS]),
                     ("POST", "bot_runtime_state"): FakeResponse(201, None)})
    col.run_tick(NOW)
    assert [c["name"] for c in fake.calls] == ["social_settings", "bot_runtime_state"]
