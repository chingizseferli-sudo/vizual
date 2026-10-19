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
        self.assertEqual(payload["last_error"], "fallback_empty")
        self.assertNotIn("last_success_at", payload)
        self.assertIn("method_attempted=selector,fallback", payload["notes"])
        self.assertIn("fallback_used=true", payload["notes"])
        self.assertNotIn("result=sitemap_empty", payload["notes"])

    def test_hard_failure_sets_last_error(self):
        site = {
            "_read_failure_reason": "selector_empty",
            "_read_method": "selector",
            "_method_attempted": ["selector"],
        }
        payload, reason, hard_fail_reasons = site_monitor.build_source_health_payload(
            site,
            {"reason": "selector_empty", "candidates": 0, "sent": 0},
            "2026-06-25T20:00:00+04:00",
        )

        self.assertIn(reason, hard_fail_reasons)
        self.assertEqual(payload["last_result"], "selector_empty")
        self.assertEqual(payload["last_error"], "selector_empty")
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
