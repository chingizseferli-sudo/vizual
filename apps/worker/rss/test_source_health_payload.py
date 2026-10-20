import sys
import types
import unittest


if "requests" not in sys.modules:
    requests = types.ModuleType("requests")

    class _RequestException(Exception):
        pass

    class _Timeout(_RequestException):
        pass

    class _SSLError(_RequestException):
        pass

    class _ConnectionError(_RequestException):
        pass

    requests.Timeout = _Timeout
    requests.exceptions = types.SimpleNamespace(
        SSLError=_SSLError,
        ConnectionError=_ConnectionError,
        RequestException=_RequestException,
    )
    requests.get = lambda *_args, **_kwargs: None
    requests.post = lambda *_args, **_kwargs: None
    requests.patch = lambda *_args, **_kwargs: None
    sys.modules["requests"] = requests



if "bs4" not in sys.modules:
    bs4 = types.ModuleType("bs4")

    class _BeautifulSoup:
        def __init__(self, *_args, **_kwargs):
            pass

        def find_all(self, *_args, **_kwargs):
            return []

        def find(self, *_args, **_kwargs):
            return None

        def get_text(self, *_args, **_kwargs):
            return ""

    bs4.BeautifulSoup = _BeautifulSoup
    sys.modules["bs4"] = bs4

if "feedparser" not in sys.modules:
    feedparser = types.ModuleType("feedparser")
    feedparser.parse = lambda *_args, **_kwargs: types.SimpleNamespace(entries=[], bozo=False)
    sys.modules["feedparser"] = feedparser

import site_monitor


