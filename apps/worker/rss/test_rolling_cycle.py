import threading
import time

import site_monitor as sm


def reset_pool(monkeypatch, workers=4):
    monkeypatch.setattr(sm, "MAX_WORKERS", workers)
    monkeypatch.setattr(sm, "SITE_POOL", {"executor": None})
    monkeypatch.setattr(sm, "SITES_IN_FLIGHT", {})
    monkeypatch.setattr(sm, "SITE_LAST_STARTED", {})


def test_busy_and_recent_sites_are_skipped(monkeypatch):
    reset_pool(monkeypatch)
    release = threading.Event()
    monkeypatch.setattr(sm, "process_site", lambda *args: release.wait(5) and {})
    slow = {"url": "https://slow.az/"}
    sm.submit_site(sm.site_pool(), sm.site_key(slow), 1, 1, slow)

    sm.SITE_LAST_STARTED[sm.site_key({"url": "https://recent.az/"})] = time.time()
    ready, busy, recent = sm.take_sites_to_read(
        [slow, {"url": "https://recent.az/"}, {"url": "https://fresh.az/"}]
    )
    assert [site["url"] for site in ready] == ["https://fresh.az/"]
    assert (busy, recent) == (1, 1)

    release.set()
    sm.site_pool().shutdown(wait=True)
    assert sm.SITES_IN_FLIGHT == {}
    ready, _, _ = sm.take_sites_to_read([slow], now=time.time() + sm.SITE_MIN_GAP_SECONDS + 1)
    assert ready == [slow]


def test_cycle_does_not_wait_for_a_slow_site(monkeypatch):
    reset_pool(monkeypatch)
    release = threading.Event()
    done = []

    def fake_process(index, total, site, *rest):
        if "slow" in site["url"]:
            release.wait(5)
        done.append(site["url"])
        return {"reason": "old_news"}

    monkeypatch.setattr(sm, "process_site", fake_process)
    monkeypatch.setattr(sm, "CYCLE_WAIT_SECONDS", 0.3)
    for name in (
        "connect_telegram_users_from_updates", "cleanup_old_monitor_data_if_needed",
        "account_housekeeping_if_needed", "notify_admins_about_demo_requests",
        "notify_admins_about_feedback", "start_competitor_ai", "start_keyword_variants",
    ):
        monkeypatch.setattr(sm, name, lambda *args, **kwargs: None)
    monkeypatch.setattr(sm.email_reports, "send_due_reports", lambda *args, **kwargs: None)
    monkeypatch.setattr(sm, "load_sites", lambda: [{"name": "slow", "url": "https://slow.az/"}, {"name": "fast", "url": "https://fast.az/"}])
    monkeypatch.setattr(sm, "expand_language_variants", lambda sites: sites)
    monkeypatch.setattr(sm, "load_patterns", lambda: {})
    monkeypatch.setattr(sm, "load_active_monitor_keywords", lambda: [])
    monkeypatch.setattr(sm, "load_competitor_keywords", lambda: [])
    monkeypatch.setattr(sm, "BOT_TOKEN", "")

    started = time.time()
    sm.check_sites(poll_commands=False, wait_all=False)
    assert time.time() - started < 3
    assert done == ["https://fast.az/"]
    assert sm.site_key({"url": "https://slow.az/"}) in sm.SITES_IN_FLIGHT

    release.set()
    sm.site_pool().shutdown(wait=True)
    assert "https://slow.az/" in done
