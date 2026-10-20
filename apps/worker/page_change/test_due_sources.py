import sys
import types

sys.modules.setdefault("dotenv", types.SimpleNamespace(load_dotenv=lambda *args, **kwargs: None))
import change_monitor


def test_watches_of_inactive_accounts_are_not_due(monkeypatch):
    calls = []

    def fake_request(method, path, config, params=None, **kwargs):
        calls.append((path, params))
        if path == "change_sources":
            return [
                {"id": "a", "user_id": "active-user", "url": "https://a.example", "status": "active"},
                {"id": "b", "user_id": "expired-user", "url": "https://b.example", "status": "active"},
            ]
        return [{"user_id": "expired-user"}]

    monkeypatch.setattr(change_monitor, "supabase_request", fake_request)
    due = change_monitor.get_due_sources({"due_batch_limit": 10})
    assert [row["id"] for row in due] == ["a"]
    assert ("user_profiles", {"select": "user_id", "status": "neq.active"}) in calls
