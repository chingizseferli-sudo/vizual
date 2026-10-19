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
    def __init__(self, status_code, payload=None, text=None):
        self.status_code = status_code
        self._payload = payload
        self.text = text if text is not None else str(payload)

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
