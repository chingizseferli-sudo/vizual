import importlib.util
import os
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import pytest


def load_site_monitor():
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "site_monitor.py")
    spec = importlib.util.spec_from_file_location("site_monitor_bot_commands", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FakeResponse:
    def __init__(self, status_code, payload=None, text=None, headers=None):
        self.status_code = status_code
        self._payload = payload
        self.text = text if text is not None else str(payload)
        self.headers = headers or {}

    def json(self):
        return self._payload


class FakeRequests:
    """Routes calls by (METHOD, last URL segment). Handlers return a FakeResponse."""

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

    def sent_texts(self):
        return [call["data"]["text"] for call in self.calls if call["name"] == "sendMessage"]

    def find(self, method, name):
        return [call for call in self.calls if call["method"] == method and call["name"] == name]


TOKEN = "a" * 32
USER_ID = "11111111-2222-3333-4444-555555555555"
CHAT_ID = "777"


@pytest.fixture()
def sm(monkeypatch):
    module = load_site_monitor()
    module.BOT_TOKEN = "123:abc"
    module.CHAT_ID = ""
    module.SUPABASE_URL = "https://example.supabase.co"
    module.SUPABASE_SERVICE_ROLE_KEY = "service"
    module.DISABLE_TELEGRAM_SEND = False
    module.TELEGRAM_ALLOW_LEGACY_UUID_LINK = False
    module.TELEGRAM_OFFSET_FILE = os.devnull
    monkeypatch.setattr(module.time, "sleep", lambda _s: None)
    return module


def iso(delta_minutes):
    return (datetime.now(ZoneInfo("Asia/Baku")) + timedelta(minutes=delta_minutes)).isoformat()


def bot_routes(text, extra):
    routes = {
        ("GET", "getUpdates"): FakeResponse(200, {"result": [
            {"update_id": 41, "message": {"text": text, "chat": {"id": int(CHAT_ID)}}},
        ]}),
        ("POST", "sendMessage"): FakeResponse(200, {"ok": True}),
        ("GET", "bot_runtime_state"): FakeResponse(200, []),
        ("POST", "bot_runtime_state"): FakeResponse(201, []),
    }
    routes.update(extra)
    return routes


def run_updates(sm, text, extra):
    fake = FakeRequests(bot_routes(text, extra))
    sm.requests = fake
    sm.connect_telegram_users_from_updates()
    return fake


def link_routes(token_row, claim_rows=None):
    return {
        ("GET", "telegram_link_tokens"): FakeResponse(200, [token_row] if token_row else []),
        ("PATCH", "telegram_link_tokens"): FakeResponse(200, claim_rows if claim_rows is not None else [token_row]),
        ("POST", "user_profiles"): FakeResponse(201, []),
        ("PATCH", "user_monitors"): FakeResponse(204, None, text=""),
    }


def test_token_link_success(sm):
    row = {"user_id": USER_ID, "expires_at": iso(10), "used_at": None}
    fake = run_updates(sm, f"/start {TOKEN}", link_routes(row))

    claim = fake.find("PATCH", "telegram_link_tokens")[0]
    assert claim["params"]["used_at"] == "is.null"
    assert claim["params"]["expires_at"].startswith("gt.")
    assert claim["json"]["chat_id"] == CHAT_ID
    profile = fake.find("POST", "user_profiles")[0]
    assert profile["json"]["user_id"] == USER_ID
    assert profile["json"]["telegram_chat_id"] == CHAT_ID
    assert fake.sent_texts() == [sm.TELEGRAM_REPLY_LINKED]
    offset = [c for c in fake.find("POST", "bot_runtime_state") if c["json"]["key"] == "telegram_offset"]
    assert offset[0]["json"]["value"] == {"offset": 42}
    heartbeat = [c for c in fake.find("POST", "bot_runtime_state") if c["json"]["key"] == "telegram_heartbeat"]
    assert heartbeat[0]["json"]["value"]["last_poll_at"]
    assert heartbeat[0]["json"]["value"]["last_poll_ok_at"] == heartbeat[0]["json"]["value"]["last_poll_at"]


def test_token_link_expired(sm):
    row = {"user_id": USER_ID, "expires_at": iso(-1), "used_at": None}
    fake = run_updates(sm, f"/start {TOKEN}", link_routes(row))
    assert not fake.find("PATCH", "telegram_link_tokens")
    assert not fake.find("POST", "user_profiles")
    assert fake.sent_texts() == [sm.TELEGRAM_REPLY_LINK_EXPIRED]


def test_token_link_already_used(sm):
    row = {"user_id": USER_ID, "expires_at": iso(10), "used_at": iso(-2)}
    fake = run_updates(sm, f"/start {TOKEN}", link_routes(row))
    assert not fake.find("POST", "user_profiles")
    assert fake.sent_texts() == [sm.TELEGRAM_REPLY_LINK_USED]


def test_token_link_lost_race_is_rejected(sm):
    row = {"user_id": USER_ID, "expires_at": iso(10), "used_at": None}
    fake = run_updates(sm, f"/start {TOKEN}", link_routes(row, claim_rows=[]))
    assert not fake.find("POST", "user_profiles")
    assert fake.sent_texts() == [sm.TELEGRAM_REPLY_LINK_USED]


def test_legacy_uuid_rejected_by_default(sm):
    fake = run_updates(sm, f"/start {USER_ID}", {})
    assert not fake.find("GET", "telegram_link_tokens")
    assert fake.sent_texts() == [sm.TELEGRAM_REPLY_LINK_INVALID]


def test_legacy_uuid_allowed_with_flag(sm):
    sm.TELEGRAM_ALLOW_LEGACY_UUID_LINK = True
    fake = run_updates(sm, f"/start {USER_ID}", link_routes(None))
    assert fake.find("POST", "user_profiles")[0]["json"]["user_id"] == USER_ID
    assert fake.sent_texts() == [sm.TELEGRAM_REPLY_LINKED]


def test_stop_unlinks_chat(sm):
    sm.USER_TELEGRAM_CACHE[USER_ID] = CHAT_ID
    fake = run_updates(sm, "/stop", {
        ("GET", "user_profiles"): FakeResponse(200, [{"user_id": USER_ID}]),
        ("PATCH", "user_monitors"): FakeResponse(200, [{"id": "m1"}, {"id": "m2"}]),
        ("PATCH", "user_profiles"): FakeResponse(204, None, text=""),
    })
    monitors = fake.find("PATCH", "user_monitors")[0]
    assert monitors["params"]["telegram_chat_id"] == f"eq.{CHAT_ID}"
    assert monitors["json"] == {"notify_telegram": False}
    profile = fake.find("PATCH", "user_profiles")[0]
    assert profile["params"]["telegram_chat_id"] == f"eq.{CHAT_ID}"
    assert profile["json"]["telegram_chat_id"] is None
    assert USER_ID not in sm.USER_TELEGRAM_CACHE
    assert fake.sent_texts() == [sm.TELEGRAM_REPLY_STOPPED]


def test_status_reports_active_monitors(sm):
    fake = run_updates(sm, "/status", {
        ("GET", "user_profiles"): FakeResponse(200, [{"user_id": USER_ID}]),
        ("GET", "user_monitors"): FakeResponse(200, [{"id": "m1"}, {"id": "m2"}, {"id": "m3"}]),
    })
    assert fake.sent_texts() == ["Çat qoşulub. Aktiv monitor sayı: 3."]


def test_pause_blocks_alerts_but_not_command_replies(sm):
    fake = FakeRequests({
        ("GET", "bot_settings"): FakeResponse(200, [{"notifications_paused": True}]),
        ("POST", "sendMessage"): FakeResponse(200, {"ok": True}),
    })
    sm.requests = fake
    assert sm.send_telegram("alert", chat_id=CHAT_ID) is False
    assert sm.TELEGRAM_LAST_ERROR == "telegram_disabled"
    assert not fake.find("POST", "sendMessage")

    # Cached for 60 s: a second alert does not re-read bot_settings.
    assert sm.send_telegram("alert 2", chat_id=CHAT_ID) is False
    assert len(fake.find("GET", "bot_settings")) == 1

    assert sm.send_telegram("reply", chat_id=CHAT_ID, bypass_pause=True) is True
    assert fake.sent_texts() == ["reply"]


def test_offset_falls_back_to_file_when_table_missing(sm, tmp_path):
    offset_file = tmp_path / "telegram_offset.json"
    offset_file.write_text('{"offset": 5}', encoding="utf-8")
    sm.TELEGRAM_OFFSET_FILE = str(offset_file)
    missing = FakeResponse(404, {"code": "42P01"}, text='{"code":"42P01"}')
    sm.requests = FakeRequests({
        ("GET", "bot_runtime_state"): missing,
        ("POST", "bot_runtime_state"): missing,
    })
    assert sm.load_telegram_offset() == 5
    assert sm.RUNTIME_STATE_TABLE_AVAILABLE is False
    sm.save_telegram_offset(9)
    assert '"offset": 9' in offset_file.read_text(encoding="utf-8")


LINKED = {("GET", "user_profiles"): FakeResponse(200, [{"user_id": USER_ID}])}
NOT_ADMIN = {("GET", "admin_users"): FakeResponse(200, [])}
ADMIN = {("GET", "admin_users"): FakeResponse(200, [{"user_id": USER_ID}])}


def test_monitors_lists_names_state_and_keywords(sm):
    fake = run_updates(sm, "/monitors", {**LINKED, ("GET", "user_monitors"): FakeResponse(200, [
        {"name": "Bank", "status": "active", "notify_telegram": True,
         "monitor_keywords": [{"keyword": "ABB"}, {"keyword": "Kapital Bank"}]},
        {"name": "Köhnə", "status": "inactive", "notify_telegram": True, "monitor_keywords": []},
    ])})
    assert "monitor_keywords(keyword)" in fake.find("GET", "user_monitors")[0]["params"]["select"]
    assert fake.sent_texts() == [
        "Monitorlarınız:\n• Bank (aktiv): ABB, Kapital Bank\n• Köhnə (deaktiv): açar söz yoxdur"
    ]


def test_pause_and_resume_keep_the_link(sm):
    patch = {("PATCH", "user_monitors"): FakeResponse(204, None, text="")}
    fake = run_updates(sm, "/pause", {**LINKED, **patch})
    call = fake.find("PATCH", "user_monitors")[0]
    assert call["params"]["user_id"] == f"in.({USER_ID})"
    assert call["json"] == {"notify_telegram": False, "telegram_chat_id": CHAT_ID}
    assert not fake.find("PATCH", "user_profiles")
    assert fake.sent_texts() == [sm.TELEGRAM_REPLY_PAUSED]

    fake = run_updates(sm, "/resume", {**LINKED, **patch})
    assert fake.find("PATCH", "user_monitors")[0]["json"]["notify_telegram"] is True
    assert fake.sent_texts() == [sm.TELEGRAM_REPLY_RESUMED]


def test_pause_in_unlinked_chat(sm):
    fake = run_updates(sm, "/pause", {("GET", "user_profiles"): FakeResponse(200, [])})
    assert not fake.find("PATCH", "user_monitors")
    assert fake.sent_texts() == [sm.TELEGRAM_REPLY_NOT_LINKED]


def test_admin_commands_rejected_for_customers(sm):
    fake = run_updates(sm, "/pause_all", {**LINKED, **NOT_ADMIN})
    assert not fake.find("PATCH", "bot_settings")
    assert fake.sent_texts() == [sm.TELEGRAM_REPLY_ADMIN_ONLY]


def test_admin_pause_all_updates_settings_and_cache(sm):
    fake = run_updates(sm, "/pause_all", {**LINKED, **ADMIN, ("PATCH", "bot_settings"): FakeResponse(204, None, text="")})
    assert fake.find("PATCH", "bot_settings")[0]["json"] == {"notifications_paused": True}
    assert sm.BOT_SETTINGS_CACHE["paused"] is True
    assert fake.sent_texts() == [sm.TELEGRAM_REPLY_ALL_PAUSED]


def test_admin_stats_reads_exact_counts(sm):
    counted = FakeResponse(200, [], headers={"Content-Range": "0-0/12"})
    routes = {**ADMIN, ("GET", "bot_settings"): FakeResponse(200, [{"notifications_paused": False}])}
    for table in ("user_monitors", "monitor_keywords", "sources", "monitored_items", "monitor_alerts"):
        routes[("GET", table)] = counted
    # user_profiles answers both the chat lookup and the count.
    routes[("GET", "user_profiles")] = FakeResponse(200, [{"user_id": USER_ID}], headers={"Content-Range": "0-0/5"})
    fake = run_updates(sm, "/stats", routes)
    text = fake.sent_texts()[0]
    assert "İstifadəçi: 5" in text and "Aktiv mənbə: 12" in text and "Bildirişlər: aktiv" in text
    assert fake.find("GET", "sources")[1]["params"]["consecutive_fail_count"] == "gte.3"


def test_help_shows_admin_commands_only_to_admins(sm):
    assert "/stats" not in run_updates(sm, "/help", {**LINKED, **NOT_ADMIN}).sent_texts()[0]
    assert "/stats" in run_updates(sm, "/start", {**LINKED, **ADMIN}).sent_texts()[0]


def test_command_menu_scopes_admin_commands_to_admin_chats(sm):
    fake = FakeRequests({
        ("POST", "setMyCommands"): FakeResponse(200, {"ok": True}),
        **ADMIN,
        ("GET", "user_profiles"): FakeResponse(200, [{"telegram_chat_id": CHAT_ID}]),
    })
    sm.requests = fake
    sm.register_telegram_command_menu()
    default, admin = fake.find("POST", "setMyCommands")
    assert "scope" not in default["json"]
    assert {c["command"] for c in default["json"]["commands"]} >= {"status", "monitors", "pause", "stop"}
    assert "stats" not in {c["command"] for c in default["json"]["commands"]}
    assert admin["json"]["scope"] == {"type": "chat", "chat_id": CHAT_ID}
    assert "pause_all" in {c["command"] for c in admin["json"]["commands"]}


def test_poll_error_is_recorded_without_marking_poll_ok(sm):
    sm.requests = FakeRequests({
        ("GET", "getUpdates"): FakeResponse(409, {"ok": False}, text="Conflict: terminated by other getUpdates request"),
        ("GET", "bot_runtime_state"): FakeResponse(200, []),
        ("POST", "bot_runtime_state"): FakeResponse(201, []),
    })
    sm.connect_telegram_users_from_updates()
    heartbeat = [c for c in sm.requests.find("POST", "bot_runtime_state") if c["json"]["key"] == "telegram_heartbeat"]
    value = heartbeat[0]["json"]["value"]
    assert value["last_error"] == "poll:409"
    assert value["last_poll_ok_at"] is None


def test_daily_cleanup_trims_log_tables(sm):
    ok = FakeResponse(204, None, text="")
    fake = FakeRequests({
        ("POST", "cleanup_old_monitor_data"): ok,
        ("DELETE", "discovery_logs"): ok,
        ("DELETE", "sent_news"): ok,
        ("DELETE", "telegram_link_tokens"): ok,
        ("DELETE", "edge_rate_limits"): ok,
    })
    fake.delete = lambda url, **kwargs: fake._call("DELETE", url, **kwargs)
    sm.requests = fake
    sm.LOG_RETENTION_DAYS = 14
    sm.MONITOR_DATA_RETENTION_DAYS = 30
    sm.cleanup_old_monitor_data_if_needed()

    cutoffs = {c["name"]: next(iter(c["params"].items())) for c in fake.calls if c["method"] == "DELETE"}
    assert set(cutoffs) == {"discovery_logs", "sent_news", "telegram_link_tokens", "edge_rate_limits"}
    now = datetime.now(ZoneInfo("Asia/Baku"))

    def days_kept(value):
        return round((now - datetime.fromisoformat(value[3:])).total_seconds() / 86400)

    assert cutoffs["discovery_logs"][0] == "created_at" and days_kept(cutoffs["discovery_logs"][1]) == 14
    assert days_kept(cutoffs["sent_news"][1]) == 30
    assert cutoffs["telegram_link_tokens"][0] == "expires_at"

    # Runs once a day.
    sm.cleanup_old_monitor_data_if_needed()
    assert len(fake.find("DELETE", "discovery_logs")) == 1


def test_reserve_skips_same_headline_from_same_source(sm):
    fake = FakeRequests({("GET", "sent_news"): lambda kw: FakeResponse(
        200, [{"link": "https://a.az/x"}] if "source_id" in kw["params"] else []
    )})
    sm.requests = fake
    assert sm.reserve_news("https://a.az/y?id=2", "Eyni başlıq", {"name": "A"}, source_id="s1") is False
    assert fake.find("GET", "sent_news")[1]["params"]["source_id"] == "eq.s1"
    assert not fake.find("POST", "sent_news")


def test_reserve_new_headline_is_written(sm):
    fake = FakeRequests({
        ("GET", "sent_news"): FakeResponse(200, []),
        ("POST", "sent_news"): FakeResponse(201, []),
    })
    sm.requests = fake
    assert sm.reserve_news("https://a.az/z", "Yeni başlıq", {"name": "A"}, source_id="s1") is True
    assert fake.find("POST", "sent_news")[0]["json"]["link"] == "https://a.az/z"