class SourceHealthPayloadTests(unittest.TestCase):
    def test_runtime_reason_is_used_when_result_is_unknown(self):
        site = {
            "notes": "[bot_diagnostic] result=sitemap_empty; method_attempted=sitemap",
            "_read_failure_reason": "fallback_empty",
            "_read_method": "fallback",
            "_method_attempted": ["selector", "fallback"],
            "_fallback_used": True,
        }
        payload, reason, _ = site_monitor.build_source_health_payload(
            site,
            {"reason": "unknown", "candidates": 0, "sent": 0},
            "2026-06-25T20:00:00+04:00",
        )

        self.assertEqual(reason, "fallback_empty")
        self.assertEqual(payload["last_result"], "fallback_empty")
        self.assertEqual(payload["consecutive_fail_count"], 1)
        self.assertNotIn("last_error", payload)
        self.assertNotIn("last_success_at", payload)
        self.assertIn("method_attempted=selector,fallback", payload["notes"])
        self.assertIn("fallback_used=true", payload["notes"])
        self.assertNotIn("result=sitemap_empty", payload["notes"])

    def test_empty_reads_become_error_after_threshold(self):
        site = {
            "_read_failure_reason": "selector_empty",
            "_read_method": "selector",
            "_method_attempted": ["selector"],
            "consecutive_fail_count": 1,
        }
        payload, reason, hard_fail_reasons = site_monitor.build_source_health_payload(
            site,
            {"reason": "selector_empty", "candidates": 0, "sent": 0},
            "2026-06-25T20:00:00+04:00",
        )
        self.assertNotIn(reason, hard_fail_reasons)
        self.assertEqual(payload["consecutive_fail_count"], 2)
        self.assertNotIn("last_error", payload)
        self.assertNotIn("last_success_at", payload)

        site["consecutive_fail_count"] = 2
        payload, _, _ = site_monitor.build_source_health_payload(
            site,
            {"reason": "selector_empty", "candidates": 0, "sent": 0},
            "2026-06-25T20:30:00+04:00",
        )
        self.assertEqual(payload["consecutive_fail_count"], 3)
        self.assertEqual(payload["last_error"], "selector_empty")
        self.assertNotIn("last_success_at", payload)

    def test_loss_streak_becomes_error_and_resets_on_normal_read(self):
        site = {"_read_failure_reason": "bad_title", "consecutive_fail_count": 1}
        payload, _, _ = site_monitor.build_source_health_payload(
            site,
            {"reason": "bad_title", "candidates": 3, "sent": 0},
            "2026-06-25T20:00:00+04:00",
        )
        self.assertEqual(payload["consecutive_fail_count"], 2)
        self.assertNotIn("last_error", payload)

        site["consecutive_fail_count"] = 2
        payload, _, _ = site_monitor.build_source_health_payload(
            site,
            {"reason": "no_date", "candidates": 3, "sent": 0},
            "2026-06-25T20:30:00+04:00",
        )
        self.assertEqual(payload["consecutive_fail_count"], 3)
        self.assertEqual(payload["last_error"], "no_date")

        site["consecutive_fail_count"] = 3
        payload, _, _ = site_monitor.build_source_health_payload(
            site,
            {"reason": "old_news", "candidates": 3, "sent": 0},
            "2026-06-25T21:00:00+04:00",
        )
        self.assertEqual(payload["consecutive_fail_count"], 0)
        self.assertIsNone(payload["last_error"])

    def test_healthy_reads_are_polled_again_after_the_method_interval_only(self):
        from datetime import timedelta
        for reason in ("old_news", "no_monitor_match", "sent", "duplicate"):
            self.assertEqual(site_monitor.source_backoff_interval(reason), timedelta(0), reason)
        self.assertEqual(site_monitor.get_scheduler_base_interval_minutes({"monitor_method": "rss"}), 5)
        self.assertEqual(site_monitor.get_scheduler_base_interval_minutes({"monitor_method": "latest_page"}), 8)
        # Blocks and dead sites still back off for hours.
        self.assertGreaterEqual(site_monitor.source_backoff_interval("http_403"), timedelta(hours=24))

    def test_loss_streak_does_not_slow_polling(self):
        notes = site_monitor.merge_crawl_state_notes("", {"last_result": "bad_title"})
        site = {"monitor_method": "rss", "consecutive_fail_count": 4, "notes": notes}
        self.assertEqual(site_monitor.get_scheduler_fail_count(site), 0)
        site["notes"] = site_monitor.merge_crawl_state_notes("", {"last_result": "selector_empty"})
        self.assertEqual(site_monitor.get_scheduler_fail_count(site), 4)

    def test_hard_failure_sets_last_error(self):
        payload, reason, hard_fail_reasons = site_monitor.build_source_health_payload(
            {"_read_failure_reason": "http_403"},
            {"reason": "http_403", "candidates": 0, "sent": 0},
            "2026-06-25T20:00:00+04:00",
        )
        self.assertIn(reason, hard_fail_reasons)
        self.assertEqual(payload["last_error"], "http_403")
        self.assertNotIn("last_success_at", payload)

    def test_candidates_mark_article_found(self):
        site = {
            "_read_method": "rss",
            "_method_attempted": ["rss"],
            "_method_succeeded": "rss",
        }
        payload, reason, _ = site_monitor.build_source_health_payload(
            site,
            {"reason": "old_news", "candidates": 3, "sent": 0},
            "2026-06-25T20:00:00+04:00",
        )

        self.assertEqual(reason, "old_news")
        self.assertEqual(payload["last_success_at"], "2026-06-25T20:00:00+04:00")
        self.assertEqual(payload["last_article_found_at"], "2026-06-25T20:00:00+04:00")
        self.assertIsNone(payload["last_error"])
        self.assertIn("bot_candidates=3", payload["notes"])
        self.assertIn("bot_sent=0", payload["notes"])

    def test_sent_news_records_telegram_proof_counts(self):
        site = {
            "_read_method": "rss",
            "_method_attempted": ["rss"],
            "_method_succeeded": "rss",
        }
        payload, reason, _ = site_monitor.build_source_health_payload(
            site,
            {"reason": "sent", "candidates": 4, "sent": 1},
            "2026-06-25T20:00:00+04:00",
        )

        self.assertEqual(reason, "sent")
        self.assertIn("[telegram_success] sent_at=2026-06-25T20:00:00+04:00", payload["notes"])
        self.assertIn("bot_candidates=4", payload["notes"])
        self.assertIn("bot_sent=1", payload["notes"])


if __name__ == "__main__":
    unittest.main()
