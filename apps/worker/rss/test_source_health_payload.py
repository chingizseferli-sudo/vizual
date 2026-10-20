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


class ArticleVerdictCacheTests(unittest.TestCase):
    def setUp(self):
        site_monitor.ARTICLE_VERDICT_CACHE.clear()
        self.keywords = [{"id": 1, "keyword": "neft", "match_type": "contains", "monitor_id": 7}]
        self.signature = site_monitor.keywords_signature(self.keywords)

    def test_old_news_and_duplicate_are_remembered(self):
        for reason in ("old_news", "duplicate_url"):
            link = f"https://example.az/{reason}-xeber"
            site_monitor.remember_article_verdict(link, reason)
            self.assertEqual(site_monitor.cached_article_verdict(link, self.signature), reason)

    def test_verdict_expires(self):
        link = "https://example.az/kohne-xeber"
        site_monitor.remember_article_verdict(link, "old_news", now=1000)
        self.assertEqual(site_monitor.cached_article_verdict(link, self.signature, now=1000 + 86000), "old_news")
        self.assertEqual(site_monitor.cached_article_verdict(link, self.signature, now=1000 + 90000), "")

    def test_no_monitor_match_is_dropped_when_keywords_change(self):
        link = "https://example.az/xeber-bir"
        site_monitor.remember_article_verdict(link, "no_monitor_match", self.signature, now=1000)
        self.assertEqual(site_monitor.cached_article_verdict(link, self.signature, now=1100), "no_monitor_match")
        changed = site_monitor.keywords_signature(
            self.keywords + [{"id": 2, "keyword": "qaz", "match_type": "contains", "monitor_id": 7}]
        )
        self.assertEqual(site_monitor.cached_article_verdict(link, changed, now=1100), "")
        self.assertEqual(site_monitor.cached_article_verdict(link, self.signature, now=1000 + 2000), "")

    def test_no_monitor_match_without_signature_is_not_cached(self):
        link = "https://example.az/xeber-iki"
        site_monitor.remember_article_verdict(link, "no_monitor_match", "")
        self.assertEqual(site_monitor.cached_article_verdict(link, ""), "")

    def test_unknown_link_has_no_verdict(self):
        self.assertEqual(site_monitor.cached_article_verdict("https://example.az/yeni", self.signature), "")


class ReaderFallbackTests(unittest.TestCase):
    class Resp:
        def __init__(self, status, text="", url=""):
            self.status_code, self.text, self.url = status, text, url

    def setUp(self):
        self.calls = []
        self.original_get = site_monitor.requests.get
        site_monitor.READER_BLOCKED_DOMAINS.clear()

        def fake_get(url, **kwargs):
            self.calls.append(url)
            if url.startswith(site_monitor.READER_FALLBACK_URL):
                return self.Resp(200, "<html>" + "x" * 300 + "</html>", url)
            return self.Resp(403 if "blocked.az" in url else 200, "ok", url)

        site_monitor.requests.get = fake_get

    def tearDown(self):
        site_monitor.requests.get = self.original_get

    def test_403_is_read_through_reader_and_remembered(self):
        response = site_monitor.get_with_reader_fallback("https://blocked.az/", "blocked.az", {"timeout": 5})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.url, "https://blocked.az/")
        self.calls.clear()
        site_monitor.get_with_reader_fallback("https://blocked.az/news/1", "blocked.az", {"timeout": 5})
        self.assertEqual(self.calls, [site_monitor.READER_FALLBACK_URL + "https://blocked.az/news/1"])

    def test_normal_site_never_uses_reader(self):
        response = site_monitor.get_with_reader_fallback("https://fine.az/", "fine.az", {"timeout": 5})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.calls, ["https://fine.az/"])

    def test_reader_failure_keeps_original_403(self):
        site_monitor.requests.get = lambda url, **k: self.Resp(403 if "blocked.az" in url and not url.startswith(site_monitor.READER_FALLBACK_URL) else 502, "", url)
        response = site_monitor.get_with_reader_fallback("https://blocked.az/", "blocked.az", {"timeout": 5})
        self.assertEqual(response.status_code, 403)


class MethodAdoptionTests(unittest.TestCase):
    def build(self, streak, method="selector", succeeded="fallback", candidates=3):
        state = {"fallback_method": "latest_page", "fallback_streak": streak} if streak else {}
        notes = site_monitor.merge_crawl_state_notes("", state) if state else ""
        site = {
            "name": "x.az",
            "monitor_method": method,
            "notes": notes,
            "_method_succeeded": succeeded,
            "_fallback_used": True,
        }
        return site_monitor.build_source_health_payload(
            site, {"reason": "old_news", "candidates": candidates, "sent": 0}, "2026-06-25T20:00:00+04:00"
        )[0]

    def test_switches_after_three_fallback_cycles(self):
        payload = self.build(streak=2)
        self.assertEqual(payload["monitor_method"], "latest_page")
        self.assertNotIn("fallback_streak", payload["notes"])

    def test_counts_streak_before_switching(self):
        payload = self.build(streak=0)
        self.assertNotIn("monitor_method", payload)
        self.assertIn('"fallback_streak":1', payload["notes"])

    def test_no_switch_without_articles_or_for_same_method(self):
        self.assertNotIn("monitor_method", self.build(streak=2, candidates=0))
        self.assertNotIn("monitor_method", self.build(streak=2, method="latest_page"))

    def test_google_news_and_rss_are_never_adopted(self):
        self.assertNotIn("monitor_method", self.build(streak=2, method="google_news_fallback"))
        self.assertNotIn("monitor_method", self.build(streak=2, succeeded="rss"))


if __name__ == "__main__":
    unittest.main()
