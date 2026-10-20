import hashlib
import json
import os
import re
import time
import threading
import unicodedata
from html import unescape
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
from email.utils import parsedate_to_datetime
from urllib.parse import parse_qsl, urlencode, unquote, urljoin, urlparse, urlunparse
from zoneinfo import ZoneInfo

import feedparser
import requests
from bs4 import BeautifulSoup
from dateutil import parser
from lxml import html

import source_lifecycle as lifecycle
from domain_policy import is_excluded_domain

HEALTH_FILE = "site_health.json"
TELEGRAM_OFFSET_FILE = "telegram_offset.json"

BOT_TOKEN = os.getenv("BOT_TOKEN", "").strip()
CHAT_ID = os.getenv("CHAT_ID", "").strip()
SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()

CHECK_INTERVAL_SECONDS = int(os.getenv("CHECK_INTERVAL_SECONDS", "60"))
MAX_SEND_PER_RUN = int(os.getenv("MAX_SEND_PER_RUN", "10"))
MAX_LINKS_PER_SITE = int(os.getenv("MAX_LINKS_PER_SITE", "10"))
NEWS_TIME_LIMIT_HOURS = int(os.getenv("NEWS_TIME_LIMIT_HOURS", "1"))
MAX_WORKERS = int(os.getenv("MAX_WORKERS", "10"))
REQUEST_TIMEOUT = int(os.getenv("REQUEST_TIMEOUT", "10"))
MONITOR_DATA_RETENTION_DAYS = int(os.getenv("MONITOR_DATA_RETENTION_DAYS", "30"))
# Worker logs kept in Postgres only as long as the admin pages need them.
LOG_RETENTION_DAYS = int(os.getenv("LOG_RETENTION_DAYS", "14"))
SOURCE_HEALTH_ENABLED = os.getenv("SOURCE_HEALTH_ENABLED", "false").strip().lower() in {"1", "true", "yes"}
SOURCE_MAX_CONSECUTIVE_FAILS = int(os.getenv("SOURCE_MAX_CONSECUTIVE_FAILS", "5"))
GOOGLE_NEWS_FALLBACK_HOURS = max(1, int(os.getenv("GOOGLE_NEWS_FALLBACK_HOURS", str(NEWS_TIME_LIMIT_HOURS))))
SCHEDULER_DRY_RUN = os.getenv("SCHEDULER_DRY_RUN", "false").strip().lower() in {"1", "true", "yes"}
EMPTY_READ_FAIL_THRESHOLD = max(1, int(os.getenv("EMPTY_READ_FAIL_THRESHOLD", "3") or 3))
DISABLE_TELEGRAM_SEND = os.getenv("DISABLE_TELEGRAM_SEND", "false").strip().lower() in {"1", "true", "yes"}
# Legacy `/start <user uuid>` linking lets anyone who knows a UUID receive that user's alerts.
TELEGRAM_ALLOW_LEGACY_UUID_LINK = os.getenv("TELEGRAM_ALLOW_LEGACY_UUID_LINK", "false").strip().lower() in {"1", "true", "yes"}
BOT_SETTINGS_CACHE_SECONDS = 60
VERIFY_RELEASE_REPAIR_ONLY = os.getenv("VERIFY_RELEASE_REPAIR_ONLY", "false").strip().lower() in {"1", "true", "yes"}
SOURCE_DEFAULT_INTERVAL_MINUTES = max(1, int(os.getenv("SOURCE_DEFAULT_INTERVAL_MINUTES", "15")))
SOURCE_SITEMAP_SCAN_LIMIT = max(5, int(os.getenv("SOURCE_SITEMAP_SCAN_LIMIT", "50")))
DOMAIN_REQUEST_JITTER_SECONDS = max(0.0, float(os.getenv("DOMAIN_REQUEST_JITTER_SECONDS", "0.35")))
CRAWLER_USER_AGENT = os.getenv(
    "CRAWLER_USER_AGENT",
    "VizualAzMonitor/1.0 (+https://vizual.az; contact: support@vizual.az)",
).strip()

PATTERNS_FILE = "patterns.json"
BAKU_TZ = ZoneInfo("Asia/Baku")
USER_TELEGRAM_CACHE = {}
USER_TELEGRAM_CACHE_AT = {}
# The profile is the only source of truth for a customer's chat: re-read it often so
# unlinking on the website stops alerts within minutes in this long-running process.
USER_TELEGRAM_CACHE_SECONDS = 300
ARTICLE_TITLE_INFO_CACHE = {}

# Verdicts for articles already judged, so a source that is polled every few minutes
# does not re-fetch the same ten pages each time. In memory only (reset on restart).
#   old_news / duplicate_url never change; no_monitor_match depends on the keyword set.
ARTICLE_VERDICT_CACHE = {}
ARTICLE_VERDICT_MAX = 20000
ARTICLE_VERDICT_TTL_SECONDS = {"old_news": 86400, "duplicate_url": 86400, "no_monitor_match": 1800}
_KEYWORD_SIGNATURE_MEMO = {"id": None, "signature": ""}


def keywords_signature(monitor_keywords_cache):
    """Stable fingerprint of the active keyword set; '' when it is unknown."""
    if monitor_keywords_cache is None:
        return ""
    memo = _KEYWORD_SIGNATURE_MEMO
    if memo["id"] == id(monitor_keywords_cache):
        return memo["signature"]
    parts = sorted(
        f"{row.get('id')}|{row.get('keyword')}|{row.get('match_type')}|{row.get('monitor_id')}"
        for row in monitor_keywords_cache
    )
    signature = hashlib.sha1("\n".join(parts).encode("utf-8")).hexdigest()
    memo["id"], memo["signature"] = id(monitor_keywords_cache), signature
    return signature


def cached_article_verdict(link, signature, now=None):
    entry = ARTICLE_VERDICT_CACHE.get(normalize_link(link))
    if not entry:
        return ""
    now = now if now is not None else time.time()
    reason = entry["reason"]
    if now - entry["at"] > ARTICLE_VERDICT_TTL_SECONDS.get(reason, 0):
        return ""
    if reason == "no_monitor_match" and (not signature or entry["signature"] != signature):
        return ""
    return reason


def remember_article_verdict(link, reason, signature="", now=None):
    if reason == "no_monitor_match" and not signature:
        return
    ARTICLE_VERDICT_CACHE[normalize_link(link)] = {
        "reason": reason,
        "signature": signature,
        "at": now if now is not None else time.time(),
    }
LAST_MONITOR_CLEANUP = None
LAST_ACCOUNT_HOUSEKEEPING = None
TELEGRAM_LAST_ERROR = ""
BOT_SETTINGS_CACHE = {"paused": False, "fetched_at": 0.0}
RUNTIME_STATE_TABLE_AVAILABLE = True
TELEGRAM_HEARTBEAT = {"last_poll_at": None, "last_poll_ok_at": None, "last_error": None, "last_error_at": None, "last_send_ok_at": None, "loaded": False}

STRICT_WORDS = {
    "dim", "tkta", "arti", "pisa", "timss", "pirls", "bağça", "magistr",
    "peşə", "elm", "miq", "diplom"
}

NEWS_CATEGORIES = {
    "sosial", "siyasət", "hadisə", "cəmiyyət", "iqtisadiyyat", "dünya",
    "ölkə", "təhsil", "elm", "mədəniyyət", "idman", "kriminal",
    "region", "bölgə", "maraqlı", "şou", "sağlamlıq", "texnologiya",
}

TITLE_NOISE_LABELS = {
    "video", "foto", "yenilənib", "yeniləndi", "canlı", "son dəqiqə",
    "açıqlama", "rəsmi", "eksklüziv", "müsahibə", "reportaj",
}

COMMON_LATEST_PATHS = [
    "/news", "/xeberler", "/xeber", "/az/news", "/az/xeberler", "/az/xeber",
    "/son-xeberler", "/latest", "/lastnews", "/gundem", "/cemiyyet",
    "/sosial", "/tehsil", "/elm", "/media", "/press", "/articles", "/posts",
]

COMMON_RSS_PATHS = [
    "/feed/", "/feed", "/rss", "/rss/", "/rss.xml", "/feed.xml", "/atom.xml",
    "/az/feed/", "/az/feed", "/az/rss", "/az/rss.xml", "/az/feed.xml",
    "/xeberler/rss", "/news/rss", "/rss-feed", "/rss_feed", "/rss-lent",
    "/jsonfeed", "/feed/rss", "/index.php/rss",
]

LOCAL_ONLY_DOMAINS = {"localhost", "127.0.0.1", "0.0.0.0", "::1"}
REQUEST_HEADERS = {
    "User-Agent": CRAWLER_USER_AGENT,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,application/rss+xml;q=0.8,application/atom+xml;q=0.8,*/*;q=0.7",
    "Accept-Language": "az-AZ,az;q=0.9,en-US;q=0.8",
}

ARTICLE_URL_PATTERNS = [
    "/news/", "/xeber/", "/xeberler/", "/xəbərlər/", "/az/news/",
    "/az/xeber/", "/az/xeberler/", "/az/xəbərlər/", "/post/",
    "/article/", "/articles/view/", "/read/", "/item/", "/posts/detail/", "/writers/detail/", "/single_news/", "/kheberler/", "/son-xeber/", "/sosial/",
    "/resmi-xeber/", "/hadise/", "/politic/", "/world/", "/economy/",
    "/education/", "/elm/", "/tehsil/", "/2024/", "/2025/", "/2026/",
]

ARTICLE_URL_REGEX_PATTERNS = [
    re.compile(r"/\d{1,8}[-_][^/?#]{8,}\.html$"),
    re.compile(r"/\d{4,}[-_][^/?#]+\.html$"),
    re.compile(r"/(?:az|en|ru|tr)/[a-z0-9%_-]{3,}/\d{2,}/[a-z0-9%_-]{8,}/?$"),
    re.compile(r"/[a-z0-9%_-]{3,}/\d{2,}/[a-z0-9%_-]{8,}/?$"),
    re.compile(r"/(?:az|en|ru|tr)/news/\d{3,}/[^/?#]{8,}/?$"),
    re.compile(r"/news/\d{3,}/[^/?#]{8,}/?$"),
    re.compile(r"/xeber/(?:[^/?#-]+[_-]){2,}[^/?#-]+-\d{3,}/?$"),
    re.compile(r"/xeber/[^/?#]{8,}-\d{3,}/?$"),
    re.compile(r"/xeber/\d{3,}/?$"),
    re.compile(r"/[a-z0-9_-]+/\d{4,}[-_][^/?#]{8,}/?$"),
]

ROOT_SLUG_ARTICLE_DOMAINS = {
    "7times.az",
    "busaat.az",
    "editor.az",
    "globalinfo.az",
    "muallim.edu.az",
    "ekosu.az",
    "aem.az",
    "ayna.az",
    "ulusal.az",
    "yenicag.az",
}

ROOT_SLUG_ARTICLE_RE = re.compile(r"^/[a-z0-9%_-]{18,}/?$")
LANG_SLUG_ARTICLE_RE = re.compile(r"^/(az|en|ru|tr)/[a-z0-9%_-]{18,}/?$")
CATEGORY_SLUG_ARTICLE_RE = re.compile(r"^/[a-z0-9%_-]{3,}/[a-z0-9%_-]{18,}/?$")

DOMAIN_DETAIL_ARTICLE_PATTERNS = {
    "azertag.az": [re.compile(r"/xeber/[^/?#]{8,}-\d{3,}/?$")],
    "unikal.az": [re.compile(r"/news/\d{3,}/[^/?#]{8,}/?$")],
    "embawood.az": [re.compile(r"/blog/[^/?#]{8,}/?$")],
    "deazmed.az": [re.compile(r"/az/melumat-ve-xeberler/[^/?#]{8,}/?$")],
    "bqu.edu.az": [re.compile(r"/announcement_single/\d+/?$")],
    "airport.az": [re.compile(r"/press-release/[^/?#]{8,}/?$")],
}

DB_LOCK = threading.Lock()
TELEGRAM_LOCK = threading.Lock()
BOT_SETTINGS_LOCK = threading.Lock()
ARTICLE_TITLE_CACHE = {}
DOMAIN_LOCKS = {}
DOMAIN_LOCKS_LOCK = threading.Lock()
DOMAIN_LAST_REQUEST_AT = {}
DOMAIN_REQUEST_COUNTS = {}


def supabase_headers(extra=None):
    headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
    }
    if extra:
        headers.update(extra)
    return headers


def supabase_ready():
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        print("SUPABASE_URL və ya SUPABASE_SERVICE_ROLE_KEY yoxdur.", flush=True)
        return False
    return True


def enable_user_telegram_subscription(user_id, chat_id):
    payload = {
        "user_id": user_id,
        "telegram_chat_id": chat_id,
        "updated_at": datetime.now(BAKU_TZ).isoformat(),
    }
    profile_response = requests.post(
        f"{SUPABASE_URL}/rest/v1/user_profiles",
        headers=supabase_headers({"Prefer": "resolution=merge-duplicates"}),
        json=payload,
        timeout=REQUEST_TIMEOUT,
    )
    if profile_response.status_code not in (200, 201, 204):
        return False, f"profile:{profile_response.status_code}:{profile_response.text[:160]}"

    monitors_response = requests.patch(
        f"{SUPABASE_URL}/rest/v1/user_monitors",
        headers=supabase_headers({"Prefer": "return=minimal"}),
        params={"user_id": f"eq.{user_id}"},
        json={
            "telegram_chat_id": chat_id,
            "notify_telegram": True,
        },
        timeout=REQUEST_TIMEOUT,
    )
    if monitors_response.status_code not in (200, 204):
        return False, f"monitors:{monitors_response.status_code}:{monitors_response.text[:160]}"

    USER_TELEGRAM_CACHE[user_id] = chat_id
    return True, "ok"


def clean_text(text):
    text = unescape(str(text or ""))
    return re.sub(r"\s+", " ", repair_mojibake(text)).strip()


PERCENT_TEXT_RE = re.compile(r"(?:%[0-9A-Fa-f]{2}){2,}")


def decode_percent_text(text):
    value = str(text or "")
    if not value or not PERCENT_TEXT_RE.search(value):
        return value
    try:
        decoded = unquote(value)
    except Exception:
        return value
    if not decoded:
        return value
    # Keep decoding only when it improves readability or actually reveals letters.
    if mojibake_score(decoded) <= mojibake_score(value) or re.search(r"[A-Za-zƏəÖöĞğÜüÇçŞşİıА-Яа-яЁё]", decoded):
        return decoded
    return value


def clean_article_text(text):
    value = unescape(str(text or ""))
    value = decode_percent_text(value)
    value = repair_mojibake(value)
    value = unescape(value)
    value = repair_mojibake(value)
    return re.sub(r"\s+", " ", value).strip()


MOJIBAKE_MARKERS = (
    "\u00c3", "\u00c2", "\u00e2", "\u00ce", "\u00d0", "\u00d1",
    "\u0413", "\u0414", "\u0415", "\u0419", "\u00b3", "\u00be", "\u00ba", "\ufffd",
    "\u00ee", "\u00f4", "\u00f1", "\u00df", "\u00d5", "\u00f5",
)


def mojibake_score(text, original_length=None):
    value = str(text or "")
    score = value.count("\ufffd") * 8
    for marker in MOJIBAKE_MARKERS:
        score += value.count(marker) * 3
    score += len(re.findall(r"[\u00c0-\u00ff]{2,}", value))
    if original_length is not None:
        score += abs(len(value) - original_length) * 2
    return score


def repair_mojibake(text):
    value = str(text or "")
    if not value or not any(marker in value for marker in MOJIBAKE_MARKERS):
        return value

    candidates = [value]
    for encoding in ("latin1", "cp1252", "cp1251", "cp1254", "iso-8859-9"):
        try:
            candidates.append(value.encode(encoding).decode("utf-8"))
        except Exception:
            pass

    original_length = len(value)
    return min(candidates, key=lambda item: mojibake_score(item, original_length))
def looks_like_xml_content(text):
    sample = str(text or "").lstrip()[:500].lower()
    if not sample:
        return False
    return (
        sample.startswith("<?xml")
        or sample.startswith("<rss")
        or sample.startswith("<feed")
        or sample.startswith("<urlset")
        or sample.startswith("<sitemapindex")
        or "<urlset" in sample[:200]
        or "<sitemapindex" in sample[:200]
    )


def decode_response_text(response):
    raw = response.content or b""
    candidates = []

    for encoding in (
        response.encoding,
        response.apparent_encoding,
        "utf-8",
        "windows-1254",
        "cp1254",
        "iso-8859-9",
        "windows-1251",
        "cp1251",
    ):
        if not encoding:
            continue
        try:
            decoded = raw.decode(encoding, errors="replace")
            candidates.append(repair_mojibake(decoded))
        except Exception:
            continue

    if not candidates:
        return repair_mojibake(response.text)

    return min(candidates, key=mojibake_score)



def parse_scheduler_datetime(value):
    value = clean_text(value)
    if not value:
        return None
    try:
        normalized = value.replace("Z", "+00:00")
        dt = datetime.fromisoformat(normalized)
    except Exception:
        try:
            dt = parser.parse(value)
        except Exception:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=BAKU_TZ)
    return dt.astimezone(BAKU_TZ)


def normalize_scheduler_method(method):
    method = clean_text(method).lower()
    if method == "xpath":
        return "xpath_pattern"
    known_methods = {
        "rss",
        "rss_discovered",
        "google_news_fallback",
        "latest_page",
        "selector",
        "xpath_pattern",
        "homepage",
        "sitemap",
        "recoverable",
    }
    return method if method in known_methods else "default"


def get_scheduler_base_interval_minutes(site):
    method = normalize_scheduler_method(site.get("monitor_method", ""))
    # News is only worth sending while it is fresh (NEWS_TIME_LIMIT_HOURS), so
    # sources are polled every few minutes. Failing sources back off separately.
    method_intervals = {
        "rss": 5,
        "rss_discovered": 5,
        "google_news_fallback": 10,
        "latest_page": 8,
        "selector": 8,
        "xpath_pattern": 8,
        "homepage": 15,
        "sitemap": 20,
        "recoverable": 30,
        "default": 15,
    }
    return method_intervals.get(method, method_intervals["default"])


# The page was read but news is dropped (unreadable date, rejected title). This is
# a parsing problem, not a tired site, so it must not slow polling down.
LOSS_REASONS = {"no_date", "date_parse_failed", "bad_title"}


def get_scheduler_fail_count(site):
    if parse_crawl_state(site.get("notes")).get("last_result") in LOSS_REASONS:
        return 0
    try:
        return int(site.get("consecutive_fail_count") or 0)
    except Exception:
        return 0


def get_scheduler_fail_bucket(fail_count):
    if fail_count >= 5:
        return "fail_5_plus"
    if fail_count >= 3:
        return "fail_3_4"
    if fail_count >= 1:
        return "fail_1_2"
    return "fail_0"


def get_scheduler_fail_multiplier(fail_count):
    if fail_count >= 5:
        return 8
    if fail_count >= 3:
        return 4
    if fail_count >= 1:
        return 2
    return 1


def get_scheduler_interval_minutes(site):
    fail_count = get_scheduler_fail_count(site)
    return max(1, get_scheduler_base_interval_minutes(site) * get_scheduler_fail_multiplier(fail_count))


def classify_scheduler_error(last_error):
    value = clean_text(last_error).lower()
    if not value:
        return "none"
    if "403" in value or "429" in value:
        return "rate_or_block"
    if "timeout" in value or "timed out" in value:
        return "timeout"
    if any(marker in value for marker in ("dns", "name", "connect", "connection")):
        return "network"
    return "error"


def evaluate_source_schedule(site, now=None):
    now = now or datetime.now(BAKU_TZ)
    method = normalize_scheduler_method(site.get("monitor_method", ""))
    base_interval = get_scheduler_base_interval_minutes(site)
    fail_count = get_scheduler_fail_count(site)
    fail_bucket = get_scheduler_fail_bucket(fail_count)
    fail_multiplier = get_scheduler_fail_multiplier(fail_count)
    interval_minutes = max(1, base_interval * fail_multiplier)
    last_checked = parse_scheduler_datetime(site.get("last_checked_at"))
    error_type = classify_scheduler_error(site.get("last_error"))
    decision = {
        "site": site,
        "monitor_method": method,
        "base_interval_minutes": base_interval,
        "fail_multiplier": fail_multiplier,
        "fail_bucket": fail_bucket,
        "interval_minutes": interval_minutes,
        "final_interval_minutes": interval_minutes,
        "fail_count": fail_count,
        "error_type": error_type,
    }
    if not last_checked:
        decision.update({
            "due": True,
            "reason": "never_checked",
            "remaining_minutes": 0,
        })
        return decision
    elapsed_minutes = max(0, int((now - last_checked).total_seconds() // 60))
    remaining_minutes = max(0, interval_minutes - elapsed_minutes)
    due = elapsed_minutes >= interval_minutes
    reason = "interval_elapsed" if due else "recently_checked"
    if not due and fail_count > 0:
        reason = "fail_backoff"
    decision.update({
        "due": due,
        "reason": reason,
        "remaining_minutes": remaining_minutes,
        "last_checked_at": last_checked.isoformat(),
    })
    return decision


def summarize_scheduler_group(decisions, key):
    summary = {}
    for decision in decisions:
        group = decision.get(key) or "unknown"
        bucket = summary.setdefault(group, {"total": 0, "due": 0, "skip": 0})
        bucket["total"] += 1
        if decision.get("due"):
            bucket["due"] += 1
        else:
            bucket["skip"] += 1
    return summary


def format_scheduler_summary(summary):
    return " | ".join(
        f"{key} total={value['total']} due={value['due']} skip={value['skip']}"
        for key, value in sorted(summary.items())
    ) or "none"


def log_scheduler_dry_run_summary(sites, decisions):
    if not SCHEDULER_DRY_RUN:
        return
    total = len(sites)
    due_count = sum(1 for decision in decisions if decision.get("due"))
    skip_count = total - due_count
    reason_counts = {}
    for decision in decisions:
        reason = decision.get("reason") or "unknown"
        reason_counts[reason] = reason_counts.get(reason, 0) + 1
    reasons_text = " | ".join(f"{key}={value}" for key, value in sorted(reason_counts.items())) or "none"
    interval_text = (
        "rss=10m | rss_discovered=10m | google_news_fallback=15m | latest_page=15m | "
        "selector=20m | xpath_pattern=20m | homepage=30m | sitemap=45m | recoverable=45m | default=30m"
    )
    method_text = format_scheduler_summary(summarize_scheduler_group(decisions, "monitor_method"))
    fail_bucket_text = format_scheduler_summary(summarize_scheduler_group(decisions, "fail_bucket"))
    print("[DRY-RUN] Scheduler aktivdir. Menbeler skip edilmeyecek.", flush=True)
    print(f"[DRY-RUN] Scheduler | total={total} | due={due_count} | would_skip={skip_count}", flush=True)
    print(f"[DRY-RUN] Scheduler intervals | {interval_text}", flush=True)
    print(f"[DRY-RUN] Scheduler skip reasons | {reasons_text}", flush=True)
    print(f"[DRY-RUN] Scheduler methods | {method_text}", flush=True)
    print(f"[DRY-RUN] Scheduler fail buckets | {fail_bucket_text}", flush=True)
    shown = 0
    for decision in decisions:
        if decision.get("due"):
            continue
        site = decision.get("site") or {}
        print(
            "[DRY-RUN] Would skip: "
            f"{site.get('name') or site.get('url')} | method={decision.get('monitor_method') or 'default'} "
            f"| interval={decision.get('interval_minutes')}m | remaining={decision.get('remaining_minutes')}m "
            f"| reason={decision.get('reason')} | fail={decision.get('fail_count')} | error={decision.get('error_type')}",
            flush=True,
        )
        shown += 1
        if shown >= 10:
            break


def normalize_text(text):
    text = str(text or "").lower()
    text = text.replace("i̇", "i")
    return text


def keyword_fold(text):
    """Case-insensitive matching key for keywords and titles.

    Python's lower()/casefold() turns "İ" into "i" + U+0307 and "I" into "i",
    while Azerbaijani pairs İ/i and I/ı. Users and sites mix both conventions
    (e.g. "UNICEF" vs "Unicef", "AZƏRİŞIQ" vs "Azərişıq"), so dotted and dotless
    i are folded into one letter for matching only.
    """
    text = unicodedata.normalize("NFC", str(text or ""))
    text = text.replace("İ", "i").replace("I", "i")
    text = text.casefold().replace("i\u0307", "i").replace("ı", "i")
    return re.sub(r"\s+", " ", text)


STRICT_WORDS_FOLDED = {keyword_fold(word) for word in STRICT_WORDS}


def get_domain(url):
    return urlparse(url or "").netloc.replace("www.", "").lower()


def is_local_only_url(url):
    domain = get_domain(url).split(":")[0]
    return domain in LOCAL_ONLY_DOMAINS


def parse_baku_datetime(value):
    value = clean_text(value)
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except Exception:
        return None
    if parsed.tzinfo:
        return parsed.astimezone(BAKU_TZ)
    return parsed.replace(tzinfo=BAKU_TZ)


def parse_crawl_state(notes):
    text = str(notes or "")
    match = re.search(r"\[crawl_state\](.*?)\[/crawl_state\]", text, flags=re.DOTALL)
    if not match:
        return {}
    try:
        data = json.loads(match.group(1))
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def merge_crawl_state_notes(existing_notes, state):
    lines = [
        line for line in str(existing_notes or "").splitlines()
        if "[crawl_state]" not in line and "[/crawl_state]" not in line
    ]
    safe_state = {
        key: value
        for key, value in (state or {}).items()
        if value not in (None, "")
    }
    lines.append(f"[crawl_state]{json.dumps(safe_state, ensure_ascii=False, separators=(',', ':'))}[/crawl_state]")
    return "\n".join(line for line in lines if line.strip())


TELEGRAM_TOKEN_RE = re.compile(r"bot\d+:[A-Za-z0-9_-]+")


def redact_secrets(text):
    # Telegram API URLs embed the bot token and requests puts the URL in exception text.
    return TELEGRAM_TOKEN_RE.sub("bot<redacted>", str(text or ""))


def get_domain_lock(domain):
    with DOMAIN_LOCKS_LOCK:
        if domain not in DOMAIN_LOCKS:
            DOMAIN_LOCKS[domain] = threading.Lock()
        return DOMAIN_LOCKS[domain]


# Last resort for sites that answer 403 to our server address: read the page through a
# free reader service. Only used after a direct 403, and remembered per domain for a while.
READER_FALLBACK_ENABLED = os.getenv("READER_FALLBACK_ENABLED", "1") != "0"
READER_FALLBACK_URL = "https://r.jina.ai/"
READER_BLOCKED_TTL_SECONDS = 6 * 3600
READER_BLOCKED_DOMAINS = {}


def fetch_via_reader(url, timeout):
    try:
        response = requests.get(
            READER_FALLBACK_URL + url,
            headers={"X-Return-Format": "html", "Accept": "text/html"},
            timeout=max(timeout or 0, 30),
            allow_redirects=True,
        )
    except Exception as exc:
        print(f"Reader fallback xətası: {url} | {exc}", flush=True)
        return None
    text = getattr(response, "text", "") or ""
    if response.status_code != 200 or len(text) < 200 or "Target URL returned error" in text[:400]:
        return None
    # A challenge or empty shell page is not a read: without links the 403 must stay a 403.
    if "href=" not in text:
        return None
    response.url = url
    return response


def get_with_reader_fallback(url, domain, kwargs):
    if not READER_FALLBACK_ENABLED or url.startswith(READER_FALLBACK_URL):
        return requests.get(url, **kwargs)
    blocked_at = READER_BLOCKED_DOMAINS.get(domain)
    if blocked_at and time.time() - blocked_at < READER_BLOCKED_TTL_SECONDS:
        via_reader = fetch_via_reader(url, kwargs.get("timeout"))
        if via_reader is not None:
            return via_reader
    response = requests.get(url, **kwargs)
    if response.status_code == 403 and not is_local_only_url(url):
        via_reader = fetch_via_reader(url, kwargs.get("timeout"))
        if via_reader is not None:
            if urlparse(url).path in ("", "/"):
                READER_BLOCKED_DOMAINS[domain] = time.time()
            print(f"Reader fallback ilə oxundu: {url}", flush=True)
            return via_reader
    return response


def safe_request(url, *, site=None, method="", **kwargs):
    kwargs.setdefault("timeout", REQUEST_TIMEOUT)
    domain = get_domain(url)
    if not domain:
        return requests.get(url, **kwargs)
    lock = get_domain_lock(domain)
    with lock:
        now = time.time()
        last_request_at = DOMAIN_LAST_REQUEST_AT.get(domain, 0)
        wait_seconds = DOMAIN_REQUEST_JITTER_SECONDS - (now - last_request_at)
        if wait_seconds > 0:
            time.sleep(wait_seconds)
        DOMAIN_LAST_REQUEST_AT[domain] = time.time()
        DOMAIN_REQUEST_COUNTS[domain] = DOMAIN_REQUEST_COUNTS.get(domain, 0) + 1
        if site is not None:
            site["_request_count"] = int(site.get("_request_count") or 0) + 1
            if method:
                site["_last_request_method"] = method
        return get_with_reader_fallback(url, domain, kwargs)


def source_backoff_interval(reason, fail_count=0):
    reason = clean_text(reason)
    fail_count = int(fail_count or 0)
    if reason == "http_403":
        return timedelta(hours=24)
    if reason == "http_429":
        return timedelta(hours=18)
    if reason == "timeout":
        return timedelta(hours=6 if fail_count >= 2 else 1)
    if reason in {"dns_failure", "ssl_failure", "unsafe_url"}:
        return timedelta(hours=24)
    if reason in {"http_404", "dead"}:
        return timedelta(hours=24)
    if reason.startswith("http_5") or reason in {"site_error"}:
        return timedelta(hours=2 if fail_count < 3 else 6)
    if reason in {"rss_empty", "sitemap_empty", "latest_page_empty", "homepage_empty", "fallback_empty", "no_article"}:
        return timedelta(minutes=20)
    if reason in LOSS_REASONS:
        return timedelta(minutes=15)
    if reason in {"old_news", "future_date", "no_monitor_match", "duplicate_url", "duplicate", "no_keyword_match", "sent"}:
        # A healthy read: the per-method poll interval (5-20 min) alone decides the next check.
        return timedelta(0)
    return timedelta(minutes=SOURCE_DEFAULT_INTERVAL_MINUTES)


def is_technical_failure_reason(reason):
    reason = clean_text(reason)
    return (
        reason in {"site_error", "blocked", "dead", "failed", "http_403", "http_404", "http_429", "timeout", "dns_failure", "ssl_failure", "unsafe_url"}
        or reason.startswith("http_5")
    )


def source_schedule_decision(site, now=None):
    now = now or datetime.now(BAKU_TZ)
    state = parse_crawl_state(site.get("notes"))
    due_at = parse_baku_datetime(state.get("next_check_at") or state.get("backoff_until"))
    if due_at and due_at > now:
        remaining_minutes = max(1, int((due_at - now).total_seconds() // 60))
        return {
            "due": False,
            "reason": state.get("health_status") or "backoff",
            "remaining_minutes": remaining_minutes,
            "next_check_at": due_at.isoformat(),
        }

    legacy_decision = evaluate_source_schedule(site, now=now)
    if legacy_decision.get("due"):
        return {"due": True, "reason": legacy_decision.get("reason") or "due"}
    return {
        "due": False,
        "reason": legacy_decision.get("reason") or "recently_checked",
        "remaining_minutes": legacy_decision.get("remaining_minutes"),
        "next_check_at": None,
    }


def build_crawl_state(site, result, reason, now):
    fail_count = int(site.get("consecutive_fail_count") or 0)
    if is_technical_failure_reason(reason):
        fail_count += 1
    interval = source_backoff_interval(reason, fail_count=fail_count)
    next_check_at = parse_baku_datetime(now) or datetime.now(BAKU_TZ)
    next_check_at = next_check_at + interval
    health_status = {
        "sent": "article_found",
        "duplicate": "read_success",
        "duplicate_url": "read_success",
        "old_news": "no_fresh_news",
        "future_date": "no_fresh_news",
        "no_monitor_match": "no_keyword_match",
        "http_403": "blocked",
        "http_429": "rate_limited",
        "ssl_failure": "ssl_error",
    }.get(reason, reason or "unknown")
    return {
        "health_status": health_status,
        "last_result": reason,
        "last_http_status": site.get("_last_http_status"),
        "request_count": int(site.get("_request_count") or 0),
        "method": clean_text(site.get("_read_method") or site.get("monitor_method") or ""),
        "next_check_at": next_check_at.isoformat(),
        "updated_at": now,
    }



def http_status_reason(status_code):
    try:
        status = int(status_code)
    except Exception:
        return "site_error"
    if status == 403:
        return "http_403"
    if status == 404:
        return "http_404"
    if status == 429:
        return "http_429"
    if status >= 400:
        return f"http_{status}"
    return ""


def classify_fetch_exception(exc):
    if isinstance(exc, requests.Timeout):
        return "timeout"
    if isinstance(exc, requests.exceptions.SSLError):
        return "ssl_failure"
    if isinstance(exc, requests.exceptions.ConnectionError):
        value = str(exc).lower()
        if any(marker in value for marker in ("dns", "name resolution", "getaddrinfo", "nodename", "name or service not known")):
            return "dns_failure"
        return "dns_failure"
    return "site_error"


def normalize_read_method(method):
    method = clean_text(method).lower()
    if method == "xpath":
        return "xpath"
    if method == "rss_discovered":
        return "rss"
    return method


def empty_reason_for_method(method):
    method = normalize_read_method(method)
    if method == "rss":
        return "rss_empty"
    if method == "sitemap":
        return "sitemap_empty"
    if method == "selector":
        return "selector_empty"
    if method in {"xpath", "xpath_pattern"}:
        return "xpath_empty"
    if method == "homepage":
        return "homepage_empty"
    if method == "latest_page":
        return "latest_page_empty"
    if method in {"fallback", "recoverable"}:
        return "fallback_empty"
    if method == "google_news":
        return "rss_empty"
    return "no_article"


def record_method_attempt(site, method):
    method = normalize_read_method(method)
    if not method:
        return
    attempts = site.setdefault("_method_attempted", [])
    if method not in attempts:
        attempts.append(method)


def set_read_diagnostic(site, reason=None, method=None, fallback_used=None):
    if method:
        record_method_attempt(site, method)
        site["_read_method"] = normalize_read_method(method)
    if reason:
        site["_read_failure_reason"] = clean_text(reason)
    if fallback_used is not None:
        site["_fallback_used"] = bool(fallback_used)


def mark_read_success(site, method, fallback_used=False):
    method = normalize_read_method(method)
    site.pop("_read_failure_reason", None)
    site["_method_succeeded"] = method
    set_read_diagnostic(site, None, method, fallback_used)


def get_read_failure_reason(site, default="no_article"):
    return clean_text(site.get("_read_failure_reason") or default)


def final_source_health_reason(site, result):
    result_reason = clean_text((result or {}).get("reason"))
    runtime_reason = get_read_failure_reason(site, "")
    if result_reason and result_reason != "unknown":
        return result_reason
    if runtime_reason:
        return runtime_reason
    return "unknown"


def merge_bot_diagnostic_notes(
    existing_notes,
    reason,
    method,
    fallback_used,
    attempted_methods=None,
    succeeded_method=None,
    candidates=0,
    sent=0,
):
    raw_notes = str(existing_notes or "").strip()
    lines = [
        line for line in raw_notes.splitlines()
        if not line.strip().startswith("[bot_diagnostic]")
    ]
    attempted = ",".join(attempted_methods or []) or clean_text(method) or "unknown"
    succeeded = clean_text(succeeded_method) or (clean_text(method) if clean_text(reason) == "sent" else "")
    diagnostic = (
        f"[bot_diagnostic] result={clean_text(reason) or 'unknown'}; "
        f"method_attempted={attempted}; "
        f"method_succeeded={succeeded or 'none'}; "
        f"method={clean_text(method) or 'unknown'}; "
        f"fallback_used={'true' if fallback_used else 'false'}; "
        f"bot_candidates={int(candidates or 0)}; "
        f"bot_sent={int(sent or 0)}"
    )
    lines.append(diagnostic)
    return "\n".join(line for line in lines if line.strip())


def merge_telegram_success_notes(existing_notes, sent_at):
    lines = [
        line for line in str(existing_notes or "").splitlines()
        if not line.strip().startswith("[telegram_success]")
    ]
    lines.append(f"[telegram_success] sent_at={sent_at}")
    return "\n".join(line for line in lines if line.strip())


# When the configured method keeps failing but a fallback keeps delivering articles,
# the source row is switched to the method that works (after a short streak).
ADOPTABLE_METHODS = {"selector": "selector", "xpath": "xpath_pattern", "latest_page": "latest_page", "fallback": "latest_page"}
FALLBACK_ADOPT_STREAK = 3


def method_worth_adopting(site, candidates, fallback_used):
    if candidates <= 0 or not fallback_used:
        return ""
    target = ADOPTABLE_METHODS.get(clean_text(site.get("_method_succeeded") or ""))
    configured = clean_text(site.get("monitor_method") or "").lower()
    configured = {"xpath": "xpath_pattern", "rss_discovered": "rss"}.get(configured, configured)
    if not target or target == configured or configured == "google_news_fallback":
        return ""
    return target


def build_source_health_payload(site, result, now):
    result = result or {}
    reason = final_source_health_reason(site, result)
    candidates = int(result.get("candidates", 0) or 0)
    sent = int(result.get("sent", 0) or 0)
    read_method = clean_text(result.get("read_method") or site.get("_read_method") or "")
    attempted_methods = site.get("_method_attempted") or []
    succeeded_method = clean_text(site.get("_method_succeeded") or "")
    fallback_used = bool(result.get("fallback_used") or site.get("_fallback_used"))

    payload = {
        "last_checked_at": now,
        "last_result": reason,
        "notes": merge_bot_diagnostic_notes(
            site.get("notes"),
            reason,
            read_method,
            fallback_used,
            attempted_methods=attempted_methods,
            succeeded_method=succeeded_method,
            candidates=candidates,
            sent=sent,
        ),
    }

    hard_fail_reasons = {
        "site_error", "blocked", "dead", "failed",
        "http_403", "http_404", "http_429", "timeout",
        "dns_failure", "ssl_failure", "unsafe_url",
    }
    readable_reasons = {
        "sent", "duplicate", "old_news", "future_date", "no_date",
        "date_parse_failed", "no_monitor_match", "no_telegram_recipient",
        "no_keyword_match", "forbidden", "chat_not_found",
        "bot_blocked", "bad_request", "network_error", "telegram_429",
        "chat_migrated", "telegram_disabled", "duplicate_url",
    }
    # The page answered but nothing could be extracted. One empty read can be a
    # quiet hour; EMPTY_READ_FAIL_THRESHOLD in a row means the source is broken.
    empty_read_reasons = {
        "rss_empty", "invalid_xml", "selector_empty", "xpath_empty",
        "sitemap_empty", "no_article", "latest_page_empty",
        "homepage_empty", "fallback_empty",
    }

    # The page was read but real news is being dropped (unreadable date, rejected
    # title). One such cycle is noise; a streak means the source is losing news.
    if reason in hard_fail_reasons:
        payload["last_error"] = reason
    elif reason in LOSS_REASONS and sent == 0:
        loss_count = int(site.get("consecutive_fail_count") or 0) + 1
        payload["consecutive_fail_count"] = loss_count
        payload["last_success_at"] = now
        if loss_count >= EMPTY_READ_FAIL_THRESHOLD:
            payload["last_error"] = reason
    elif candidates == 0 and reason in empty_read_reasons:
        empty_count = int(site.get("consecutive_fail_count") or 0) + 1
        payload["consecutive_fail_count"] = empty_count
        if empty_count >= EMPTY_READ_FAIL_THRESHOLD:
            payload["last_error"] = reason
    elif candidates > 0 or reason in readable_reasons:
        payload["last_success_at"] = now
        payload["last_error"] = None
        payload["consecutive_fail_count"] = 0
    else:
        payload["last_error"] = reason

    if sent > 0:
        payload["notes"] = merge_telegram_success_notes(payload.get("notes"), now)

    if sent > 0 or candidates > 0:
        payload["last_article_found_at"] = now

    crawl_state = build_crawl_state(site, result, reason, now)
    previous_state = parse_crawl_state(site.get("notes"))
    adopt = method_worth_adopting(site, candidates, fallback_used)
    streak = 0
    if adopt:
        same = previous_state.get("fallback_method") == adopt
        streak = int(previous_state.get("fallback_streak") or 0) + 1 if same else 1
        if streak >= FALLBACK_ADOPT_STREAK:
            payload["monitor_method"] = adopt
            print(f"Metod yeniləndi: {site.get('name')} | {site.get('monitor_method')} -> {adopt}", flush=True)
            adopt, streak = "", 0
    if adopt:
        crawl_state["fallback_method"] = adopt
        crawl_state["fallback_streak"] = streak
    payload["notes"] = merge_crawl_state_notes(payload.get("notes"), crawl_state)

    return payload, reason, hard_fail_reasons


def patch_source_health(source_id, payload):
    last_error = None
    for attempt in range(2):
        try:
            response = requests.patch(
                f"{SUPABASE_URL}/rest/v1/sources",
                headers=supabase_headers({"Prefer": "return=minimal"}),
                params={"id": f"eq.{source_id}"},
                json=payload,
                timeout=REQUEST_TIMEOUT,
            )
            if response.status_code in {200, 204}:
                return True
            last_error = f"{response.status_code} | {response.text[:200]}"
            print(f"Source health update xetasi: {last_error}", flush=True)
        except Exception as exc:
            last_error = str(exc)
            print(f"Source health update istisnasi: {exc}", flush=True)
        if attempt == 0:
            time.sleep(0.5)
    print(f"Source health update alinmadi: source={source_id} | {last_error}", flush=True)
    return False

def get_base_url(url):
    parsed = urlparse(url or "")
    if not parsed.scheme or not parsed.netloc:
        return ""
    return f"{parsed.scheme}://{parsed.netloc}"


def normalize_link(link):
    link = clean_text(link)
    if not link:
        return ""
    parsed = urlparse(link)
    if not parsed.scheme or not parsed.netloc:
        return link.split("#")[0].rstrip("/")

    tracking_prefixes = ("utm_",)
    tracking_params = {
        "fbclid", "gclid", "dclid", "yclid", "mc_cid", "mc_eid",
        "igshid", "ref", "ref_src", "spm", "ved", "usg",
    }
    kept_query = []
    for key, value in parse_qsl(parsed.query, keep_blank_values=True):
        lower_key = key.lower()
        if lower_key in tracking_params or lower_key.startswith(tracking_prefixes):
            continue
        kept_query.append((key, value))

    scheme = parsed.scheme.lower()
    hostname = (parsed.hostname or "").lower()
    if hostname.startswith("www."):
        hostname = hostname[4:]
    try:
        port = parsed.port
    except ValueError:
        port = None
    include_port = port and not ((scheme == "http" and port == 80) or (scheme == "https" and port == 443))
    netloc = f"{hostname}:{port}" if include_port else hostname

    # Title is not a safe duplicate key, and URL paths/query values can be
    # case-sensitive. Normalize only safe URL parts; keep meaningful casing.
    path = parsed.path.rstrip("/") if parsed.path != "/" else ""
    query = urlencode(kept_query, doseq=True)
    return urlunparse((scheme, netloc, path, "", query, ""))


def normalize_title_key(title):
    title = clean_title_for_message(title)
    title = normalize_text(title)
    title = re.sub(r"[^a-zA-Z0-9əöğüçıƏÖĞÜÇŞşİı\s]", " ", title)
    title = re.sub(r"\s+", " ", title).strip()
    return title


def load_json_file(path, default):
    try:
        with open(path, "r", encoding="utf-8") as file:
            return json.load(file)
    except Exception:
        return default


def load_patterns():
    return load_json_file(PATTERNS_FILE, {})


def load_health():
    return load_json_file(HEALTH_FILE, {})


def save_health(data):
    try:
        with open(HEALTH_FILE, "w", encoding="utf-8") as file:
            json.dump(data, file, ensure_ascii=False, indent=2)
    except Exception as exc:
        print("Health save xətası:", exc, flush=True)


def update_site_health(domain, status):
    health = load_health()
    if domain not in health:
        health[domain] = {
            "checked": 0,
            "success": 0,
            "no_candidate": 0,
            "error": 0,
            "last_check": None,
        }
    health[domain]["checked"] += 1
    health[domain]["last_check"] = datetime.now(BAKU_TZ).isoformat()
    if status in health[domain]:
        health[domain][status] += 1
    save_health(health)



def update_source_health(site, result):
    if not SOURCE_HEALTH_ENABLED or not supabase_ready():
        return

    source_id = site.get("id")
    if not source_id:
        return

    now = datetime.now(BAKU_TZ).isoformat()
    payload, reason, hard_fail_reasons = build_source_health_payload(site, result, now)

    if reason in hard_fail_reasons:
        try:
            response = requests.post(
                f"{SUPABASE_URL}/rest/v1/rpc/increment_source_fail",
                headers=supabase_headers(),
                json={"p_source_id": source_id, "p_reason": reason},
                timeout=REQUEST_TIMEOUT,
            )
            if response.status_code not in {200, 204}:
                print(f"Source fail saygac xetasi: {response.status_code} | {response.text[:200]}", flush=True)
        except Exception as exc:
            print(f"Source fail saygac istisnasi: {exc}", flush=True)

    if patch_source_health(source_id, payload):
        site["last_checked_at"] = payload.get("last_checked_at")
        site["last_result"] = payload.get("last_result")
        site["last_error"] = payload.get("last_error")
        site["notes"] = payload.get("notes")
        if "last_success_at" in payload:
            site["last_success_at"] = payload.get("last_success_at")
        if "last_article_found_at" in payload:
            site["last_article_found_at"] = payload.get("last_article_found_at")
        if "consecutive_fail_count" in payload:
            site["consecutive_fail_count"] = payload.get("consecutive_fail_count")

def parse_telegram_response(response):
    status_code = getattr(response, "status_code", 0) or 0
    data = {}
    try:
        data = response.json() or {}
    except Exception:
        data = {}

    parameters = data.get("parameters") or {}
    description = clean_text(data.get("description") or getattr(response, "text", ""))
    description_lower = description.lower()
    try:
        retry_after = int(parameters.get("retry_after") or 0)
    except (TypeError, ValueError):
        retry_after = 0
    result = {
        "ok": status_code == 200,
        "status_code": status_code,
        "reason": "",
        "retry_after": retry_after,
        "migrate_to_chat_id": clean_text(parameters.get("migrate_to_chat_id")),
        "description": description,
    }

    if status_code == 200:
        return result
    if status_code == 429:
        result["reason"] = "telegram_429"
        if result["retry_after"] <= 0:
            result["retry_after"] = 30
        return result
    if result["migrate_to_chat_id"] or "migrate_to_chat_id" in description_lower:
        result["reason"] = "chat_migrated"
        return result
    if status_code == 403:
        if "bot was blocked" in description_lower or "blocked by the user" in description_lower:
            result["reason"] = "bot_blocked"
        else:
            result["reason"] = "forbidden"
        return result
    if status_code == 400:
        if "chat not found" in description_lower:
            result["reason"] = "chat_not_found"
        else:
            result["reason"] = "bad_request"
        return result

    result["reason"] = "bad_request" if 400 <= status_code < 500 else "network_error"
    return result


def notifications_paused():
    """Admin-controlled global pause (bot_settings.notifications_paused), cached."""
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        return False
    with BOT_SETTINGS_LOCK:
        if time.time() - BOT_SETTINGS_CACHE["fetched_at"] < BOT_SETTINGS_CACHE_SECONDS:
            return BOT_SETTINGS_CACHE["paused"]
        BOT_SETTINGS_CACHE["fetched_at"] = time.time()
        try:
            response = requests.get(
                f"{SUPABASE_URL}/rest/v1/bot_settings",
                headers=supabase_headers(),
                params={"select": "notifications_paused", "id": "eq.1", "limit": "1"},
                timeout=REQUEST_TIMEOUT,
            )
            if response.status_code == 200:
                rows = response.json() or []
                BOT_SETTINGS_CACHE["paused"] = bool(rows and rows[0].get("notifications_paused"))
            else:
                # Keep the last known value (False until the migration is applied).
                print(f"bot_settings oxunmadi: {response.status_code} | {response.text[:160]}", flush=True)
        except Exception as exc:
            print(f"bot_settings istisnasi: {redact_secrets(exc)}", flush=True)
        return BOT_SETTINGS_CACHE["paused"]


def send_telegram(message, chat_id=None, bypass_pause=False):
    global TELEGRAM_LAST_ERROR
    TELEGRAM_LAST_ERROR = ""
    target_chat_id = clean_text(chat_id or CHAT_ID)
    if DISABLE_TELEGRAM_SEND:
        TELEGRAM_LAST_ERROR = "telegram_disabled"
        print("Telegram send disabled by DISABLE_TELEGRAM_SEND; message skipped safely.", flush=True)
        return False
    if not bypass_pause and notifications_paused():
        TELEGRAM_LAST_ERROR = "telegram_disabled"
        print("Telegram bildirişləri admin tərəfindən dayandırılıb; mesaj göndərilmədi.", flush=True)
        return False
    if not BOT_TOKEN or not target_chat_id:
        TELEGRAM_LAST_ERROR = "bad_request"
        print("BOT_TOKEN və ya CHAT_ID yoxdur.", flush=True)
        return False

    url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
    payload = {
        "chat_id": target_chat_id,
        "text": message,
        "disable_web_page_preview": False,
    }

    for attempt in range(2):
        try:
            with TELEGRAM_LOCK:
                response = requests.post(url, data=payload, timeout=15)
        except Exception as exc:
            TELEGRAM_LAST_ERROR = "network_error"
            record_telegram_error("send:network_error")
            print(f"Telegram network_error: chat={target_chat_id} | {redact_secrets(exc)}", flush=True)
            return False

        parsed = parse_telegram_response(response)
        print(f"Telegram: {parsed['status_code']} | reason={parsed['reason'] or 'sent'}", flush=True)
        if parsed["ok"]:
            TELEGRAM_LAST_ERROR = ""
            TELEGRAM_HEARTBEAT["last_send_ok_at"] = datetime.now(BAKU_TZ).isoformat()
            return True

        TELEGRAM_LAST_ERROR = parsed["reason"] or "network_error"
        record_telegram_error(f"send:{TELEGRAM_LAST_ERROR}")
        print(f"Telegram cavabi: {parsed['description'][:500]}", flush=True)

        if TELEGRAM_LAST_ERROR == "chat_migrated":
            print(
                f"Telegram chat_migrated: old_chat={target_chat_id} | "
                f"new_chat={parsed.get('migrate_to_chat_id') or 'unknown'}",
                flush=True,
            )

        if TELEGRAM_LAST_ERROR == "telegram_429" and attempt == 0:
            retry_after = max(1, min(parsed.get("retry_after") or 30, 120))
            print(f"Telegram 429 retry_after={retry_after}s | eyni mesaj bir dəfə təkrar göndəriləcək.", flush=True)
            time.sleep(retry_after)
            continue
        return False

    return False


TELEGRAM_UUID_RE = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")
TELEGRAM_LINK_TOKEN_RE = re.compile(r"[0-9a-f]{32}")
TELEGRAM_REPLY_LINKED = "Telegram bildirişləri aktiv edildi. Dayandırmaq üçün /stop yazın."
TELEGRAM_REPLY_LINK_INVALID = "Link etibarsızdır. Profil səhifəsində «Telegram-ı qoş» ilə yeni link yaradın."
TELEGRAM_REPLY_LINK_EXPIRED = "Linkin vaxtı bitib. Profil səhifəsindən yeni link yaradın."
TELEGRAM_REPLY_LINK_USED = "Bu link artıq istifadə olunub. Profil səhifəsindən yeni link yaradın."
TELEGRAM_REPLY_ERROR = "Əməliyyat alınmadı. Bir az sonra yenidən cəhd edin."
TELEGRAM_REPLY_STOPPED = "Telegram bildirişləri dayandırıldı. Yenidən qoşmaq üçün bu çatda /start yazın."
TELEGRAM_REPLY_NOT_LINKED = "Bu çat heç bir hesaba qoşulmayıb."
TELEGRAM_REPLY_ALREADY_LINKED = "Bu çat artıq hesaba qoşulub. Vəziyyət üçün /status yazın."
TELEGRAM_REPLY_PAUSED = "Bildirişlər müvəqqəti dayandırıldı. Yenidən açmaq üçün /resume yazın."
TELEGRAM_REPLY_RESUMED = "Bildirişlər yenidən açıldı."
TELEGRAM_REPLY_NO_KEYWORDS = "Bu hesabda açar söz yoxdur. Açar sözləri saytda əlavə edə bilərsiniz."
TELEGRAM_REPLY_ADMIN_ONLY = "Bu əmr yalnız adminlər üçündür."
TELEGRAM_REPLY_ALL_PAUSED = "Bütün müştəri bildirişləri dayandırıldı. Açmaq üçün /resume_all yazın."
TELEGRAM_REPLY_ALL_RESUMED = "Bütün müştəri bildirişləri yenidən açıldı."
# (command, description) pairs: the "/" menu in Telegram and the /help text.
TELEGRAM_CUSTOMER_COMMANDS = [
    ("status", "Qoşulma vəziyyəti"),
    ("keywords", "Açar sözlərim"),
    ("pause", "Bildirişləri müvəqqəti dayandır"),
    ("resume", "Bildirişləri yenidən aç"),
    ("stop", "Telegram-ı hesabdan ayır"),
    ("help", "Kömək"),
]
TELEGRAM_ADMIN_COMMANDS = [
    ("stats", "Admin: ümumi statistika"),
    ("errors", "Admin: xətalı mənbələr"),
    ("pause_all", "Admin: bütün bildirişləri dayandır"),
    ("resume_all", "Admin: bütün bildirişləri aç"),
]
TELEGRAM_COMMAND_MENU_REFRESH_SECONDS = 3600


def telegram_help_text(is_admin=False):
    commands = TELEGRAM_CUSTOMER_COMMANDS + (TELEGRAM_ADMIN_COMMANDS if is_admin else [])
    lines = ["Vizual bot əmrləri:"] + [f"/{name} - {description}" for name, description in commands]
    lines.append("Qoşulmaq üçün profil səhifəsində «Telegram-ı qoş» düyməsini basın.")
    return "\n".join(lines)


TELEGRAM_REPLY_HELP = telegram_help_text()


def runtime_state_table_missing(response):
    if response.status_code == 404:
        return True
    return any(code in (response.text or "") for code in ("42P01", "PGRST205"))


def load_runtime_state(key):
    """Returns (ok, value). ok=False when bot_runtime_state can't be read."""
    global RUNTIME_STATE_TABLE_AVAILABLE
    if not RUNTIME_STATE_TABLE_AVAILABLE or not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        return False, None
    try:
        response = requests.get(
            f"{SUPABASE_URL}/rest/v1/bot_runtime_state",
            headers=supabase_headers(),
            params={"select": "value", "key": f"eq.{key}", "limit": "1"},
            timeout=REQUEST_TIMEOUT,
        )
    except Exception as exc:
        print(f"bot_runtime_state oxuma istisnasi: {redact_secrets(exc)}", flush=True)
        return False, None
    if response.status_code == 200:
        rows = response.json() or []
        return True, (rows[0].get("value") if rows else None)
    if runtime_state_table_missing(response):
        RUNTIME_STATE_TABLE_AVAILABLE = False
        print("bot_runtime_state cədvəli yoxdur; lokal fayl istifadə olunur.", flush=True)
    else:
        print(f"bot_runtime_state oxuma xetasi: {response.status_code} | {response.text[:160]}", flush=True)
    return False, None


def save_runtime_state(key, value):
    global RUNTIME_STATE_TABLE_AVAILABLE
    if not RUNTIME_STATE_TABLE_AVAILABLE or not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        return False
    try:
        response = requests.post(
            f"{SUPABASE_URL}/rest/v1/bot_runtime_state",
            headers=supabase_headers({"Prefer": "resolution=merge-duplicates,return=minimal"}),
            json={"key": key, "value": value, "updated_at": datetime.now(BAKU_TZ).isoformat()},
            timeout=REQUEST_TIMEOUT,
        )
    except Exception as exc:
        print(f"bot_runtime_state yazma istisnasi: {redact_secrets(exc)}", flush=True)
        return False
    if response.status_code in (200, 201, 204):
        return True
    if runtime_state_table_missing(response):
        RUNTIME_STATE_TABLE_AVAILABLE = False
        print("bot_runtime_state cədvəli yoxdur; lokal fayl istifadə olunur.", flush=True)
    else:
        print(f"bot_runtime_state yazma xetasi: {response.status_code} | {response.text[:160]}", flush=True)
    return False


def load_telegram_offset():
    ok, value = load_runtime_state("telegram_offset")
    if ok and isinstance(value, dict):
        try:
            return int(value.get("offset", 0))
        except (TypeError, ValueError):
            return 0
    # Table missing, unreadable, or no row yet (first run after migration).
    try:
        if not os.path.exists(TELEGRAM_OFFSET_FILE):
            return 0
        with open(TELEGRAM_OFFSET_FILE, "r", encoding="utf-8") as fh:
            return int((json.load(fh) or {}).get("offset", 0))
    except Exception:
        return 0


def save_telegram_offset(offset):
    if save_runtime_state("telegram_offset", {"offset": offset}):
        return
    try:
        with open(TELEGRAM_OFFSET_FILE, "w", encoding="utf-8") as fh:
            json.dump({"offset": offset}, fh)
    except Exception as exc:
        print(f"Telegram offset yazilmadi: {exc}", flush=True)


def save_telegram_heartbeat():
    if not TELEGRAM_HEARTBEAT["loaded"]:
        # Keep last_send_ok_at / last_error across worker restarts.
        ok, previous = load_runtime_state("telegram_heartbeat")
        if ok and isinstance(previous, dict):
            for field in ("last_error", "last_error_at", "last_send_ok_at", "last_poll_ok_at"):
                if TELEGRAM_HEARTBEAT.get(field) is None and previous.get(field):
                    TELEGRAM_HEARTBEAT[field] = previous.get(field)
        TELEGRAM_HEARTBEAT["loaded"] = True
    save_runtime_state(
        "telegram_heartbeat",
        {
            field: TELEGRAM_HEARTBEAT.get(field)
            for field in ("last_poll_at", "last_poll_ok_at", "last_error", "last_error_at", "last_send_ok_at")
        },
    )


def record_telegram_error(error):
    TELEGRAM_HEARTBEAT["last_error"] = error
    TELEGRAM_HEARTBEAT["last_error_at"] = datetime.now(BAKU_TZ).isoformat()


def find_users_by_telegram_chat(chat_id):
    response = requests.get(
        f"{SUPABASE_URL}/rest/v1/user_profiles",
        headers=supabase_headers(),
        params={"select": "user_id", "telegram_chat_id": f"eq.{chat_id}", "limit": "50"},
        timeout=REQUEST_TIMEOUT,
    )
    if response.status_code != 200:
        raise RuntimeError(f"user_profiles:{response.status_code}:{response.text[:160]}")
    return [row.get("user_id") for row in (response.json() or []) if row.get("user_id")]


def redeem_telegram_link_token(token, chat_id):
    now_iso = datetime.now(BAKU_TZ).isoformat()
    response = requests.get(
        f"{SUPABASE_URL}/rest/v1/telegram_link_tokens",
        headers=supabase_headers(),
        params={"select": "user_id,expires_at,used_at", "token": f"eq.{token}", "limit": "1"},
        timeout=REQUEST_TIMEOUT,
    )
    if response.status_code != 200:
        print(f"Telegram link token oxuma xetasi: {response.status_code} | {response.text[:160]}", flush=True)
        return TELEGRAM_REPLY_ERROR
    rows = response.json() or []
    if not rows:
        return TELEGRAM_REPLY_LINK_INVALID
    row = rows[0]
    if row.get("used_at"):
        return TELEGRAM_REPLY_LINK_USED
    expires_at = parse_baku_datetime(row.get("expires_at"))
    if not expires_at or expires_at <= datetime.now(BAKU_TZ):
        return TELEGRAM_REPLY_LINK_EXPIRED

    # Conditional update = atomic claim: a second chat racing on the same token gets no row back.
    claim = requests.patch(
        f"{SUPABASE_URL}/rest/v1/telegram_link_tokens",
        headers=supabase_headers({"Prefer": "return=representation"}),
        params={"token": f"eq.{token}", "used_at": "is.null", "expires_at": f"gt.{now_iso}"},
        json={"used_at": now_iso, "chat_id": chat_id},
        timeout=REQUEST_TIMEOUT,
    )
    if claim.status_code != 200 or not (claim.json() or []):
        return TELEGRAM_REPLY_LINK_USED

    user_id = row.get("user_id")
    connected, reason = enable_user_telegram_subscription(user_id, chat_id)
    if not connected:
        print(f"Telegram profil/monitor yazma xetasi: {reason}", flush=True)
        requests.patch(
            f"{SUPABASE_URL}/rest/v1/telegram_link_tokens",
            headers=supabase_headers({"Prefer": "return=minimal"}),
            params={"token": f"eq.{token}"},
            json={"used_at": None, "chat_id": None},
            timeout=REQUEST_TIMEOUT,
        )
        return TELEGRAM_REPLY_ERROR
    print(f"Telegram profil ve monitorlar baglandi (token): user={user_id}", flush=True)
    return TELEGRAM_REPLY_LINKED


def relink_previous_chat(chat_id):
    """Plain /start from a chat that was linked before (and unlinked) turns its alerts back on."""
    if find_users_by_telegram_chat(chat_id):
        return TELEGRAM_REPLY_ALREADY_LINKED
    response = requests.get(
        f"{SUPABASE_URL}/rest/v1/user_profiles",
        headers=supabase_headers(),
        params={
            "select": "user_id",
            "last_telegram_chat_id": f"eq.{chat_id}",
            "telegram_chat_id": "is.null",
            "limit": "50",
        },
        timeout=REQUEST_TIMEOUT,
    )
    # 400 until the last_telegram_chat_id migration is applied: behave like before.
    user_ids = [row.get("user_id") for row in (response.json() or [])] if response.status_code == 200 else []
    user_ids = [user_id for user_id in user_ids if user_id]
    if not user_ids:
        return TELEGRAM_REPLY_HELP
    for user_id in user_ids:
        connected, reason = enable_user_telegram_subscription(user_id, chat_id)
        if not connected:
            print(f"Telegram profil/monitor yazma xetasi: {reason}", flush=True)
            return TELEGRAM_REPLY_ERROR
    print(f"Telegram çat yenidən bağlandı (/start): users={len(user_ids)}", flush=True)
    return TELEGRAM_REPLY_LINKED


def link_telegram_chat(payload, chat_id):
    if TELEGRAM_UUID_RE.fullmatch(payload):
        if not TELEGRAM_ALLOW_LEGACY_UUID_LINK:
            print("Telegram legacy UUID link rədd edildi.", flush=True)
            return TELEGRAM_REPLY_LINK_INVALID
        connected, reason = enable_user_telegram_subscription(payload, chat_id)
        if not connected:
            print(f"Telegram profil/monitor yazma xetasi: {reason}", flush=True)
            return TELEGRAM_REPLY_ERROR
        print(f"Telegram profil ve monitorlar baglandi (legacy UUID): user={payload}", flush=True)
        return TELEGRAM_REPLY_LINKED
    if not TELEGRAM_LINK_TOKEN_RE.fullmatch(payload):
        return TELEGRAM_REPLY_LINK_INVALID
    return redeem_telegram_link_token(payload, chat_id)


def unlink_telegram_chat(chat_id):
    user_ids = find_users_by_telegram_chat(chat_id)
    monitors_response = requests.patch(
        f"{SUPABASE_URL}/rest/v1/user_monitors",
        headers=supabase_headers({"Prefer": "return=representation"}),
        params={"telegram_chat_id": f"eq.{chat_id}", "select": "id"},
        json={"notify_telegram": False},
        timeout=REQUEST_TIMEOUT,
    )
    if monitors_response.status_code != 200:
        raise RuntimeError(f"monitors:{monitors_response.status_code}:{monitors_response.text[:160]}")
    monitors_updated = len(monitors_response.json() or [])
    if not user_ids and not monitors_updated:
        return TELEGRAM_REPLY_NOT_LINKED

    profile_response = requests.patch(
        f"{SUPABASE_URL}/rest/v1/user_profiles",
        headers=supabase_headers({"Prefer": "return=minimal"}),
        params={"telegram_chat_id": f"eq.{chat_id}"},
        json={"telegram_chat_id": None, "updated_at": datetime.now(BAKU_TZ).isoformat()},
        timeout=REQUEST_TIMEOUT,
    )
    if profile_response.status_code not in (200, 204):
        raise RuntimeError(f"profile:{profile_response.status_code}:{profile_response.text[:160]}")
    for user_id, cached_chat_id in list(USER_TELEGRAM_CACHE.items()):
        if cached_chat_id == chat_id:
            USER_TELEGRAM_CACHE.pop(user_id, None)
    print(f"Telegram çat ayrıldı: users={len(user_ids)} | monitors={monitors_updated}", flush=True)
    return TELEGRAM_REPLY_STOPPED


def find_user_keywords(user_ids):
    """Keywords of the users' monitors that are not archived (one per customer)."""
    response = requests.get(
        f"{SUPABASE_URL}/rest/v1/monitor_keywords",
        headers=supabase_headers(),
        params={
            "select": "*,user_monitors!inner(user_id,status,notify_telegram)",
            "user_monitors.user_id": f"in.({','.join(user_ids)})",
            "user_monitors.status": "neq.archived",
            "order": "created_at",
            "limit": "1000",
        },
        timeout=REQUEST_TIMEOUT,
    )
    if response.status_code != 200:
        raise RuntimeError(f"keywords:{response.status_code}:{response.text[:160]}")
    return response.json() or []


def keyword_is_active(row):
    monitor = row.get("user_monitors") or {}
    return monitor.get("status") == "active" and row.get("status", "active") != "paused"


def telegram_chat_status(chat_id):
    user_ids = find_users_by_telegram_chat(chat_id)
    if not user_ids:
        return TELEGRAM_REPLY_NOT_LINKED
    active = [row for row in find_user_keywords(user_ids) if keyword_is_active(row)]
    return f"Çat qoşulub. Aktiv açar söz sayı: {len(active)}."


def telegram_keyword_list(chat_id):
    user_ids = find_users_by_telegram_chat(chat_id)
    if not user_ids:
        return TELEGRAM_REPLY_NOT_LINKED
    rows = [row for row in find_user_keywords(user_ids) if clean_text(row.get("keyword"))]
    if not rows:
        return TELEGRAM_REPLY_NO_KEYWORDS
    lines = ["Açar sözləriniz:"]
    for row in rows[:50]:
        state = "" if keyword_is_active(row) else " (dayandırılıb)"
        lines.append(f"• {clean_text(row.get('keyword'))}{state}")
    if len(rows) > 50:
        lines.append(f"və daha {len(rows) - 50}")
    if any((row.get("user_monitors") or {}).get("notify_telegram") is False for row in rows):
        lines.append("\nTelegram bildirişləri dayandırılıb. Açmaq üçün /resume yazın.")
    return "\n".join(lines)


def set_chat_notifications(chat_id, enabled):
    user_ids = find_users_by_telegram_chat(chat_id)
    if not user_ids:
        return TELEGRAM_REPLY_NOT_LINKED
    response = requests.patch(
        f"{SUPABASE_URL}/rest/v1/user_monitors",
        headers=supabase_headers({"Prefer": "return=minimal"}),
        params={"user_id": f"in.({','.join(user_ids)})"},
        json={"notify_telegram": enabled, "telegram_chat_id": chat_id},
        timeout=REQUEST_TIMEOUT,
    )
    if response.status_code not in (200, 204):
        raise RuntimeError(f"monitors:{response.status_code}:{response.text[:160]}")
    return TELEGRAM_REPLY_RESUMED if enabled else TELEGRAM_REPLY_PAUSED


def is_admin_chat(chat_id):
    user_ids = find_users_by_telegram_chat(chat_id)
    if not user_ids:
        return False
    response = requests.get(
        f"{SUPABASE_URL}/rest/v1/admin_users",
        headers=supabase_headers(),
        params={"select": "user_id", "user_id": f"in.({','.join(user_ids)})", "status": "eq.active", "limit": "1"},
        timeout=REQUEST_TIMEOUT,
    )
    if response.status_code != 200:
        raise RuntimeError(f"admin_users:{response.status_code}:{response.text[:160]}")
    return bool(response.json())


def admin_chat_ids():
    response = requests.get(
        f"{SUPABASE_URL}/rest/v1/admin_users",
        headers=supabase_headers(),
        params={"select": "user_id", "status": "eq.active", "limit": "100"},
        timeout=REQUEST_TIMEOUT,
    )
    if response.status_code != 200:
        raise RuntimeError(f"admin_users:{response.status_code}:{response.text[:160]}")
    user_ids = [row.get("user_id") for row in response.json() or [] if row.get("user_id")]
    if not user_ids:
        return []
    profiles = requests.get(
        f"{SUPABASE_URL}/rest/v1/user_profiles",
        headers=supabase_headers(),
        params={"select": "telegram_chat_id", "user_id": f"in.({','.join(user_ids)})", "telegram_chat_id": "not.is.null"},
        timeout=REQUEST_TIMEOUT,
    )
    if profiles.status_code != 200:
        raise RuntimeError(f"user_profiles:{profiles.status_code}:{profiles.text[:160]}")
    return sorted({clean_text(row.get("telegram_chat_id")) for row in profiles.json() or [] if row.get("telegram_chat_id")})


def count_rows(table, params):
    response = requests.get(
        f"{SUPABASE_URL}/rest/v1/{table}",
        headers=supabase_headers({"Prefer": "count=exact"}),
        params={"select": "*", "limit": "1", **params},
        timeout=REQUEST_TIMEOUT,
    )
    if response.status_code not in (200, 206):
        raise RuntimeError(f"{table}:{response.status_code}:{response.text[:160]}")
    total = (response.headers.get("Content-Range") or "").rsplit("/", 1)[-1]
    return int(total) if total.isdigit() else 0


def telegram_admin_stats():
    since = (datetime.now(BAKU_TZ) - timedelta(hours=24)).isoformat()
    lines = [
        "Vizual statistika:",
        f"İstifadəçi: {count_rows('user_profiles', {})}",
        f"Açar söz: {count_rows('monitor_keywords', {})}",
        f"Aktiv mənbə: {count_rows('sources', {'status': 'eq.active'})}",
        f"Xətalı mənbə (3+ uğursuz oxu): {count_rows('sources', {'status': 'eq.active', 'consecutive_fail_count': 'gte.3'})}",
        f"Son 24 saatda yığılan xəbər: {count_rows('monitored_items', {'created_at': f'gte.{since}'})}",
        f"Son 24 saatda göndərilən bildiriş: {count_rows('monitor_alerts', {'sent_at': f'gte.{since}'})}",
        f"Bildirişlər: {'dayandırılıb' if notifications_paused() else 'aktiv'}",
    ]
    last_send = TELEGRAM_HEARTBEAT.get("last_send_ok_at")
    if last_send:
        lines.append(f"Son uğurlu göndəriş: {last_send[:16].replace('T', ' ')}")
    return "\n".join(lines)


def telegram_admin_errors():
    response = requests.get(
        f"{SUPABASE_URL}/rest/v1/sources",
        headers=supabase_headers(),
        params={
            "select": "name,consecutive_fail_count,last_error",
            "status": "eq.active",
            "consecutive_fail_count": "gte.3",
            "order": "consecutive_fail_count.desc",
            "limit": "15",
        },
        timeout=REQUEST_TIMEOUT,
    )
    if response.status_code != 200:
        raise RuntimeError(f"sources:{response.status_code}:{response.text[:160]}")
    rows = response.json() or []
    if not rows:
        return "Xətalı mənbə yoxdur."
    lines = ["Ən çox uğursuz oxunan mənbələr:"]
    for row in rows:
        error = clean_text(row.get("last_error"))[:80] or "-"
        lines.append(f"• {clean_text(row.get('name'))}: {row.get('consecutive_fail_count')} dəfə | {error}")
    return "\n".join(lines)


def set_global_pause(paused):
    response = requests.patch(
        f"{SUPABASE_URL}/rest/v1/bot_settings",
        headers=supabase_headers({"Prefer": "return=minimal"}),
        params={"id": "eq.1"},
        json={"notifications_paused": paused},
        timeout=REQUEST_TIMEOUT,
    )
    if response.status_code not in (200, 204):
        raise RuntimeError(f"bot_settings:{response.status_code}:{response.text[:160]}")
    with BOT_SETTINGS_LOCK:
        BOT_SETTINGS_CACHE["paused"] = paused
        BOT_SETTINGS_CACHE["fetched_at"] = time.time()
    print(f"Telegram: admin bildirişləri {'dayandırdı' if paused else 'açdı'}", flush=True)
    return TELEGRAM_REPLY_ALL_PAUSED if paused else TELEGRAM_REPLY_ALL_RESUMED


TELEGRAM_ADMIN_HANDLERS = {
    "/stats": telegram_admin_stats,
    "/errors": telegram_admin_errors,
    "/pause_all": lambda: set_global_pause(True),
    "/resume_all": lambda: set_global_pause(False),
}


def handle_telegram_command(text, chat_id):
    parts = text.split(maxsplit=1)
    command = parts[0].split("@", 1)[0].lower()
    payload = parts[1].strip() if len(parts) > 1 else ""
    if command == "/start" and payload:
        return link_telegram_chat(payload, chat_id)
    if command == "/start":
        return relink_previous_chat(chat_id)
    if command == "/stop":
        return unlink_telegram_chat(chat_id)
    if command == "/status":
        return telegram_chat_status(chat_id)
    if command in ("/keywords", "/monitors"):
        return telegram_keyword_list(chat_id)
    if command == "/pause":
        return set_chat_notifications(chat_id, False)
    if command == "/resume":
        return set_chat_notifications(chat_id, True)
    if command in TELEGRAM_ADMIN_HANDLERS:
        if not is_admin_chat(chat_id):
            return TELEGRAM_REPLY_ADMIN_ONLY
        return TELEGRAM_ADMIN_HANDLERS[command]()
    return telegram_help_text(is_admin=is_admin_chat(chat_id))


def telegram_bot_api(method, payload):
    response = requests.post(f"https://api.telegram.org/bot{BOT_TOKEN}/{method}", json=payload, timeout=REQUEST_TIMEOUT)
    if response.status_code != 200:
        print(f"Telegram {method} xetasi: {response.status_code} | {redact_secrets(response.text[:200])}", flush=True)
        return False
    return True


def register_telegram_command_menu():
    """Fills Telegram's "/" menu: customer commands for everyone, admin commands only in admin chats."""
    if not BOT_TOKEN or not supabase_ready():
        return
    customer = [{"command": name, "description": text} for name, text in TELEGRAM_CUSTOMER_COMMANDS]
    admin = customer + [{"command": name, "description": text} for name, text in TELEGRAM_ADMIN_COMMANDS]
    try:
        telegram_bot_api("setMyCommands", {"commands": customer})
        for chat_id in admin_chat_ids():
            telegram_bot_api("setMyCommands", {"commands": admin, "scope": {"type": "chat", "chat_id": chat_id}})
    except Exception as exc:
        print(f"Telegram əmr menyusu yazılmadı: {redact_secrets(exc)}", flush=True)


def connect_telegram_users_from_updates(poll_seconds=0):
    if not BOT_TOKEN or not supabase_ready():
        return
    try:
        response = requests.get(
            f"https://api.telegram.org/bot{BOT_TOKEN}/getUpdates",
            params={"offset": load_telegram_offset(), "timeout": poll_seconds, "allowed_updates": json.dumps(["message"])},
            timeout=REQUEST_TIMEOUT + poll_seconds,
        )
        TELEGRAM_HEARTBEAT["last_poll_at"] = datetime.now(BAKU_TZ).isoformat()
        if response.status_code != 200:
            record_telegram_error(f"poll:{response.status_code}")
            print(f"Telegram getUpdates xetasi: {response.status_code} | {redact_secrets(response.text[:200])}", flush=True)
            return
        # The admin page treats a poll error older than this as resolved.
        TELEGRAM_HEARTBEAT["last_poll_ok_at"] = TELEGRAM_HEARTBEAT["last_poll_at"]
        updates = response.json().get("result", []) or []
        next_offset = None
        for update in updates:
            update_id = update.get("update_id")
            if update_id is not None:
                next_offset = max(next_offset or 0, update_id + 1)
            message = update.get("message") or {}
            text = clean_text(message.get("text"))
            chat_id = clean_text((message.get("chat") or {}).get("id"))
            if not text.startswith("/") or not chat_id:
                continue
            try:
                reply = handle_telegram_command(text, chat_id)
            except Exception as exc:
                print(f"Telegram əmr xetasi: {redact_secrets(exc)}", flush=True)
                reply = TELEGRAM_REPLY_ERROR
            # Command replies are not customer alerts: they ignore the admin pause.
            send_telegram(reply, chat_id=chat_id, bypass_pause=True)
        if next_offset is not None:
            save_telegram_offset(next_offset)
    except Exception as exc:
        record_telegram_error("poll:exception")
        print(f"Telegram connect istisnasi: {redact_secrets(exc)}", flush=True)
    finally:
        save_telegram_heartbeat()


def telegram_command_loop():
    """Long-polls bot commands so replies don't wait for a full news cycle."""
    menu_refreshed_at = 0.0
    while True:
        if time.time() - menu_refreshed_at > TELEGRAM_COMMAND_MENU_REFRESH_SECONDS:
            register_telegram_command_menu()
            menu_refreshed_at = time.time()
        started = time.time()
        connect_telegram_users_from_updates(poll_seconds=25)
        if time.time() - started < 1:
            time.sleep(5)  # errors return immediately; don't hammer the API


def strip_inline_html(text):
    value = unescape(str(text or ""))
    if "<" not in value or ">" not in value:
        return value
    try:
        return BeautifulSoup(value, "html.parser").get_text(" ", strip=True)
    except Exception:
        return re.sub(r"<[^>]+>", " ", value)


def title_from_url_slug(url):
    try:
        parsed = urlparse(str(url or ""))
    except Exception:
        return ""
    parts = [part for part in parsed.path.split("/") if part]
    if not parts:
        return ""
    slug = unquote(parts[-1])
    slug = re.sub(r"\.(?:html?|php|aspx?)$", "", slug, flags=re.IGNORECASE)
    if re.fullmatch(r"\d+", slug) and len(parts) > 1 and "-" in parts[-2]:
        # /slug-words/147723 -> the readable slug is the previous segment
        slug = re.sub(r"\.(?:html?|php|aspx?)$", "", unquote(parts[-2]), flags=re.IGNORECASE)
    slug = re.sub(r"(?:^|[-_])[A-Za-z]?\d{4,}(?:$|[-_])", " ", slug)
    slug = re.sub(r"[-_]+", " ", slug)
    return clean_article_text(slug)


def title_is_probably_corrupt(title):
    value = str(title or "")
    if not value:
        return False
    if "<" in value and ">" in value:
        return True
    if "â€¦" in value:  # mojibake of "…"; a real ellipsis is a legitimate headline ending
        return True
    if mojibake_score(value) >= max(8, len(value) // 7):
        return True
    return bool(re.search(r"(?:[Gg][\u00b3\u00ba\u00be]|[Nn][\u00d1]|\.{2,}\s*[ÃÐÑÒÓÔÕ]|[îôñßÕõ])", value))


def title_looks_like_url(title):
    value = clean_text(title)
    if not value:
        return False
    if re.match(r"^https?://", value, flags=re.IGNORECASE):
        return True
    return bool(re.fullmatch(r"(?:www\.)?[\w.-]+\.[a-z]{2,}(?:/[^\s]*)?", value, flags=re.IGNORECASE))


def title_has_site_suffix(title):
    value = clean_text(title)
    if not value:
        return False
    separator = r"(?:[-\u2013\u2014|:\u2022\u00bb]+)"
    if re.search(rf"\s*{separator}\s*(?:www\.)?[A-Za-z0-9_-]+\.(?:az|com|net|org|info|ws|media)\b", value, flags=re.IGNORECASE):
        return True
    return bool(re.search(rf"\s*{separator}\s*[^-|\u2013\u2014:]{{0,90}}(?:x[eə]b[eə]r\s+sayt[ıi]|x[eə]b[eə]rl[eə]r|son\s+x[eə]b[eə]rl[eə]r)\b", value, flags=re.IGNORECASE))


def clean_title_for_message(title):
    title = strip_inline_html(title)
    title = clean_article_text(title)
    if not title:
        return ""

    separators = r"[-\u2013\u2014|:\u2022\u00bb]+"
    edge_chars = " \t\n\r-\u2013\u2014|:\u2022\u00bb"
    category_group = r"(?:" + "|".join(re.escape(c) for c in sorted(NEWS_CATEGORIES, key=len, reverse=True)) + r")"
    noise_group = r"(?:" + "|".join(re.escape(c) for c in sorted(TITLE_NOISE_LABELS, key=len, reverse=True)) + r")"
    az_months = r"yanvar|fevral|mart|aprel|may|iyun|İyun|iyul|İyul|avqust|sentyabr|oktyabr|noyabr|dekabr|jan|january|feb|february|mar|march|apr|april|jun|june|jul|july|aug|august|sep|september|oct|october|nov|november|dec|december|января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря"

    title = re.sub(r"\s+", " ", title).strip(edge_chars)

    for _ in range(4):
        before = title
        title = re.sub(rf"^\s*{category_group}\s+\d{{1,2}}[:.]\d{{2}}\s+", "", title, flags=re.IGNORECASE)
        title = re.sub(rf"^\s*{category_group}\s*(?:{separators}|/)\s*", "", title, flags=re.IGNORECASE)
        title = re.sub(rf"^\s*{noise_group}\s*(?:{separators})\s*", "", title, flags=re.IGNORECASE)
        title = re.sub(r"^\s*\[?\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\]?\s*(?:[-\u2013\u2014|:])?\s*", "", title)
        title = re.sub(r"^\s*\[?\d{1,2}\s+(?:" + az_months + r")\s*,?\s*\d{4}(?:\D{0,12}\d{1,2}[:.]\d{2})?\]?\s*(?:[-\u2013\u2014|:])?\s*", "", title, flags=re.IGNORECASE)
        title = re.sub(r"^\s*\[?\d{1,2}[:.]\d{2}\s*(?:[-\u2013\u2014|])\s*\d{1,2}\s+(?:" + az_months + r")\s+\d{4}\]?\s*(?:[-\u2013\u2014|:])?\s*", "", title, flags=re.IGNORECASE)
        title = re.sub(r"^\s*\[?\d{1,2}[:.]\d{2}\]?\s*(?:[-\u2013\u2014|:])?\s*", "", title)
        title = re.sub(r"^\.\d{2,4}\s*(?:[-\u2013\u2014|:])?\s*", "", title)
        title = re.sub(r"^\s*\[?\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}(?::\d{2})?(?:[+-]\d{2}:?\d{2})?)?\]?\s*(?:[-\u2013\u2014|:])?\s*", "", title)
        if title == before:
            break

    title = re.sub(rf"\s*(?:{separators})\s*{category_group}\s*$", "", title, flags=re.IGNORECASE)
    title = re.sub(rf"\s*(?:{separators})\s*{noise_group}\s*$", "", title, flags=re.IGNORECASE)
    title = re.sub(r"\s+(?:Ətraflı|Etraflı|Daha ətraflı|Daha etrafli)\s*$", "", title, flags=re.IGNORECASE)
    title = re.sub(r"\s+\[?(?:VIDEO|VİDEO|FOTO|YEN?L?N?B|CANLI|QİYMƏTLƏR|QIYMETLER|QİYMETLER|QIYMƏTLƏR)\]?\s*$", "", title, flags=re.IGNORECASE)
    title = re.sub(r"\s+\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\s*/\s*\d{1,2}[:.]\d{2}(?::\d{2})?(?:\s+Ətraflı)?$", "", title, flags=re.IGNORECASE)
    title = re.sub(r"\s+\d{1,2}[:.]\d{2}\s*(?:[-\u2013\u2014|])\s*\d{1,2}\s+(?:" + az_months + r")\s+\d{4}$", "", title, flags=re.IGNORECASE)
    title = re.sub(r"\s+\[?\d{1,2}\s+(?:" + az_months + r")\s*,?\s+\d{4}(?:\s*[\[|,]?\s*\d{1,2}[:.]\d{2}\]?)?$", "", title, flags=re.IGNORECASE)
    title = re.sub(r"\s+\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\s*,?\s*\d{1,2}[:.]\d{2}(?::\d{2})?$", "", title)
    title = re.sub(r"\s+\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$", "", title)
    title = re.sub(r"\s+\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}(?::\d{2})?(?:[+-]\d{2}:?\d{2})?)?$", "", title)
    title = re.sub(r"(?:\s+[-\u2013\u2014]+|\s*[|:\u2022\u00bb]+)\s*(?:www\.)?[A-Za-z0-9_-]+\.(?:az|com|net|org|info|ws|media)\b.*$", "", title, flags=re.IGNORECASE)
    title = re.sub(r"(?:\s+[-\u2013\u2014]+|\s*[|:\u2022\u00bb]+)\s*[^-|\u2013\u2014:]{0,90}(?:x[eə]b[eə]r\s+sayt[ıi]|x[eə]b[eə]rl[eə]r|son\s+x[eə]b[eə]rl[eə]r).*$", "", title, flags=re.IGNORECASE)
    title = re.sub(r"\s*(?:[-\u2013\u2014|:\u2022\u00bb]+)\s*(?:rəsmi\s+portalı|resmi\s+portalı|rəsmi\s+saytı|resmi\s+saytı).*$", "", title, flags=re.IGNORECASE)
    title = re.sub(r"\s*(?:[-\u2013\u2014|:\u2022\u00bb]+)\s*\[?(?:VIDEO|VİDEO|FOTO|YEN?L?N?B|CANLI|QİYMƏTLƏR|QIYMETLER|QİYMETLER|QIYMƏTLƏR)\]?\s*$", "", title, flags=re.IGNORECASE)
    title = re.sub(r"\s*(?:[-\u2013\u2014|:\u2022\u00bb]+)\s*[A-ZƏÖĞÜÇŞİ]{2,12}$", "", title)
    title = re.sub(r"\s*(?:[-\u2013\u2014|])\s*(?:[A-Za-z0-9_-]+\.)?az\s*$", "", title, flags=re.IGNORECASE)
    title = re.sub(r"\s*(?:[-\u2013\u2014|])\s*(?:Report|Oxu|Qafqazinfo|Trend|APA|Azertac|Unikal|Modern|Publika|Yeni ?a?|Yeni Cag)\s*$", "", title, flags=re.IGNORECASE)
    title = re.sub(r"\s*[-\u2013\u2014|:\u2022\u00bb]+\s*$", "", title)
    title = re.sub(r"^[-\u2013\u2014|:\u2022\u00bb]+\s*", "", title)
    title = re.sub(r"\s+", " ", title).strip()

    return clean_text(title)


def is_non_news_title(title):
    cleaned = clean_title_for_message(title)
    normalized = normalize_text(cleaned)
    category_values = {normalize_text(item) for item in NEWS_CATEGORIES}
    noise_values = {normalize_text(item) for item in TITLE_NOISE_LABELS}
    if not cleaned or normalized in category_values or normalized in noise_values:
        return True
    if len(cleaned) < 12:
        return True
    if parse_datetime_to_baku(cleaned) and len(cleaned.split()) <= 5:
        return True
    if re.fullmatch(r"[\d\s:./,\-|\u2013\u2014]+", cleaned):
        return True
    if re.fullmatch(r"(?:" + "|".join(re.escape(c) for c in NEWS_CATEGORIES) + r")\s+[\d\s:./,\-|\u2013\u2014]+", cleaned, flags=re.IGNORECASE):
        return True
    return False


def title_quality_score(title):
    value = clean_title_for_message(title)
    if not value:
        return -1000
    score = min(len(value), 180)
    if title_looks_like_url(value):
        score -= 220
    if title_has_site_suffix(title):
        score -= 90
    score -= mojibake_score(value) * 12
    score -= len(re.findall(r"[<>]", str(title or ""))) * 25
    score -= len(re.findall(r"\.\.\.|…|â€¦", value)) * 60
    if title_is_probably_corrupt(value):
        score -= 90
    if len(value) < 18:
        score -= 40
    return score


def title_needs_article_refetch(title):
    cleaned = clean_title_for_message(title)
    if title_looks_like_url(title):
        return True
    if title_is_probably_corrupt(title) or title_is_probably_corrupt(cleaned):
        return True
    if title_has_site_suffix(title):
        return True
    if title_quality_score(cleaned) < 130:
        return True
    return False


_AZ_FOLD = str.maketrans({"ə": "e", "ı": "i", "ö": "o", "ü": "u", "ç": "c", "ş": "s", "ğ": "g", "İ": "i", "Ə": "e", "Ö": "o", "Ü": "u", "Ç": "c", "Ş": "s", "Ğ": "g", "I": "i"})


def fold_az(text):
    """Lowercase + ASCII-fold Azerbaijani letters so titles can be compared with URL slugs."""
    return normalize_text(str(text or "").translate(_AZ_FOLD))


_CYRILLIC_SKELETON = str.maketrans({
    "ж": "z", "ц": "c", "ч": "c", "ш": "s", "щ": "s", "х": "", "й": "", "ь": "", "ъ": "",
    "а": "", "е": "", "ё": "", "и": "", "о": "", "у": "", "ы": "", "э": "", "ю": "", "я": "",
    "б": "b", "в": "v", "г": "g", "д": "d", "з": "z", "к": "k", "л": "l", "м": "m", "н": "n",
    "п": "p", "р": "r", "с": "s", "т": "t", "ф": "f",
})
_CYRILLIC_RE = re.compile(r"[а-яё]", re.IGNORECASE)


def slug_skeleton(word):
    """Consonant skeleton of a Latin slug word, so 'azerbajdzhan' and 'азербайджан' compare equal."""
    word = re.sub(r"shch|dzh|tch|zh|ch|sh", lambda m: {"shch": "s", "dzh": "z", "tch": "c", "zh": "z", "ch": "c", "sh": "s"}[m.group(0)], word)
    word = word.replace("kh", "h").replace("ts", "c")
    return re.sub(r"[aeiouyjhx]", "", word)


def meaningful_slug_words(article_url):
    slug_raw = title_from_url_slug(article_url)
    if len(slug_raw.split()) < 2:
        return []  # opaque id slug (e.g. 1805hgwolf12o7cyf7) says nothing about the title
    if len(slug_raw.split()) < 3 and re.search(r"\d{4,}", urlparse(str(article_url or "")).path):
        return []  # category + id slug (e.g. Dunya_e154160_az) is not a title either
    slug_title = fold_az(slug_raw)
    stop_words = {
        "az", "xeber", "xeberler", "xəbər", "xəbərlər", "news", "post",
        "article", "video", "foto", "fotolar", "cemiyyet", "cəmiyyət",
        "siyaset", "siyasət", "iqtisadiyyat", "tehsil", "təhsil",
        "view", "views", "detail", "details", "item", "read", "page", "index",
        "kheberler", "xeberler", "haberler", "articles", "blog",
    }
    words = re.findall(r"[a-zA-Z0-9əöğüçıƏÖĞÜÇŞşİı]{4,}", slug_title)
    words = [re.sub(r"(?<=[a-z])\d+$", "", word) for word in words]  # 'azerbaycandir1' -> 'azerbaycandir'
    words = [
        word for word in words
        if len(word) >= 4 and word not in stop_words
        and not re.search(r"\d", word)  # dates / ids (2021, y7hdrc) say nothing about the title
        and re.search(r"[aeiouəıöü]", word)  # random consonant ids (thslnnksff)
    ]
    # Fewer than 3 real words is a route or category, not a headline slug.
    return words if len(words) >= 3 else []


def title_matches_url_slug(title, article_url):
    words = meaningful_slug_words(article_url)
    if not words:
        return True
    words = words[:8]
    cleaned = clean_title_for_message(title)
    title_norm = fold_az(cleaned)
    overlap = sum(1 for word in words if word in title_norm)
    if _CYRILLIC_RE.search(cleaned):
        skeletons = {w.translate(_CYRILLIC_SKELETON) for w in re.findall(r"[а-яё]+", cleaned.lower())}
        overlap = sum(1 for word in words if len(slug_skeleton(word)) >= 2 and slug_skeleton(word) in skeletons)
    return overlap >= min(2, max(1, len(words) // 3))


def title_rejection_reason(title, article_url=None, source_domain=None):
    cleaned = clean_title_for_message(title)
    if not cleaned:
        return "empty"
    if title_looks_like_url(cleaned):
        return "url_title"
    if title_is_probably_corrupt(cleaned):
        return "corrupt"
    if is_non_news_title(cleaned):
        return "generic_or_non_news"
    if source_domain:
        source_name = normalize_text(re.sub(r"\.(?:az|com|net|org|info|ws|media)$", "", clean_text(source_domain), flags=re.IGNORECASE))
        if source_name and normalize_text(cleaned) == source_name:
            return "source_name_only"
    if article_url and not title_matches_url_slug(cleaned, article_url) and title_quality_score(cleaned) < 145:
        return "slug_mismatch"
    return ""


def extract_article_title_info_from_html(page_html, article_url=None, source_domain=None):
    try:
        soup = BeautifulSoup(page_html or "", "html.parser")
    except Exception:
        return {"title": "", "method": "parse_error", "raw_title": "", "reject_reason": "parse_error"}

    candidates = []

    def add_candidate(method, value):
        value = clean_text(value)
        if value:
            candidates.append((method, value))

    for script in soup.find_all("script", attrs={"type": "application/ld+json"}):
        try:
            data = json.loads(script.string or script.get_text(" ", strip=True) or "{}")
        except Exception:
            continue
        nodes = data if isinstance(data, list) else [data]
        for node in list(nodes):
            if isinstance(node, dict) and node.get("@graph"):
                nodes.extend([item for item in node.get("@graph") if isinstance(item, dict)])
            if isinstance(node, dict) and node.get("headline"):
                add_candidate("json_ld_headline", node.get("headline"))
            if isinstance(node, dict) and node.get("name"):
                add_candidate("json_ld_name", node.get("name"))

    for tag in soup.find_all("meta"):
        key = (
            tag.get("property")
            or tag.get("name")
            or tag.get("itemprop")
            or ""
        ).strip().lower()
        if key == "og:title" and tag.get("content"):
            add_candidate("og_title", tag.get("content"))
        elif key == "twitter:title" and tag.get("content"):
            add_candidate("twitter_title", tag.get("content"))
        elif key in {"title", "headline"} and tag.get("content"):
            add_candidate(f"meta_{key}", tag.get("content"))

    for selector in ("article h1", "main h1", "h1", ".article-title", ".news-title", ".post-title", ".entry-title"):
        tag = soup.select_one(selector)
        if tag:
            add_candidate(f"selector:{selector}", tag.get_text(" ", strip=True))

    for selector in ("article h2", "main h2"):
        tag = soup.select_one(selector)
        if tag:
            add_candidate(f"selector:{selector}", tag.get_text(" ", strip=True))

    if soup.find("title"):
        title = clean_title_for_message(soup.find("title").get_text(" ", strip=True))
        title = re.sub(r"\s*[-|]\s*[^-|]{2,60}$", "", title).strip()
        add_candidate("html_title", title)

    method_bonus = {
        "json_ld_headline": 80,
        "og_title": 70,
        "twitter_title": 60,
        "meta_headline": 55,
        "meta_title": 50,
        "json_ld_name": 35,
        "html_title": 10,
    }
    meta_methods = {"json_ld_headline", "og_title", "twitter_title", "meta_headline", "meta_title"}

    def title_tokens(value):
        return {w for w in re.findall(r"\w{3,}", fold_az(value))}

    # Reference titles from page metadata (even truncated with "..." they tell what the page is about).
    meta_refs = []
    for method, raw_title in candidates:
        if method in meta_methods:
            ref = re.sub(r"\s*(?:\.{3}|\u2026)\s*$", "", clean_title_for_message(raw_title)).strip()
            # Skip site-name style metas (e.g. og:title = "Dövlət İmtahan Mərkəzi"): they must match the URL slug.
            if ref and not is_non_news_title(ref) and (not article_url or title_matches_url_slug(ref, article_url)):
                meta_refs.append(title_tokens(ref))

    def conflicts_with_meta(cleaned_title):
        if not meta_refs:
            return False
        tokens = title_tokens(cleaned_title)
        if not tokens:
            return False
        for ref in meta_refs:
            if ref and len(tokens & ref) / max(1, min(len(tokens), len(ref))) >= 0.6:
                return False
        return True

    valid = []
    rejected = []
    for method, raw_title in candidates:
        cleaned = clean_title_for_message(raw_title)
        reason = title_rejection_reason(cleaned, article_url=article_url, source_domain=source_domain)
        if not reason and method not in meta_methods and method != "json_ld_name":
            if method.startswith("selector:") and "h1" not in method and (
                len(cleaned) > 160 or (len(cleaned) > 110 and cleaned.endswith("."))
            ):
                reason = "lede_like"
            elif conflicts_with_meta(cleaned):
                reason = "conflicts_with_meta"
        if reason:
            rejected.append(f"{method}:{reason}:{cleaned[:60]}")
            continue
        bonus = method_bonus.get(method, 30 if method.startswith("selector:") and "h1" in method else 5)
        tier = 2 if method in meta_methods else (1 if method.startswith("selector:") and "h1" in method else 0)
        valid.append((tier, title_quality_score(cleaned) + bonus, method, cleaned, raw_title))

    if not valid:
        return {
            "title": "",
            "method": "none",
            "raw_title": candidates[0][1] if candidates else "",
            "reject_reason": "; ".join(rejected[:4]) or "no_title_candidate",
        }

    _, _, method, cleaned, raw_title = max(valid, key=lambda item: (item[0], item[1]))
    return {"title": cleaned, "method": method, "raw_title": raw_title, "reject_reason": ""}


def extract_article_title_from_html(page_html):
    return extract_article_title_info_from_html(page_html).get("title", "")


def fetch_article_title_info(article_url, source_domain=None):
    if not article_url or is_local_only_url(article_url):
        return {"title": "", "method": "invalid_url", "raw_title": "", "reject_reason": "invalid_url"}
    cache_key = normalize_link(article_url)
    if cache_key in ARTICLE_TITLE_INFO_CACHE:
        return ARTICLE_TITLE_INFO_CACHE[cache_key]
    try:
        response = safe_request(
            article_url,
            headers=REQUEST_HEADERS,
            timeout=REQUEST_TIMEOUT,
            allow_redirects=True,
        )
        if response.status_code != 200:
            info = {"title": "", "method": "http_error", "raw_title": "", "reject_reason": f"http_{response.status_code}"}
            ARTICLE_TITLE_INFO_CACHE[cache_key] = info
            return info
        info = extract_article_title_info_from_html(
            decode_response_text(response),
            article_url=article_url,
            source_domain=source_domain,
        )
        ARTICLE_TITLE_INFO_CACHE[cache_key] = info
        return info
    except Exception as exc:
        print(f"Article title read failed: {article_url} | {exc}", flush=True)
        info = {"title": "", "method": "exception", "raw_title": "", "reject_reason": str(exc)[:120]}
        ARTICLE_TITLE_INFO_CACHE[cache_key] = info
        return info


def fetch_article_title(article_url):
    return fetch_article_title_info(article_url).get("title", "")


def choose_best_article_title_info(current_title, article_url, source_domain=None):
    current = clean_title_for_message(current_title)
    current_reason = title_rejection_reason(current, article_url=article_url, source_domain=source_domain)
    page_info = {"title": "", "method": "", "raw_title": "", "reject_reason": ""}
    page_title = ""
    needs_refetch = title_needs_article_refetch(current_title)
    if article_url and needs_refetch:
        page_info = fetch_article_title_info(article_url, source_domain=source_domain)
        page_title = page_info.get("title", "")
    if page_title and (
        needs_refetch
        or title_quality_score(page_title) >= title_quality_score(current)
    ):
        return {
            "title": page_title,
            "method": page_info.get("method") or "article_page",
            "raw_title": page_info.get("raw_title") or page_title,
            "reject_reason": "",
            "candidate_title": current,
        }
    if title_looks_like_url(current) and article_url:
        fallback_title = clean_title_for_message(title_from_url_slug(article_url))
        fallback_reason = title_rejection_reason(fallback_title, article_url=article_url, source_domain=source_domain)
        if fallback_title and not fallback_reason:
            return {
                "title": fallback_title,
                "method": "url_slug",
                "raw_title": current_title,
                "reject_reason": "",
                "candidate_title": current,
            }
    if current and not current_reason:
        return {
            "title": current,
            "method": "candidate_listing",
            "raw_title": current_title,
            "reject_reason": "",
            "candidate_title": current,
        }
    return {
        "title": "",
        "method": "rejected",
        "raw_title": current_title,
        "reject_reason": page_info.get("reject_reason") or current_reason or "bad_title",
        "candidate_title": current,
    }


def choose_best_article_title(current_title, article_url):
    return choose_best_article_title_info(current_title, article_url).get("title", "")


def clean_matched_keywords(keywords):
    cleaned = []
    seen = set()
    for keyword in keywords or []:
        normalized = normalize_text(keyword)
        if not normalized or normalized in NEWS_CATEGORIES or normalized in seen:
            continue
        seen.add(normalized)
        cleaned.append(keyword)
    return cleaned


def keyword_matches_title(keyword, title_text):
    keyword = keyword_fold(keyword).strip()
    title_text = keyword_fold(title_text)
    if not keyword:
        return False

    # \w is Unicode-aware, so ə ğ ı ö ü ç ş count as word characters while
    # hyphens/punctuation do not ("BDU-da" matches "bdu", "ABDU" does not).
    strict_match = keyword in STRICT_WORDS_FOLDED or len(keyword) <= 4

    if strict_match or " " in keyword:
        pattern = r"(?<!\w)" + re.escape(keyword) + r"(?!\w)"
        return bool(re.search(pattern, title_text))

    # Long single-word keywords match as a stem so Azerbaijani suffixes and
    # compounds still hit ("universitet" -> "Universitetin", "ümumtəhsil").
    return keyword in title_text


def keyword_match(title, keywords):
    matched_keywords = []
    seen = set()
    for keyword in sorted({str(k).strip() for k in keywords or [] if str(k).strip()}, key=len, reverse=True):
        key = keyword_fold(keyword)
        if key in seen:
            continue
        seen.add(key)
        if keyword_matches_title(key, title):
            matched_keywords.append(normalize_text(keyword))

    return (bool(matched_keywords), matched_keywords)


def exists(link, title=None):
    if not supabase_ready():
        return False

    normalized_link = normalize_link(link)
    if not normalized_link:
        return False

    try:
        with DB_LOCK:
            response = requests.get(
                f"{SUPABASE_URL}/rest/v1/sent_news",
                headers=supabase_headers(),
                params={"select": "link,title", "link": f"eq.{normalized_link}", "limit": "1"},
                timeout=REQUEST_TIMEOUT,
            )
        if response.status_code == 200 and response.json():
            print(f"⛔ duplicate_url: {normalized_link}", flush=True)
            return True

        # Title is not a safe duplicate key: recurring announcements and
        # different sources can legitimately publish the same headline.
        # Keep title as metadata for future story grouping, but block only by
        # normalized URL/canonical URL.
        if title:
            print(f"✅ title_duplicate_allowed: {normalize_title_key(title)[:80]} | new_url={normalized_link}", flush=True)
        else:
            print(f"✅ new_url: {normalized_link}", flush=True)
        return False
    except Exception as exc:
        print(f"Supabase exists istisnası: {exc}", flush=True)
        return False


def same_source_title_sent_recently(source_id, title_key):
    """One source publishing the same headline under a second URL within a day is the same story."""
    if not source_id or not title_key:
        return False
    since = (datetime.now(BAKU_TZ) - timedelta(hours=24)).isoformat()
    try:
        with DB_LOCK:
            response = requests.get(
                f"{SUPABASE_URL}/rest/v1/sent_news",
                headers=supabase_headers(),
                params={
                    "select": "link",
                    "source_id": f"eq.{source_id}",
                    "title": f"eq.{title_key}",
                    "created_at": f"gte.{since}",
                    "limit": "1",
                },
                timeout=REQUEST_TIMEOUT,
            )
        return response.status_code == 200 and bool(response.json())
    except Exception as exc:
        print(f"Supabase title dedupe istisnası: {redact_secrets(exc)}", flush=True)
        return False


def reserve_news(link, title, source, source_id=None):
    if not supabase_ready():
        return True

    normalized_link = normalize_link(link)
    title_key = normalize_title_key(title)
    if not normalized_link:
        return False

    if exists(normalized_link, title_key):
        return False

    source_name = source.get("name") if isinstance(source, dict) else source
    resolved_source_id = source_id or (source.get("id") if isinstance(source, dict) else None)
    if same_source_title_sent_recently(resolved_source_id, title_key):
        if isinstance(source, dict):
            source["_reserve_failure_reason"] = "duplicate_url"
        print(f"⛔ duplicate_title_same_source: {title_key[:80]} | {normalized_link}", flush=True)
        return False
    payload = {"link": normalized_link, "title": title_key or clean_text(title), "source": source_name}
    if resolved_source_id:
        payload["source_id"] = resolved_source_id

    def post_payload(next_payload):
        with DB_LOCK:
            return requests.post(
                f"{SUPABASE_URL}/rest/v1/sent_news",
                headers=supabase_headers({"Prefer": "return=minimal"}),
                json=next_payload,
                timeout=REQUEST_TIMEOUT,
            )

    try:
        response = post_payload(payload)
        if (
            response.status_code in (400, 404)
            and "source_id" in payload
            and "source_id" in response.text
            and ("schema" in response.text.lower() or "column" in response.text.lower())
        ):
            legacy_payload = dict(payload)
            legacy_payload.pop("source_id", None)
            response = post_payload(legacy_payload)

        if response.status_code in (200, 201, 204):
            print(f"✅ Supabase rezerv edildi: {normalized_link}", flush=True)
            return True
        if response.status_code == 409:
            conflict_is_url = exists(normalized_link, title_key)
            conflict_reason = "duplicate_url" if conflict_is_url else "db_dedup_conflict"
            if isinstance(source, dict):
                source["_reserve_failure_reason"] = conflict_reason
            print(
                f"⛔ {conflict_reason}: {normalized_link} | "
                "DB constraint yoxlanmalıdır: title təkbaşına duplicate açarı olmamalıdır.",
                flush=True,
            )
            return False
        print(f"Supabase reserve xətası: {response.status_code} | {response.text[:300]}", flush=True)
        return False
    except Exception as exc:
        print(f"Supabase reserve istisnası: {exc}", flush=True)
        return False


def release_reserved_news(link):
    if not supabase_ready():
        return False
    normalized_link = normalize_link(link)
    if not normalized_link:
        return False
    try:
        with DB_LOCK:
            response = requests.delete(
                f"{SUPABASE_URL}/rest/v1/sent_news",
                headers=supabase_headers(),
                params={"link": f"eq.{normalized_link}"},
                timeout=REQUEST_TIMEOUT,
            )
        return response.status_code in (200, 204)
    except Exception as exc:
        print(f"Rezerv silmə istisnası: {exc}", flush=True)
        return False


def google_news_when_window():
    if GOOGLE_NEWS_FALLBACK_HOURS < 24:
        return f"{GOOGLE_NEWS_FALLBACK_HOURS}h"
    days = max(1, (GOOGLE_NEWS_FALLBACK_HOURS + 23) // 24)
    return f"{days}d"


def get_or_create_monitor_source(site_name, source_domain, page_url, existing_source_id=None):
    if existing_source_id:
        return existing_source_id
    if not supabase_ready():
        return None

    base_url = get_base_url(page_url)
    if not base_url:
        return None

    try:
        response = requests.get(
            f"{SUPABASE_URL}/rest/v1/sources",
            headers=supabase_headers(),
            params={"select": "id", "base_url": f"eq.{base_url}", "limit": "1"},
            timeout=REQUEST_TIMEOUT,
        )
        if response.status_code == 200 and response.json():
            return response.json()[0]["id"]

        payload = {
            "name": site_name or source_domain,
            "base_url": base_url,
            "latest_url": page_url,
            "source_type": "news_site",
            "status": "active",
            "trust_level": "medium",
        }
        create_response = requests.post(
            f"{SUPABASE_URL}/rest/v1/sources",
            headers=supabase_headers({"Prefer": "return=representation"}),
            json=payload,
            timeout=REQUEST_TIMEOUT,
        )
        if create_response.status_code in (200, 201) and create_response.json():
            return create_response.json()[0]["id"]
        print(f"Monitor source yaradılmadı: {create_response.status_code} | {create_response.text[:200]}", flush=True)
        return None
    except Exception as exc:
        print(f"Monitor source xətası: {exc}", flush=True)
        return None


AZ_MONTHS = {
    "yanvar": 1, "yan": 1,
    "fevral": 2, "fev": 2,
    "mart": 3, "mar": 3,
    "aprel": 4, "apr": 4,
    "may": 5,
    "iyun": 6, "iyn": 6, "jun": 6, "june": 6,
    "iyul": 7, "iyl": 7, "jul": 7, "july": 7,
    "avqust": 8, "avq": 8, "aug": 8, "august": 8,
    "sentyabr": 9, "sen": 9, "sep": 9, "september": 9,
    "oktyabr": 10, "okt": 10, "oct": 10, "october": 10,
    "noyabr": 11, "noy": 11, "nov": 11, "november": 11,
    "dekabr": 12, "dek": 12, "dec": 12, "december": 12,
}


RU_MONTHS = {
    "января": 1, "январь": 1,
    "февраля": 2, "февраль": 2,
    "марта": 3, "март": 3,
    "апреля": 4, "апрель": 4,
    "мая": 5, "май": 5,
    "июня": 6, "июнь": 6,
    "июля": 7, "июль": 7,
    "августа": 8, "август": 8,
    "сентября": 9, "сентябрь": 9,
    "октября": 10, "октябрь": 10,
    "ноября": 11, "ноябрь": 11,
    "декабря": 12, "декабрь": 12,
}


AZ_CHAR_TRANSLATION = str.maketrans({
    "\u0131": "i",
    "\u0130": "i",
    "\u0259": "e",
    "\u00f6": "o",
    "\u011f": "g",
    "\u00fc": "u",
    "\u00e7": "c",
    "\u015f": "s",
})


def normalize_date_text(value):
    text = clean_text(str(value or "")).lower()

    text = text.replace("ı", "i")
    text = text.replace("İ", "i").replace("i̇", "i")
    text = text.replace("ə", "e")
    text = text.replace("ö", "o")
    text = text.replace("ğ", "g")
    text = text.replace("ü", "u")
    text = text.replace("ç", "c")
    text = text.replace("ş", "s")

    text = text.replace("—", "-").replace("–", "-")
    text = text.translate(AZ_CHAR_TRANSLATION)

    text = text.replace("|", " ")
    text = text.replace("/", " ")
    text = re.sub(r"\s+", " ", text).strip()

    return text


def month_number(month_name):
    raw = clean_text(month_name).lower()
    folded = raw.translate(AZ_CHAR_TRANSLATION)

    variants = {
        raw,
        folded,
        raw.replace("ı", "i").replace("İ", "i").replace("i̇", "i"),
        raw.replace("ə", "e").replace("ö", "o").replace("ğ", "g").replace("ü", "u").replace("ç", "c").replace("ş", "s").replace("ı", "i"),
    }

    aliases = {
        "yanvar": 1, "yan": 1,
        "fevral": 2, "fev": 2,
        "mart": 3, "mar": 3,
        "aprel": 4, "apr": 4,
        "may": 5,
        "iyun": 6, "iyn": 6, "jun": 6, "june": 6,
        "iyul": 7, "iyl": 7, "jul": 7, "july": 7,
        "avqust": 8, "avq": 8, "aug": 8, "august": 8,
        "sentyabr": 9, "sen": 9, "sep": 9, "september": 9,
        "oktyabr": 10, "okt": 10, "oct": 10, "october": 10,
        "noyabr": 11, "noy": 11, "nov": 11, "november": 11,
        "dekabr": 12, "dek": 12, "dec": 12, "december": 12,

        "yanvar": 1, "fevral": 2, "aprel": 4,
        "iyun": 6, "iyul": 7,
    }

    for item in variants:
        if item in aliases:
            return aliases[item]

    return None


def contains_known_az_month(value):
    text = normalize_date_text(clean_text(value)).lower()
    for token in re.findall(r"[a-z]+", text):
        if month_number(token):
            return True
    return False


def safe_datetime(year, month, day, hour=0, minute=0):
    try:
        year = int(year)
        month = int(month)
        day = int(day)
        hour = int(hour)
        minute = int(minute)

        if 0 <= year < 100:
            year += 2000

        if year < 2020 or year > 2035:
            return None

        if not (1 <= month <= 12):
            return None

        if not (1 <= day <= 31):
            return None

        if not (0 <= hour <= 23 and 0 <= minute <= 59):
            return None

        return datetime(year, month, day, hour, minute, tzinfo=BAKU_TZ)
    except Exception:
        return None


def parse_relative_datetime(value):
    text = normalize_date_text(clean_text(value)).lower()
    if not text:
        return None

    now_baku = datetime.now(BAKU_TZ)
    time_match = re.search(r"(?<!\d)(\d{1,2})\s*[:.]\s*(\d{2})(?!\d)", text)

    if any(token in text for token in ("az once", "indice", "indicə", "indi", "just now")):
        return now_baku

    if any(token in text for token in ("bugun", "bu gun", "today")):
        if time_match:
            return safe_datetime(now_baku.year, now_baku.month, now_baku.day, time_match.group(1), time_match.group(2))
        return safe_datetime(now_baku.year, now_baku.month, now_baku.day)

    if any(token in text for token in ("dunen", "yesterday")):
        day = now_baku - timedelta(days=1)
        if time_match:
            return safe_datetime(day.year, day.month, day.day, time_match.group(1), time_match.group(2))
        return safe_datetime(day.year, day.month, day.day)

    relative_match = re.search(
        r"(?<!\d)(\d{1,3})\s*(deqiqe|deq|dəqiqə|dəq|minute|minutes|min|saat|hour|hours|gun|gün|day|days)\s*(once|əvvəl|evvel|ago)?",
        text,
        flags=re.IGNORECASE,
    )
    if relative_match:
        amount = int(relative_match.group(1))
        unit = relative_match.group(2).lower()
        if unit in {"deqiqe", "deq", "dəqiqə", "dəq", "minute", "minutes", "min"}:
            return now_baku - timedelta(minutes=amount)
        if unit in {"saat", "hour", "hours"}:
            return now_baku - timedelta(hours=amount)
        if unit in {"gun", "gün", "day", "days"}:
            return now_baku - timedelta(days=amount)

    return None


def parse_az_datetime(value):
    original = clean_text(str(value or ""))

    relative_dt = parse_relative_datetime(original)
    if relative_dt:
        return relative_dt

    year_first = re.search(
        r"(?<!\d)(\d{4})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{1,2})(?:\D{0,12}(\d{1,2})\s*[:.]\s*(\d{2}))?",
        original,
    )
    if year_first:
        year, month, day, hour, minute = year_first.groups()
        return safe_datetime(year, month, day, hour or 0, minute or 0)

    numeric_time_first = re.search(
        r"(?<!\d)(\d{1,2})\s*[:.]\s*(\d{2})\D{0,20}(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{2,4})",
        original,
    )
    if numeric_time_first:
        hour, minute, day, month, year = numeric_time_first.groups()
        return safe_datetime(year, month, day, hour, minute)

    numeric_date = re.search(
        r"(?<!\d)(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{2,4})(?:\D{0,12}(\d{1,2})\s*[:.]\s*(\d{2}))?",
        original,
    )
    if numeric_date:
        day, month, year, hour, minute = numeric_date.groups()
        return safe_datetime(year, month, day, hour or 0, minute or 0)

    russian_date = re.search(
        r"(?<!\d)(\d{1,2})\s+([а-яё]+)\s*,?\s*(\d{4})(?:\D{0,20}(\d{1,2})\s*[:.]\s*(\d{2}))?",
        original.lower(),
        re.IGNORECASE,
    )
    if russian_date:
        day, month_name, year, hour, minute = russian_date.groups()
        month = RU_MONTHS.get(month_name)
        if month:
            return safe_datetime(year, month, day, hour or 0, minute or 0)

    text = normalize_date_text(original)

    # 15:17 - 5 İyul 2026
    # Saat əvvəl gələndə bunu gün-səviyyəli tarixdən əvvəl tuturuq ki, saat itməsin.
    pattern = r"(\d{1,2})[:.](\d{2})\D{0,12}(\d{1,2})\s+([a-z]+)\s+(\d{4})"
    m = re.search(pattern, text, re.IGNORECASE)
    if m:
        hour, minute, day, month_name, year = m.groups()
        month = month_number(month_name)
        if month:
            return safe_datetime(year, month, day, hour, minute)

    month_day = re.search(
        r"\b([a-z]+?)(?:un|in|n)\s+(\d{1,2})(?:\s*-\s*d[ae])?(?:\D{0,80}(\d{1,2})\s*[:.]\s*(\d{2}))?",
        text,
        re.IGNORECASE,
    )
    if month_day:
        month_name, day, hour, minute = month_day.groups()
        month = month_number(month_name)
        if month:
            now_baku = datetime.now(BAKU_TZ)
            return safe_datetime(now_baku.year, month, day, hour or 0, minute or 0)

        # Mətn içində Azərbaycan tarix+saat formatı:
    # "Yerləşdirilmə tarixi : 09 İyun 2026 14:20"
    # "article_tarix: 10 İyun 2026, 12:35 / Konfranslar"
    pattern = r"(\d{1,2})\s+([a-z]+)\s+(\d{4})\D{0,20}(\d{1,2})[:.](\d{2})"
    m = re.search(pattern, text, re.IGNORECASE)
    if m:
        day, month_name, year, hour, minute = m.groups()
        month = month_number(month_name)

        if month:
            return safe_datetime(year, month, day, hour, minute)

    # Mətn içində qısa ay + tarix+saat:
    # "İyn 08, 2026 | 20:00"
    # "May 25, 2026 | 12:00"
    pattern = r"([a-z]+)\s+(\d{1,2})\s*,?\s+(\d{4})\D{0,20}(\d{1,2})[:.](\d{2})"
    m = re.search(pattern, text, re.IGNORECASE)
    if m:
        month_name, day, year, hour, minute = m.groups()
        month = month_number(month_name)

        if month:
            return safe_datetime(year, month, day, hour, minute)

    if not text:
        return None

    # 1) Azərbaycan formatı:
    # 12 İyun 2026, 17:41
    # 12 İyun 2026, Cümə
    pattern = r"(\d{1,2})\s+([a-z]+)\s*,?\s+(\d{4})(?:\s*,?\s*(?:[a-z]+)?)?(?:\s+(\d{1,2})[:.](\d{2}))?"
    m = re.search(pattern, text, re.IGNORECASE)
    if m:
        day, month_name, year, hour, minute = m.groups()
        month = month_number(month_name)

        if month:
            return safe_datetime(
                year,
                month,
                day,
                hour or 0,
                minute or 0,
            )

    # 2) Qısa ay əvvəl:
    # İyn 11, 2026 | 04:34
    # May 26, 2026 | 02:49
    pattern = r"([a-z]+)\s+(\d{1,2})\s*,?\s+(\d{4})(?:\s+(\d{1,2})[:.](\d{2}))?"
    m = re.search(pattern, text, re.IGNORECASE)
    if m:
        month_name, day, year, hour, minute = m.groups()
        month = month_number(month_name)

        if month:
            return safe_datetime(
                year,
                month,
                day,
                hour or 0,
                minute or 0,
            )

    # 3) Rəqəmli tarix + saat:
    # 12.06.2026 17:41
    pattern = r"(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})(?:\D{0,12}(\d{1,2})[:.](\d{2}))?"
    m = re.search(pattern, text)
    if m:
        day, month, year, hour, minute = m.groups()
        return safe_datetime(
            year,
            month,
            day,
            hour or 0,
            minute or 0,
        )

    # 4) Saat əvvəldə:
    # 17:41 12 İyun 2026
    pattern = r"(\d{1,2})[:.](\d{2})\D{0,12}(\d{1,2})\s+([a-z]+)\s+(\d{4})"
    m = re.search(pattern, text, re.IGNORECASE)
    if m:
        hour, minute, day, month_name, year = m.groups()
        month = month_number(month_name)

        if month:
            return safe_datetime(year, month, day, hour, minute)

    # 5) Başlıq əvvəlində yalnız saat:
    # 09:41 Müəllimlərin...
    time_only = re.search(r"^\s*(\d{1,2})[:.](\d{2})(?:\s|$)", text)
    if time_only:
        hour = int(time_only.group(1))
        minute = int(time_only.group(2))
        today = datetime.now(BAKU_TZ).date()
        return safe_datetime(today.year, today.month, today.day, hour, minute)

    return None


def has_strong_date_signal(text):
    value = clean_text(text)
    normalized = normalize_date_text(value)
    if re.search(r"\d{4}\s*[./-]\s*\d{1,2}\s*[./-]\s*\d{1,2}", value):
        return True
    if re.search(r"(?<!\d)\d{1,2}\s*[./-]\s*\d{1,2}\s*[./-]\s*\d{2,4}", value):
        return True
    if re.search(r"\d{1,2}\s+[a-z]+\s+\d{4}", normalized, re.IGNORECASE):
        return True
    if re.search(r"[a-z]+\s+\d{1,2}\s*,?\s+\d{4}", normalized, re.IGNORECASE):
        return True
    if re.search(r"\b(mon|tue|wed|thu|fri|sat|sun),?\s+\d{1,2}\s+\w+\s+\d{4}", value, re.IGNORECASE):
        return True
    return False


def has_any_date_signal(*values):
    for value in values:
        text = clean_text(value)
        if not text:
            continue
        if has_strong_date_signal(text) or contains_known_az_month(text):
            return True
        if re.search(r"\b\d{1,2}\s*[:.]\s*\d{2}\b", text):
            return True
    return False


def is_realistic_publish_datetime(dt):
    if not dt:
        return False
    now_baku = datetime.now(BAKU_TZ)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=BAKU_TZ)
    else:
        dt = dt.astimezone(BAKU_TZ)
    return 2020 <= dt.year <= now_baku.year + 1


def parse_datetime_to_baku(published_time):
    text = clean_text(str(published_time or ""))

    if not text or "tarix tapılmadı" in text.lower():
        return None

    # 1) ISO formatı birinci oxuyuruq:
    # 2026-06-11T15:50:00+04:00
    # 2026-06-11 15:50:00
    iso_match = re.search(
        r"\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}(?::\d{2})?(?:[+-]\d{2}:?\d{2}|Z)?",
        text,
    )

    if iso_match:
        iso_text = iso_match.group(0)

        try:
            if iso_text.endswith("Z"):
                iso_text = iso_text.replace("Z", "+00:00")

            dt = datetime.fromisoformat(iso_text)

            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=BAKU_TZ)
            else:
                dt = dt.astimezone(BAKU_TZ)

            return dt if is_realistic_publish_datetime(dt) else None

        except Exception:
            pass

    # 2) RFC/RSS formatı:
    # Tue, 09 Jun 2026 08:42:36 +0000
    # Sun, 11 Aug 2024 20:00:00 GMT
    try:
        dt = parsedate_to_datetime(text)

        if dt:
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=BAKU_TZ)
            else:
                dt = dt.astimezone(BAKU_TZ)

            return dt if is_realistic_publish_datetime(dt) else None
    except Exception:
        pass

    # 3) Azərbaycan formatları:
    az_dt = parse_az_datetime(text)

    if az_dt:
        return az_dt if is_realistic_publish_datetime(az_dt) else None
    if contains_known_az_month(text):
        return None

    # 4) Sonda ümumi parser.
    # Burada dayfirst=True saxlayırıq, amma ISO artıq yuxarıda tutulduğu üçün qarışmayacaq.
    if not has_strong_date_signal(text):
        return None

    try:
        dt = parser.parse(text, fuzzy=True, dayfirst=True)

        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=BAKU_TZ)
        else:
            dt = dt.astimezone(BAKU_TZ)

        return dt if is_realistic_publish_datetime(dt) else None

    except Exception as e:
        print(f"Tarix parse xətası: {published_time} | {e}", flush=True)
        return None


def has_explicit_time_signal(value):
    text = clean_text(value)
    if not text:
        return False
    if re.search(r"\d{4}-\d{2}-\d{2}[T\s]\d{1,2}\s*[:.]\s*\d{2}", text):
        return True
    if re.search(r"\d{1,2}\s*[./-]\s*\d{1,2}\s*[./-]\s*\d{2,4}\D{0,12}\d{1,2}\s*[:.]\s*\d{2}", text):
        return True
    if re.search(r"\d{1,2}\s+[A-Za-zƏəÖöĞğÜüÇçŞşİı]+\s+\d{4}\D{0,20}\d{1,2}\s*[:.]\s*\d{2}", normalize_date_text(text), re.IGNORECASE):
        return True
    if re.search(r"(?<!\d)\d{1,2}\s*:\s*\d{2}(?!\d)", text):
        return True
    if re.search(r"(^|\s)\d{1,2}\s*\.\s*\d{2}(\s|$)", text):
        return True
    return False


def is_today_news(published_time):
    dt = parse_datetime_to_baku(published_time)
    if not dt:
        return False
    now_baku = datetime.now(BAKU_TZ)
    if dt.date() != now_baku.date():
        print(f"Bugünkü xəbər deyil, keçildi: {published_time} | bugün: {now_baku.date()}", flush=True)
        return False
    return True


def get_freshness_status(published_time):
    dt = parse_datetime_to_baku(published_time)
    if not dt:
        return "date_parse_failed"
    now_baku = datetime.now(BAKU_TZ)
    if dt.date() == now_baku.date() and not has_explicit_time_signal(published_time):
        print(f"Tarix bugündür, saat tapılmadığı üçün gün səviyyəsində fresh sayıldı: {published_time}", flush=True)
        return "fresh"
    diff = now_baku - dt
    if diff.total_seconds() < 0:
        print(f"Gələcək tarix kimi göründü, keçildi: {published_time}", flush=True)
        return "future_date"
    if diff <= timedelta(hours=NEWS_TIME_LIMIT_HOURS):
        print(f"Tarix uyğundur: {published_time} | fərq: {diff.total_seconds() / 3600:.2f} saat", flush=True)
        return "fresh"
    print(f"Köhnə xəbər keçildi: {published_time} | fərq: {diff.total_seconds() / 3600:.2f} saat", flush=True)
    return "old_news"


def is_recent_news(published_time):
    return get_freshness_status(published_time) == "fresh"


def format_publish_time_for_freshness(dt, source_text):
    dt_baku = dt.astimezone(BAKU_TZ) if dt.tzinfo else dt.replace(tzinfo=BAKU_TZ)
    if dt_baku.hour == 0 and dt_baku.minute == 0 and not has_explicit_time_signal(source_text):
        return dt_baku.strftime("%d.%m.%Y")
    return dt_baku.strftime("%d.%m.%Y %H:%M")


def choose_publish_time(title, article_time, rss_time=None, listing_time=None, source_context=None, item_position=None):
    title_dt = parse_datetime_to_baku(title)
    article_dt = parse_datetime_to_baku(article_time)
    rss_dt = parse_datetime_to_baku(rss_time)
    listing_dt = parse_datetime_to_baku(listing_time)
    now_baku = datetime.now(BAKU_TZ)

    # Feed/listing timestamps describe when the item appeared in the fresh list.
    # Prefer them over article-body dates, because article pages often expose
    # stale modified dates or omit the exact time.
    for label, dt, source_text in (
        ("rss", rss_dt, rss_time),
        ("listing", listing_dt, listing_time),
    ):
        if not dt:
            continue
        dt_baku = dt.astimezone(BAKU_TZ) if dt.tzinfo else dt.replace(tzinfo=BAKU_TZ)
        if dt_baku.date() == now_baku.date() or now_baku - dt_baku <= timedelta(hours=NEWS_TIME_LIMIT_HOURS):
            print(f"Freshness {label} vaxtı ilə seçildi: {source_text}", flush=True)
            return format_publish_time_for_freshness(dt_baku, source_text)

    if title_dt and article_dt and has_strong_date_signal(title):
        title_baku = title_dt.astimezone(BAKU_TZ) if title_dt.tzinfo else title_dt.replace(tzinfo=BAKU_TZ)
        article_baku = article_dt.astimezone(BAKU_TZ) if article_dt.tzinfo else article_dt.replace(tzinfo=BAKU_TZ)
        if abs(article_baku - title_baku) > timedelta(hours=NEWS_TIME_LIMIT_HOURS):
            return format_publish_time_for_freshness(title_baku, title)

    if article_dt:
        return format_publish_time_for_freshness(article_dt, article_time)
    if title_dt:
        return format_publish_time_for_freshness(title_dt, title)
    return None


def evaluate_publish_freshness(title_text, article_time, rss_time=None, listing_time=None, source_context=None, item_position=None):
    published_time = choose_publish_time(
        title_text,
        article_time,
        rss_time=rss_time,
        listing_time=listing_time,
        source_context=source_context,
        item_position=item_position,
    )
    if not published_time:
        reason = "date_parse_failed" if has_any_date_signal(title_text, article_time, rss_time, listing_time) else "no_date"
        return None, reason
    return published_time, get_freshness_status(published_time)


LISTING_DATE_PATTERNS = [
    r"(?<!\d)(\d{1,2}\s*[./-]\s*\d{1,2}\s*[./-]\s*\d{4}\s+\d{1,2}\s*[:.]\s*\d{2})(?!\d)",
    r"(?<!\d)(\d{1,2}\s+[A-Za-zƏəÖöĞğÜüÇçŞşİı]+\s+\d{4}\D{0,12}\d{1,2}\s*[:.]\s*\d{2})(?!\d)",
    r"(?<!\d)(\d{1,2}\s*[:.]\s*\d{2}\D{0,12}\d{1,2}\s*[./-]\s*\d{1,2}\s*[./-]\s*\d{4})(?!\d)",
]


def extract_listing_publish_time_from_text(text):
    text = clean_text(text)
    if not text:
        return None
    for pattern in LISTING_DATE_PATTERNS:
        for match in re.finditer(pattern, text, flags=re.IGNORECASE):
            value = clean_text(match.group(1))
            if value and parse_datetime_to_baku(value):
                return value
    return None


def extract_listing_publish_time(block, link_tag=None):
    candidates = []
    if link_tag is not None:
        candidates.extend([
            link_tag.parent,
            link_tag.find_parent("article"),
            link_tag.find_parent("li"),
            link_tag.find_parent("div"),
            link_tag.find_parent("section"),
        ])
    if block is not None:
        candidates.append(block)

    seen = set()
    for candidate in candidates:
        if candidate is None:
            continue
        marker = id(candidate)
        if marker in seen:
            continue
        seen.add(marker)
        try:
            text = candidate.get_text(" ", strip=True)
        except Exception:
            continue
        if not text or len(text) > 1200:
            continue
        value = extract_listing_publish_time_from_text(text)
        if value:
            return value
    return None


def extract_publish_time_from_html_with_source(page_html):
    soup = BeautifulSoup(page_html, "html.parser")

    meta_selectors = [
        ("meta", {"property": "article:published_time"}, "meta:article:published_time"),
        ("meta", {"property": "article:modified_time"}, "meta:article:modified_time"),
        ("meta", {"property": "og:updated_time"}, "meta:og:updated_time"),
        ("meta", {"name": "article:published_time"}, "meta:name:article:published_time"),
        ("meta", {"name": "pubdate"}, "meta:pubdate"),
        ("meta", {"name": "publishdate"}, "meta:publishdate"),
        ("meta", {"name": "publish_date"}, "meta:publish_date"),
        ("meta", {"name": "date"}, "meta:date"),
        ("meta", {"name": "DC.date.issued"}, "meta:DC.date.issued"),
        ("meta", {"itemprop": "datePublished"}, "meta:itemprop:datePublished"),
        ("meta", {"itemprop": "dateModified"}, "meta:itemprop:dateModified"),
    ]
    for tag_name, attrs, source in meta_selectors:
        tag = soup.find(tag_name, attrs=attrs)
        value = clean_text(tag.get("content", "")) if tag else ""
        if value and parse_datetime_to_baku(value):
            return value, source

    for time_tag in soup.find_all("time"):
        value = clean_text(time_tag.get("datetime") or time_tag.get_text(" ", strip=True))
        if value and parse_datetime_to_baku(value):
            return value, "time"

    for script in soup.find_all("script", type=lambda value: value and "ld+json" in value.lower()):
        try:
            data = json.loads(script.string or script.get_text(" ", strip=True) or "{}")
        except Exception:
            continue

        stack = data if isinstance(data, list) else [data]
        while stack:
            item = stack.pop()
            if isinstance(item, list):
                stack.extend(item)
                continue
            if not isinstance(item, dict):
                continue

            for key in ("datePublished", "dateModified", "dateCreated", "uploadDate"):
                value = clean_text(item.get(key))
                if value and parse_datetime_to_baku(value):
                    return value, f"jsonld:{key}"

            graph = item.get("@graph")
            if isinstance(graph, list):
                stack.extend(graph)

    regex_patterns = [
        (r'"(?:datePublished|dateModified|dateCreated|published_at|created_at|updated_at)"\s*:\s*"([^"]+)"', "regex:json-date"),
        (r"'(?:datePublished|dateModified|dateCreated|published_at|created_at|updated_at)'\s*:\s*'([^']+)'", "regex:json-date"),
        (r"(\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}(?::\d{2})?(?:[+-]\d{2}:?\d{2}|Z)?)", "regex:iso"),
        (r"(\d{1,2}\s+[A-Za-zƏəÖöĞğÜüÇçŞşİı]+\s+\d{4}\D{0,20}\d{1,2}[:.]\d{2})", "regex:month-time"),
        (r"(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\D{0,20}\d{1,2}[:.]\d{2}(?::\d{2})?)", "regex:numeric-time"),
        (r"(\d{1,2}\s+[A-Za-zƏəÖöĞğÜüÇçŞşİı]+\s+\d{4})", "regex:month-date"),
        (r"(\d{1,2}\s+[а-яё]+\s*,?\s*\d{4}(?:\D{0,20}\d{1,2}[:.]\d{2})?)", "regex:ru-month-date"),
    ]
    for pattern, source in regex_patterns:
        for match in re.finditer(pattern, page_html, flags=re.IGNORECASE):
            value = clean_text(match.group(1))
            if value and parse_datetime_to_baku(value):
                return value, source

    return None, None


def extract_publish_time_from_html(page_html):
    value, _source = extract_publish_time_from_html_with_source(page_html)
    if value:
        return value

    soup = BeautifulSoup(page_html, "html.parser")

    meta_selectors = [
        ("meta", {"property": "article:published_time"}),
        ("meta", {"property": "article:modified_time"}),
        ("meta", {"property": "og:updated_time"}),
        ("meta", {"name": "article:published_time"}),
        ("meta", {"name": "pubdate"}),
        ("meta", {"name": "publishdate"}),
        ("meta", {"name": "publish_date"}),
        ("meta", {"name": "date"}),
        ("meta", {"name": "DC.date.issued"}),
        ("meta", {"itemprop": "datePublished"}),
        ("meta", {"itemprop": "dateModified"}),
    ]
    for tag_name, attrs in meta_selectors:
        tag = soup.find(tag_name, attrs=attrs)
        value = clean_text(tag.get("content", "")) if tag else ""
        if value and parse_datetime_to_baku(value):
            return value

    for script in soup.find_all("script", type=lambda value: value and "ld+json" in value.lower()):
        try:
            data = json.loads(script.string or script.get_text(" ", strip=True) or "{}")
        except Exception:
            continue

        stack = data if isinstance(data, list) else [data]
        while stack:
            item = stack.pop()
            if isinstance(item, list):
                stack.extend(item)
                continue
            if not isinstance(item, dict):
                continue

            for key in ("datePublished", "dateModified", "dateCreated", "uploadDate"):
                value = clean_text(item.get(key))
                if value and parse_datetime_to_baku(value):
                    return value

            graph = item.get("@graph")
            if isinstance(graph, list):
                stack.extend(graph)

    regex_patterns = [
        r'"(?:datePublished|dateModified|dateCreated|published_at|created_at|updated_at)"\s*:\s*"([^"]+)"',
        r"'(?:datePublished|dateModified|dateCreated|published_at|created_at|updated_at)'\s*:\s*'([^']+)'",
        r"(\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}(?::\d{2})?(?:[+-]\d{2}:?\d{2}|Z)?)",
        r"(\d{1,2}\s+[A-Za-zƏəÖöĞğÜüÇçŞşİı]+\s+\d{4}\D{0,20}\d{1,2}[:.]\d{2})",
        r"(\d{1,2}[./-]\d{1,2}[./-]\d{4}\D{0,20}\d{1,2}[:.]\d{2})",
        r"(\d{1,2}\s+[A-Za-zƏəÖöĞğÜüÇçŞşİı]+\s+\d{4})",
    ]
    for pattern in regex_patterns:
        for match in re.finditer(pattern, page_html, flags=re.IGNORECASE):
            value = clean_text(match.group(1))
            if value and parse_datetime_to_baku(value):
                return value

    return None


def extract_publish_time_from_article(article_url, return_source=False):
    headers = REQUEST_HEADERS
    try:
        response = safe_request(article_url, headers=headers, timeout=REQUEST_TIMEOUT, allow_redirects=True)
        if response.status_code != 200:
            return (None, None) if return_source else None
        page_html = decode_response_text(response)
        metadata_time, metadata_source = extract_publish_time_from_html_with_source(page_html)
        if metadata_time:
            return (metadata_time, metadata_source) if return_source else metadata_time
        tree = html.fromstring(page_html)
        possible_xpaths = [
            "//time/@datetime", "//time/text()",
            "//meta[@property='article:published_time']/@content",
            "//meta[@property='article:modified_time']/@content",
            "//meta[@property='og:updated_time']/@content",
            "//meta[@name='article:published_time']/@content",
            "//meta[@itemprop='datePublished']/@content",
            "//meta[@itemprop='dateModified']/@content",
            "//meta[@name='pubdate']/@content", "//meta[@name='date']/@content",
            "//meta[@name='DC.date.issued']/@content", "//meta[@name='publishdate']/@content",
            "//meta[@name='publish_date']/@content",
            "//*[@datetime]/@datetime",
            "//*[contains(translate(@class,'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'),'publish')]/text()",
            "//span[contains(@class,'date')]/text()", "//div[contains(@class,'date')]/text()",
            "//span[contains(@class,'time')]/text()", "//div[contains(@class,'time')]/text()",
            "//*[contains(@class,'date')]/text()", "//*[contains(@class,'time')]/text()",
        ]
        for xpath in possible_xpaths:
            result = tree.xpath(xpath)
            if result:
                value = clean_text(str(result[0]))
                if len(value) > 5 and parse_datetime_to_baku(value):
                    source = f"xpath:{xpath[:60]}"
                    return (value, source) if return_source else value
    except Exception as exc:
        print("Tarix çıxarma xətası:", exc, flush=True)
    return (None, None) if return_source else None


def is_probably_section_url(link):
    path = urlparse(link.lower()).path.strip("/").lower()
    if not path:
        return True
    section_paths = [
        "news", "xeber", "xeberler", "xəbərlər", "media", "media/news", "category",
        "kateqoriya", "archive", "arxiv", "allnews", "all-news", "newsarchive", "latest",
        "lastnews", "son-xeberler", "az/news", "az/xeber", "az/xeberler", "az/xəbərlər",
        "az/metbuat/xeberler", "az/page/media/news", "az/news-and-updates", "p/news",
        "tehsil", "elm", "elm-ve-tehsil", "education",
    ]
    if path in section_paths:
        return True
    bad_section_words = [
        "news", "xeber", "xeberler", "xəbərlər", "category", "kateqoriya", "archive",
        "arxiv", "latest", "lastnews", "allnews", "all-news", "son-xeberler", "media",
    ]
    parts = [part for part in path.split("/") if part]
    if len(parts) <= 1 and any(word in path for word in bad_section_words):
        return True
    if len(parts) <= 2 and any(path.endswith(word) for word in bad_section_words):
        return True
    return False


def is_allowed_root_slug_article(link):
    parsed = urlparse(link.lower())
    domain = parsed.netloc.replace("www.", "")
    path = parsed.path or ""
    if domain not in ROOT_SLUG_ARTICLE_DOMAINS:
        return False
    if not ROOT_SLUG_ARTICLE_RE.match(path):
        return False
    slug = path.strip("/")
    if slug.count("-") < 2:
        return False
    blocked_words = {
        "about", "haqqimizda", "elaqe", "contact", "privacy", "category",
        "kateqoriya", "tag", "archive", "arxiv", "search", "author",
    }
    return not any(word in slug for word in blocked_words)


def is_feed_root_slug_article(link):
    parsed = urlparse(link.lower())
    path = parsed.path or ""
    if not ROOT_SLUG_ARTICLE_RE.match(path):
        return False
    slug = path.strip("/")
    if slug.count("-") < 2:
        return False
    blocked_words = {
        "about", "haqqimizda", "elaqe", "contact", "privacy", "category",
        "kateqoriya", "tag", "archive", "arxiv", "search", "author",
        "login", "register", "profile", "rss", "feed", "blog",
    }
    return not any(word in slug for word in blocked_words)


def is_allowed_domain_detail_article(link):
    parsed = urlparse(link.lower())
    domain = parsed.netloc.replace("www.", "")
    path = parsed.path or ""
    for pattern in DOMAIN_DETAIL_ARTICLE_PATTERNS.get(domain, []):
        if pattern.search(path):
            return True
    return False


def is_slug_article_path(path, pattern):
    if not pattern.match(path):
        return False
    parts = [part for part in path.strip("/").split("/") if part]
    if len(parts) < 2:
        return False
    slug = parts[-1]
    section = parts[-2] if len(parts) > 1 else ""
    if slug.count("-") < 2:
        return False
    blocked_words = {
        "about", "haqqimizda", "elaqe", "contact", "privacy", "category",
        "kateqoriya", "tag", "archive", "arxiv", "search", "author",
        "login", "register", "profile", "rss", "feed",
    }
    if section in blocked_words:
        return False
    return not any(word in slug for word in blocked_words)


def is_language_slug_article(link):
    parsed = urlparse(link.lower())
    return is_slug_article_path(parsed.path or "", LANG_SLUG_ARTICLE_RE)


def is_category_slug_article(link):
    parsed = urlparse(link.lower())
    return is_slug_article_path(parsed.path or "", CATEGORY_SLUG_ARTICLE_RE)


def is_source_url_pattern_article(link, page_url, patterns):
    if not patterns:
        return False
    try:
        parsed_link = urlparse(link.lower())
        parsed_page = urlparse(page_url.lower())
    except Exception:
        return False
    link_domain = (parsed_link.netloc or "").replace("www.", "")
    page_domain = (parsed_page.netloc or "").replace("www.", "")
    if page_domain and link_domain and link_domain != page_domain and not link_domain.endswith("." + page_domain):
        return False
    path = parsed_link.path or ""
    if not path or is_probably_section_url(link.lower()):
        return False
    if re.search(r"\.(jpg|jpeg|png|gif|webp|svg|pdf|zip|rar|mp4|mp3)$", path, flags=re.IGNORECASE):
        return False
    for pattern in patterns:
        pattern = clean_text(pattern).lower()
        if pattern.startswith("url:"):
            pattern = pattern[4:].strip()
        if pattern == "root_slug":
            if is_feed_root_slug_article(link):
                return True
            continue
        if pattern and pattern in path:
            return True
    return False

def is_article_like_link(link):
    link_lower = link.lower()
    if "news.google.com/" in link_lower:
        return True
    if is_probably_section_url(link_lower):
        return False
    parsed = urlparse(link_lower)
    path = parsed.path or ""
    if is_allowed_domain_detail_article(link_lower):
        return True
    parts = [part for part in path.strip("/").split("/") if part]
    blocked_parts = {
        "category", "kateqoriya", "tag", "archive", "arxiv",
        "search", "author", "authors", "blog",
    }
    if any(part in blocked_parts for part in parts):
        return False
    if any(pattern in link_lower for pattern in ARTICLE_URL_PATTERNS):
        return True
    if any(pattern.search(path) for pattern in ARTICLE_URL_REGEX_PATTERNS):
        return True
    if re.search(r"\d{4}[/-]\d{1,2}[/-]\d{1,2}", path):
        return True
    if re.search(r"\d{6,}", path):
        return True
    if re.search(r"(news|xeber|post|article|story|read)", path, flags=re.IGNORECASE):
        if len(parts) >= 2 and parts[-1] not in {
            "news", "xeber", "xeberler", "xəbərlər", "post", "posts",
            "article", "articles", "story", "stories", "read",
        }:
            return True
        return False
    if is_language_slug_article(link_lower):
        return True
    if is_category_slug_article(link_lower):
        return True
    return is_allowed_root_slug_article(link_lower)


def is_bad_link(title, link):
    title_lower = title.lower()
    link_lower = link.lower()
    is_google_news_link = "news.google.com/" in link_lower
    bad_words = [
        "ana səhifə", "haqqımızda", "əlaqə", "reklam", "giriş", "qeydiyyat",
        "axtarış", "abunə", "facebook", "instagram", "youtube", "telegram",
        "twitter", "linkedin", "rss", "bütün xəbərlər", "daha çox", "arxiv",
        "kateqoriya", "bütün bölmələr", "menu", "menyu",
    ]
    bad_domains = ["facebook.com", "instagram.com", "youtube.com", "t.me", "twitter.com", "x.com", "linkedin.com"]
    bad_extensions = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".zip", ".rar", ".mp4", ".mp3"]
    if len(title) < 15:
        return True
    if any(word in title_lower for word in bad_words):
        return True
    if not is_google_news_link and any(word in link_lower for word in bad_words):
        return True
    if any(domain in link_lower for domain in bad_domains):
        return True
    if any(link_lower.endswith(ext) for ext in bad_extensions):
        return True
    if is_probably_section_url(link):
        return True
    return False


def add_item(results, page_url, title, link, keywords, extra=None):
    title = clean_article_text(title)
    link = urljoin(page_url, clean_text(link)).split("#")[0]
    if not title or not link.startswith("http"):
        return
    raw_title = title
    title_for_keyword = clean_title_for_message(title)
    if is_non_news_title(title_for_keyword):
        return
    page_domain = get_domain(page_url)
    link_domain = get_domain(link)
    is_google_news_link = "news.google.com" in {page_domain, link_domain}
    if page_domain and link_domain and page_domain != link_domain:
        # Google News fallback bəzən orijinal linki news.google yönləndiricisi ilə verir, ona görə source domain yoxdursa keçmirik.
        if not is_google_news_link:
            return
    if is_bad_link(title, link):
        return
    url_patterns = extra.get("url_patterns", []) if extra else []
    if not is_article_like_link(link):
        if not is_source_url_pattern_article(link, page_url, url_patterns):
            if not (extra and extra.get("source_context") == "rss" and is_feed_root_slug_article(link)):
                return
    item = {
        "title": title_for_keyword,
        "raw_title": raw_title,
        "clean_title": title_for_keyword,
        "link": link,
        "source": link_domain or page_domain,
        "matched_keywords": [],
    }
    if extra:
        item.update(extra)
    item.setdefault("source_context", "html")
    item.setdefault("item_position", len(results))
    results.append(item)


def unique_items(items):
    unique = {}
    for item in items:
        if item.get("link"):
            unique[normalize_link(item["link"])] = item
    return list(unique.values())


def looks_like_feed_reference(value):
    value = clean_text(value).lower()
    return any(token in value for token in [
        "rss", "atom", "feed", "xml", "jsonfeed", "rss-feed", "rss_lent",
        "rss-lent", "xeber lenti", "xəbər lenti", "news feed",
    ])


def discover_rss_links(page_url, page_html):
    rss_links = []
    try:
        soup = BeautifulSoup(page_html, "html.parser")
        for tag in soup.find_all("link", href=True):
            tag_type = (tag.get("type") or "").lower()
            tag_title = (tag.get("title") or "").lower()
            tag_rel = " ".join(tag.get("rel") or []).lower()
            href = tag.get("href")
            if (
                looks_like_feed_reference(tag_type)
                or looks_like_feed_reference(tag_title)
                or looks_like_feed_reference(tag_rel)
                or looks_like_feed_reference(href)
            ):
                rss_links.append(urljoin(page_url, href))
        for tag in soup.find_all("a", href=True):
            href = tag.get("href")
            label = " ".join([
                tag.get("title") or "",
                tag.get("aria-label") or "",
                tag.get_text(" ", strip=True) or "",
            ])
            if looks_like_feed_reference(href) or looks_like_feed_reference(label):
                rss_links.append(urljoin(page_url, href))
        root = get_base_url(page_url)
        for path in COMMON_RSS_PATHS:
            rss_links.append(urljoin(root, path))
    except Exception as exc:
        print(f"RSS link axtarışı xətası: {page_url} | {exc}", flush=True)
    return list(dict.fromkeys([
        item for item in rss_links
        if item and item.startswith("http") and not is_local_only_url(item)
    ]))[:12]


def extract_links_from_rss(site, rss_urls):
    results = []
    keywords = site.get("keywords", [])
    page_url = site.get("url") or site.get("base_url") or ""
    for rss_url in rss_urls:
        if not rss_url:
            continue
        if is_local_only_url(rss_url):
            print(f"RSS local URL keçildi: {rss_url}", flush=True)
            set_read_diagnostic(site, "unsafe_url", "rss")
            continue
        try:
            response = safe_request(
                rss_url,
                site=site,
                method="rss",
                headers=REQUEST_HEADERS,
                timeout=REQUEST_TIMEOUT,
                allow_redirects=True,
            )
            if response.status_code != 200:
                site["_last_http_status"] = response.status_code
                set_read_diagnostic(site, http_status_reason(response.status_code), "rss")
                continue
            feed = feedparser.parse(response.content)
            if feed.entries:
                sample_titles = [clean_article_text(entry.get("title", "")) for entry in feed.entries[:5]]
                if sample_titles and sum(mojibake_score(title) for title in sample_titles) > 0:
                    decoded_feed = feedparser.parse(decode_response_text(response))
                    decoded_titles = [clean_article_text(entry.get("title", "")) for entry in decoded_feed.entries[:5]]
                    if decoded_titles and sum(mojibake_score(title) for title in decoded_titles) < sum(mojibake_score(title) for title in sample_titles):
                        feed = decoded_feed
            if getattr(feed, "bozo", False) and not feed.entries:
                set_read_diagnostic(site, "invalid_xml", "rss")
                continue
            if not feed.entries:
                set_read_diagnostic(site, "rss_empty", "rss")
                continue
            site["_rss_feed_had_entries"] = True
            print(f"RSS tapıldı: {rss_url} | xəbər sayı: {len(feed.entries)}", flush=True)
            before_count = len(results)
            for entry in feed.entries[:MAX_LINKS_PER_SITE * 4]:
                title = clean_article_text(entry.get("title", ""))
                link = entry.get("link", "")
                published = entry.get("published") or entry.get("updated") or entry.get("created") or ""
                add_item(results, page_url or rss_url, title, link, keywords, {"rss_published": published, "source_context": "rss", "url_patterns": site.get("url_patterns", [])})
                if len(results) >= MAX_LINKS_PER_SITE:
                    break
            added = len(results) - before_count
            if added > 0:
                mark_read_success(site, "rss", site.get("_fallback_used", False))
                print(f"RSS uyğun namizəd verdi: {site.get('name')} | {added}", flush=True)
                break
            set_read_diagnostic(site, "no_article", "rss")
        except Exception as exc:
            reason = classify_fetch_exception(exc)
            set_read_diagnostic(site, reason, "rss")
            print(f"RSS oxuma xətası: {rss_url} | {reason} | {exc}", flush=True)
            continue
    return unique_items(results)[:MAX_LINKS_PER_SITE]

def extract_links_by_selector(page_url, page_html, selector, keywords, url_patterns=None):
    soup = BeautifulSoup(page_html, "html.parser")
    results = []

    try:
        blocks = soup.select(selector)
    except Exception as e:
        print("Selector xətası:", e, flush=True)
        return []

    print(f"Selector blok sayı: {len(blocks)} | {selector}", flush=True)

    # Çox böyük selector nəticələrində yalnız ilk blokları yoxlayırıq.
    # Məqsəd köhnə arxivlərə ilişib botun donmasının qarşısını almaqdır.
    blocks = blocks[:MAX_LINKS_PER_SITE * 3]

    for block in blocks:
        links = block.find_all("a", href=True)

        if getattr(block, "name", None) == "a" and block.get("href"):
            links.append(block)

        for a in links:
            title = clean_article_text(a.get_text(" ", strip=True))
            link = urljoin(page_url, a["href"])
            listing_published = extract_listing_publish_time(block, a)
            extra = {"url_patterns": url_patterns or [], "source_context": "selector"}
            if listing_published:
                extra["listing_published"] = listing_published

            add_item(results, page_url, title, link, keywords, extra)

            if len(results) >= MAX_LINKS_PER_SITE:
                return unique_items(results)

    return unique_items(results)


def extract_links_from_xpath(page_url, page_html, xpaths, keywords, url_patterns=None):
    results = []
    if not xpaths:
        return []
    try:
        tree = html.fromstring(page_html)
    except Exception as exc:
        print("HTML parse xətası:", exc, flush=True)
        return []
    invalid_count = 0
    for xpath in xpaths:
        xpath = clean_text(xpath)
        if not xpath:
            continue
        try:
            blocks = tree.xpath(xpath)
        except Exception:
            invalid_count += 1
            continue
        print(f"XPath üzrə blok sayı: {len(blocks)} | {xpath[:80]}", flush=True)
        for block in blocks:
            try:
                links = [block] if hasattr(block, "tag") and block.tag == "a" else block.xpath(".//a[@href]")
            except Exception:
                continue
            for a in links:
                href = a.get("href")
                title = clean_article_text(a.text_content())
                link = urljoin(page_url, href)
                listing_published = None
                try:
                    listing_published = extract_listing_publish_time_from_text(block.text_content())
                except Exception:
                    listing_published = None
                extra = {"url_patterns": url_patterns or [], "source_context": "selector"}
                if listing_published:
                    extra["listing_published"] = listing_published
                add_item(results, page_url, title, link, keywords, extra)
    if invalid_count:
        print(f"XPath invalid ifade kecildi: {invalid_count}", flush=True)
    return unique_items(results)[:MAX_LINKS_PER_SITE]


def extract_links_by_patterns(page_url, page_html, keywords, patterns, url_patterns=None):
    parser = "xml" if looks_like_xml_content(page_html) else "html.parser"
    soup = BeautifulSoup(page_html, parser)
    results = []
    for a in soup.find_all("a", href=True):
        title = clean_article_text(a.get_text(" ", strip=True))
        link = urljoin(page_url, a["href"])
        if not any(pattern.lower() in link.lower() for pattern in patterns):
            continue
        listing_published = extract_listing_publish_time(a.parent, a)
        extra = {"url_patterns": url_patterns or [], "source_context": "latest_page"}
        if listing_published:
            extra["listing_published"] = listing_published
        add_item(results, page_url, title, link, keywords, extra)
    return unique_items(results)[:MAX_LINKS_PER_SITE]


def extract_links_fallback(page_url, page_html, keywords, url_patterns=None):
    parser = "xml" if looks_like_xml_content(page_html) else "html.parser"
    soup = BeautifulSoup(page_html, parser)
    results = []

    links = soup.find_all("a", href=True)

    # Bütün arxivi yoxlamırıq. İlk 150 link kifayətdir.
    for a in links[:150]:
        title = clean_article_text(a.get_text(" ", strip=True))
        link = urljoin(page_url, a["href"])
        listing_published = extract_listing_publish_time(a.parent, a)
        extra = {"url_patterns": url_patterns or [], "source_context": "latest_page"}
        if listing_published:
            extra["listing_published"] = listing_published

        add_item(results, page_url, title, link, keywords, extra)

        if len(results) >= MAX_LINKS_PER_SITE:
            break

    return unique_items(results)



def extract_sitemap_locs(xml_text, base_url):
    locs = re.findall(r"<loc[^>]*>(.*?)</loc>", xml_text, flags=re.IGNORECASE | re.DOTALL)
    cleaned = []
    for loc in locs:
        value = clean_text(unescape(re.sub(r"<[^>]+>", "", loc)))
        if value:
            cleaned.append(urljoin(base_url, value))
    return list(dict.fromkeys(cleaned))


def collect_sitemap_article_urls(sitemap_url, site, depth=0, seen=None):
    if seen is None:
        seen = set()
    if not sitemap_url or sitemap_url in seen or depth > 2:
        return []
    seen.add(sitemap_url)

    try:
        response = safe_request(sitemap_url, site=site, method="sitemap", headers=REQUEST_HEADERS, timeout=REQUEST_TIMEOUT, allow_redirects=True)
        if response.status_code != 200:
            site["_last_http_status"] = response.status_code
            if depth == 0:
                set_read_diagnostic(site, http_status_reason(response.status_code), "sitemap")
            return []

        xml_text = decode_response_text(response)
        urls = extract_sitemap_locs(xml_text, response.url or sitemap_url)
        if looks_like_xml_content(xml_text) and not urls:
            if depth == 0:
                set_read_diagnostic(site, "invalid_xml", "sitemap")
            return []
        if not urls:
            return []

        url_patterns = site.get("url_patterns", [])
        article_urls = [url for url in urls if is_article_like_link(url) or is_source_url_pattern_article(url, sitemap_url, url_patterns)]
        if len(article_urls) >= SOURCE_SITEMAP_SCAN_LIMIT or depth >= 2:
            return article_urls[:SOURCE_SITEMAP_SCAN_LIMIT]

        child_sitemaps = [
            url for url in urls
            if re.search(r"sitemap|\.xml(?:$|[?#])", url, flags=re.IGNORECASE)
            and not is_article_like_link(url)
        ][:4]
        for child_url in child_sitemaps:
            article_urls.extend(collect_sitemap_article_urls(child_url, site, depth + 1, seen))
            if len(article_urls) >= SOURCE_SITEMAP_SCAN_LIMIT:
                break
        return list(dict.fromkeys(article_urls))[:SOURCE_SITEMAP_SCAN_LIMIT]
    except Exception as exc:
        if depth == 0:
            reason = classify_fetch_exception(exc)
            set_read_diagnostic(site, reason, "sitemap")
            print(f"Sitemap oxuma xetasi: {sitemap_url} | {reason} | {exc}", flush=True)
        return []


def extract_links_from_sitemap(site):
    sitemap_url = site.get("latest_url") or urljoin(site.get("base_url", "").rstrip("/") + "/", "sitemap.xml")
    keywords = site.get("keywords", [])
    results = []
    urls = collect_sitemap_article_urls(sitemap_url, site)
    if not urls and not site.get("_read_failure_reason"):
        set_read_diagnostic(site, "sitemap_empty", "sitemap")
        return []

    for url in urls[:SOURCE_SITEMAP_SCAN_LIMIT]:
        try:
            article = safe_request(url, site=site, method="sitemap_article", headers=REQUEST_HEADERS, timeout=REQUEST_TIMEOUT, allow_redirects=True)
            if article.status_code != 200:
                site["_last_http_status"] = article.status_code
                continue
            soup = BeautifulSoup(decode_response_text(article), "html.parser")
            title = ""
            if soup.find("meta", property="og:title"):
                title = soup.find("meta", property="og:title").get("content", "")
            if not title and soup.find("title"):
                title = soup.find("title").get_text(" ", strip=True)
            add_item(results, url, title, url, keywords, {"url_patterns": site.get("url_patterns", []), "source_context": "sitemap"})
            if len(results) >= MAX_LINKS_PER_SITE:
                break
        except Exception:
            continue

    results = unique_items(results)[:MAX_LINKS_PER_SITE]
    if results:
        mark_read_success(site, "sitemap", site.get("_fallback_used", False))
    elif not site.get("_read_failure_reason"):
        set_read_diagnostic(site, "sitemap_empty", "sitemap")
    return results

def fetch_page(url):
    headers = REQUEST_HEADERS
    try:
        print(f"Sayt açılır: {url}", flush=True)
        response = safe_request(url, headers=headers, timeout=REQUEST_TIMEOUT, allow_redirects=True)
        print(f"Status: {response.status_code}", flush=True)
        if response.status_code != 200:
            return None
        return decode_response_text(response)
    except Exception as exc:
        print(f"Sayt xətası: {url} | {exc}", flush=True)
        return None





def try_safe_blocked_source_fallback(site, base_url, status_reason):
    """Try low-pressure alternatives when the configured page is blocked."""
    root = (base_url or site.get("base_url") or site.get("url") or "").rstrip("/") + "/"
    if not root.startswith("http") or is_local_only_url(root):
        return []

    print(f"Blok/HTTP xetasi fallback yoxlanir: {root} | {status_reason}", flush=True)
    site["_fallback_used"] = True

    rss_candidates = []
    rss_url = clean_text(site.get("rss_url", ""))
    if rss_url:
        rss_candidates.append(rss_url)
    rss_candidates.extend([urljoin(root, path.lstrip("/")) for path in COMMON_RSS_PATHS])
    rss_candidates = list(dict.fromkeys([url for url in rss_candidates if url and not is_local_only_url(url)]))[:8]

    if rss_candidates:
        items = extract_links_from_rss(site, rss_candidates)
        if items:
            mark_read_success(site, "rss", fallback_used=True)
            return unique_items(items)

    sitemap_site = dict(site)
    sitemap_site["latest_url"] = urljoin(root, "sitemap.xml")
    sitemap_site["_fallback_used"] = True
    items = extract_links_from_sitemap(sitemap_site)
    if items:
        site.update({
            "_read_failure_reason": sitemap_site.get("_read_failure_reason"),
            "_method_attempted": sitemap_site.get("_method_attempted"),
            "_method_succeeded": sitemap_site.get("_method_succeeded"),
            "_fallback_used": True,
        })
        mark_read_success(site, "sitemap", fallback_used=True)
        return unique_items(items)

    domain = get_domain(root)
    if domain:
        google_url = f"https://news.google.com/rss/search?q=site%3A{domain}%20when%3A{google_news_when_window()}&hl=az&gl=AZ&ceid=AZ:az"
        items = extract_links_from_rss(site, [google_url])
        if items:
            mark_read_success(site, "google_news", fallback_used=True)
            return unique_items(items)

    set_read_diagnostic(site, status_reason, clean_text(site.get("monitor_method", "")) or "latest_page", fallback_used=True)
    return []

def fetch_site(site, patterns_data):
    page_url = site["url"]
    base_url = clean_text(site.get("base_url", "")) or page_url
    rss_url = clean_text(site.get("rss_url", ""))
    selector = site.get("selector")
    xpaths = site.get("xpaths", []) or parse_article_patterns(site.get("article_pattern"))
    url_patterns = site.get("url_patterns", []) or parse_url_patterns(site.get("article_pattern"))
    keywords = site.get("keywords", [])
    monitor_method = clean_text(site.get("monitor_method", "")).lower()
    if monitor_method == "xpath":
        monitor_method = "xpath_pattern"

    headers = REQUEST_HEADERS

    print(
        f"Metod: {monitor_method or 'auto'} | {site.get('name')} | {page_url}",
        flush=True,
    )
    first_url_pattern = url_patterns[0] if url_patterns else "-"
    if len(first_url_pattern) > 80:
        first_url_pattern = first_url_pattern[:77] + "..."
    print(
        "Mənbə konfiqi: "
        f"source={site.get('name')} | "
        f"method={monitor_method or 'auto'} | "
        f"latest={'yes' if page_url else 'no'} | "
        f"rss={'yes' if rss_url else 'no'} | "
        f"selector={'yes' if selector else 'no'} | "
        f"xpath={len(xpaths)} | "
        f"url_pattern={len(url_patterns)} | "
        f"first_url_pattern={first_url_pattern}",
        flush=True,
    )

    if is_local_only_url(page_url):
        set_read_diagnostic(site, "unsafe_url", monitor_method or "latest_page")
        print(f"Unsafe/local URL keçildi: {page_url}", flush=True)
        return []

    # 1) Google News fallback:
    # Bu metodda əsas sayt açılmır. Yalnız Google News RSS oxunur.
    # Report.az kimi 403 verən saytlar üçün əsas məqsəd də budur.
    if monitor_method == "google_news_fallback":
        google_rss_urls = []

        if rss_url and "news.google.com/rss" in rss_url:
            google_rss_urls.append(rss_url)
        else:
            domain = get_domain(base_url or page_url)

            if domain:
                when_window = google_news_when_window()
                google_rss_urls.append(
                    f"https://news.google.com/rss/search?q=site%3A{domain}%20when%3A{when_window}&hl=az&gl=AZ&ceid=AZ:az"
                )

        print(
            f"Google News fallback yalnız RSS oxuyur: {google_rss_urls[0] if google_rss_urls else 'RSS yoxdur'}",
            flush=True,
        )

        if google_rss_urls:
            items = extract_links_from_rss(site, google_rss_urls)
            if items:
                mark_read_success(site, "google_news")
            return items

        set_read_diagnostic(site, "rss_empty", "google_news")
        return []

    # 2) Legacy blocked/dead/failed method labels:
    # These labels describe a previous health state, not a real reading method.
    # Keep active sources in the read pipeline so domains that recovered, changed
    # layout, or were repaired can be confirmed by the real bot cycle.
    if monitor_method in {"blocked", "dead", "failed"}:
        previous_method = monitor_method
        monitor_method = "recoverable"
        site["monitor_method"] = monitor_method
        site["_fallback_used"] = True
        record_method_attempt(site, previous_method)
        print(
            f"Metod {previous_method}: aktiv mənbə recoverable kimi yenidən yoxlanır.",
            flush=True,
        )

    # 3) RSS metodları:
    # RSS varsa əvvəl RSS oxunur. Uyğun nəticə çıxsa, sayt əlavə gəzilmir.
    if monitor_method in {"rss", "rss_discovered"}:
        rss_candidates = []

        if rss_url:
            rss_candidates.append(rss_url)

        if not rss_candidates:
            try:
                discovery_response = safe_request(
                    base_url,
                    site=site,
                    method="rss_discovery",
                    headers=REQUEST_HEADERS,
                    timeout=REQUEST_TIMEOUT,
                    allow_redirects=True,
                )
                if discovery_response.status_code == 200:
                    rss_candidates.extend(discover_rss_links(discovery_response.url or base_url, discovery_response.text))
            except Exception as exc:
                print(f"RSS discovery homepage xetasi: {base_url} | {classify_fetch_exception(exc)} | {exc}", flush=True)

            root = base_url.rstrip("/") + "/"
            rss_candidates.extend([urljoin(root, path.lstrip("/")) for path in COMMON_RSS_PATHS])
            rss_candidates = list(dict.fromkeys(rss_candidates))

        print(f"RSS-only yoxlanır: {rss_candidates[:3]}", flush=True)

        items = extract_links_from_rss(site, rss_candidates)

        if items:
            mark_read_success(site, "rss")
            return unique_items(items)

        if site.pop("_rss_feed_had_entries", False):
            print("RSS feed oxundu, amma qebul edilen meqale linki tapilmadi. HTML fallback yoxlanacaq.", flush=True)
            set_read_diagnostic(site, "no_article", "rss", fallback_used=True)
            site["_fallback_used"] = True
        else:
            print("RSS netice vermedi, HTML fallback yoxlanacaq.", flush=True)
    # 4) Sitemap:
    # Səndə olan extract_links_from_sitemap(site) funksiyasından istifadə edir.
    if monitor_method == "sitemap":
        items = extract_links_from_sitemap(site)

        if items:
            mark_read_success(site, "sitemap")
            return unique_items(items)

        if not site.get("_read_failure_reason"):
            set_read_diagnostic(site, "sitemap_empty", "sitemap", fallback_used=True)
        site["_fallback_used"] = True
        if base_url:
            page_url = base_url
        print("Sitemap netice vermedi, HTML fallback yoxlanacaq.", flush=True)
    # 5) HTML əsaslı metodlar
    try:
        print(f"Sayt açılır: {page_url}", flush=True)

        r = safe_request(
            page_url,
            site=site,
            method=monitor_method or "latest_page",
            headers=headers,
            timeout=REQUEST_TIMEOUT,
            allow_redirects=True,
        )

        print(f"Status: {r.status_code}", flush=True)

        if r.status_code != 200:
            site["_last_http_status"] = r.status_code
            status_reason = http_status_reason(r.status_code)
            if r.status_code in {403, 429}:
                fallback_items = try_safe_blocked_source_fallback(site, base_url, status_reason)
                if fallback_items:
                    return fallback_items
            set_read_diagnostic(site, status_reason, monitor_method or "latest_page")
            return []

        page_html = decode_response_text(r)

    except Exception as e:
        reason = classify_fetch_exception(e)
        set_read_diagnostic(site, reason, monitor_method or "latest_page")
        print(f"Sayt xətası: {page_url} | {reason} | {e}", flush=True)
        return []

    domain = get_domain(page_url)
    site_patterns = patterns_data.get(domain, [])

    # 6) Selector metodu
    if monitor_method == "selector":
        if not selector:
            set_read_diagnostic(site, "selector_empty", "selector")
        else:
            items = extract_links_by_selector(page_url, page_html, selector, keywords, url_patterns)

            if items:
                mark_read_success(site, "selector")
                return unique_items(items)

            print("Selector nəticə vermədi, fallback yoxlanacaq.", flush=True)
            set_read_diagnostic(site, "selector_empty", "selector")

    # 7) XPath metodu
    if monitor_method == "xpath_pattern":
        if not xpaths:
            set_read_diagnostic(site, "xpath_empty", "xpath")
        else:
            items = extract_links_from_xpath(page_url, page_html, xpaths, keywords, url_patterns)

            if items:
                mark_read_success(site, "xpath")
                return unique_items(items)

            print("XPath nəticə vermədi, fallback yoxlanacaq.", flush=True)
            set_read_diagnostic(site, "xpath_empty", "xpath")

    # 8) Latest/Homepage/Recoverable/Auto metodları
    if monitor_method in {
        "latest_page",
        "homepage",
        "recoverable",
        "selector",
        "xpath_pattern",
        "rss",
        "rss_discovered",
        "sitemap",
        "",
    }:
        if not rss_url and monitor_method not in {"rss", "rss_discovered"}:
            discovered_rss = discover_rss_links(page_url, page_html)

            if discovered_rss:
                site["_fallback_used"] = True
                items = extract_links_from_rss(site, discovered_rss)

                if items:
                    mark_read_success(site, "rss", fallback_used=True)
                    return unique_items(items)

        items = []

        if selector and monitor_method != "selector":
            items = extract_links_by_selector(page_url, page_html, selector, keywords, url_patterns)
            if items:
                mark_read_success(site, "selector", fallback_used=monitor_method not in {"selector", ""})

        if not items and xpaths and monitor_method != "xpath_pattern":
            items = extract_links_from_xpath(page_url, page_html, xpaths, keywords, url_patterns)
            if items:
                mark_read_success(site, "xpath", fallback_used=monitor_method not in {"xpath_pattern", ""})

        if not items and site_patterns:
            print(f"Pattern fallback işləyir: {domain}", flush=True)
            items = extract_links_by_patterns(
                page_url,
                page_html,
                keywords,
                site_patterns,
                url_patterns,
            )
            if items:
                mark_read_success(site, "fallback", fallback_used=True)

        if not items:
            print("HTML fallback işləyir...", flush=True)
            items = extract_links_fallback(page_url, page_html, keywords, url_patterns)
            if items:
                method = "homepage" if monitor_method == "homepage" else "latest_page"
                if monitor_method in {"recoverable", "selector", "xpath_pattern", "rss", "rss_discovered"}:
                    method = "fallback"
                mark_read_success(site, method, fallback_used=method == "fallback")

        items = unique_items(items)
        if not items:
            hrefs = [a["href"] for a in BeautifulSoup(page_html, "html.parser").find_all("a", href=True)]
            print(f"Boş nəticə: html={len(page_html)} | linklər={len(hrefs)} | nümunə={hrefs[:3]}", flush=True)
            final_method = "fallback" if site.get("_fallback_used") else (monitor_method or "latest_page")
            final_reason = empty_reason_for_method(final_method)
            if not site.get("_read_failure_reason") or final_reason in {"homepage_empty", "latest_page_empty", "fallback_empty"}:
                set_read_diagnostic(site, final_reason, final_method)
        return items

    set_read_diagnostic(site, empty_reason_for_method(monitor_method or "latest_page"), monitor_method or "latest_page")
    return []

def get_existing_monitor_match_id(monitor_id, item_id):
    if not supabase_ready() or not monitor_id or not item_id:
        return None
    try:
        response = requests.get(
            f"{SUPABASE_URL}/rest/v1/monitor_matches",
            headers=supabase_headers(),
            params={"select": "id", "monitor_id": f"eq.{monitor_id}", "item_id": f"eq.{item_id}", "limit": "1"},
            timeout=REQUEST_TIMEOUT,
        )
        if response.status_code == 200 and response.json():
            return response.json()[0].get("id")
        return None
    except Exception as exc:
        print(f"Monitor match_id oxuma xətası: {exc}", flush=True)
        return None


def get_existing_monitor_alert_id(match_id):
    if not supabase_ready() or not match_id:
        return None
    try:
        response = requests.get(
            f"{SUPABASE_URL}/rest/v1/monitor_alerts",
            headers=supabase_headers(),
            params={"select": "id", "match_id": f"eq.{match_id}", "limit": "1"},
            timeout=REQUEST_TIMEOUT,
        )
        if response.status_code == 200 and response.json():
            return response.json()[0].get("id")
        return None
    except Exception as exc:
        print(f"Bildiriş mövcudluq istisnası: {exc}", flush=True)
        return None


def create_monitor_alert(match_id):
    if not supabase_ready() or not match_id:
        return False
    if get_existing_monitor_alert_id(match_id):
        print(f"⛔ Bildiriş artıq mövcuddur: match={match_id}", flush=True)
        return False
    payload_variants = [
        {"match_id": match_id, "channel": "web", "recipient": "admin", "status": "new", "sent_at": datetime.now(BAKU_TZ).isoformat()},
        {"match_id": match_id, "channel": "web", "recipient": "admin", "status": "new"},
        {"match_id": match_id, "status": "new"},
    ]
    last_error = ""
    for payload in payload_variants:
        try:
            response = requests.post(
                f"{SUPABASE_URL}/rest/v1/monitor_alerts",
                headers=supabase_headers({"Prefer": "return=representation"}),
                json=payload,
                timeout=REQUEST_TIMEOUT,
            )
            if response.status_code in (200, 201):
                data = response.json() or []
                alert_id = data[0].get("id") if data else None
                print(f"🔔 Bildiriş yaradıldı: match={match_id} | alert={alert_id}", flush=True)
                return True
            if response.status_code == 409:
                return False
            last_error = f"{response.status_code} | {response.text[:300]}"
        except Exception as exc:
            last_error = str(exc)
    print(f"Bildiriş yazılmadı: match={match_id} | son xəta: {last_error}", flush=True)
    return False


def get_user_telegram_chat_id(user_id):
    if not supabase_ready() or not user_id:
        return ""
    if user_id in USER_TELEGRAM_CACHE and time.time() - USER_TELEGRAM_CACHE_AT.get(user_id, 0) < USER_TELEGRAM_CACHE_SECONDS:
        return USER_TELEGRAM_CACHE[user_id]
    USER_TELEGRAM_CACHE_AT[user_id] = time.time()
    try:
        response = requests.get(
            f"{SUPABASE_URL}/rest/v1/user_profiles",
            headers=supabase_headers(),
            params={"select": "telegram_chat_id", "user_id": f"eq.{user_id}", "limit": "1"},
            timeout=REQUEST_TIMEOUT,
        )
        if response.status_code == 200 and response.json():
            telegram_chat_id = clean_text(response.json()[0].get("telegram_chat_id"))
        else:
            telegram_chat_id = ""
        USER_TELEGRAM_CACHE[user_id] = telegram_chat_id
        return telegram_chat_id
    except Exception as exc:
        print(f"User profile Telegram oxuma istisnasi: {exc}", flush=True)
        USER_TELEGRAM_CACHE[user_id] = ""
        return ""


def cleanup_old_monitor_data_if_needed():
    global LAST_MONITOR_CLEANUP
    if not supabase_ready():
        return
    now = datetime.now(BAKU_TZ)
    if LAST_MONITOR_CLEANUP and now - LAST_MONITOR_CLEANUP < timedelta(hours=24):
        return
    try:
        response = requests.post(
            f"{SUPABASE_URL}/rest/v1/rpc/cleanup_old_monitor_data",
            headers=supabase_headers(),
            json={"days_to_keep": MONITOR_DATA_RETENTION_DAYS},
            timeout=REQUEST_TIMEOUT,
        )
        if response.status_code in (200, 204):
            LAST_MONITOR_CLEANUP = now
            print(f"Monitor cleanup tamamlandi: {MONITOR_DATA_RETENTION_DAYS} gun saxlanildi", flush=True)
        else:
            print(f"Monitor cleanup xetasi: {response.status_code} | {response.text[:200]}", flush=True)
    except Exception as exc:
        print(f"Monitor cleanup istisnasi: {exc}", flush=True)
    cleanup_old_log_rows(now)


def account_housekeeping_if_needed():
    """Hourly: end demos whose 7 days are over, and tell admins about new sign-ups."""
    global LAST_ACCOUNT_HOUSEKEEPING
    if not supabase_ready():
        return
    now = datetime.now(BAKU_TZ)
    if LAST_ACCOUNT_HOUSEKEEPING and now - LAST_ACCOUNT_HOUSEKEEPING < timedelta(hours=1):
        return
    LAST_ACCOUNT_HOUSEKEEPING = now
    try:
        response = requests.post(
            f"{SUPABASE_URL}/rest/v1/rpc/expire_demo_accounts",
            headers=supabase_headers(),
            json={},
            timeout=REQUEST_TIMEOUT,
        )
        if response.status_code == 200:
            expired = response.json() or 0
            if expired:
                print(f"Demo müddəti bitən hesablar: {expired}", flush=True)
        else:
            print(f"Demo expiry xetasi: {response.status_code} | {response.text[:200]}", flush=True)
    except Exception as exc:
        print(f"Demo expiry istisnasi: {exc}", flush=True)
    notify_admins_about_pending_signups()


def notify_admins_about_pending_signups():
    try:
        response = requests.get(
            f"{SUPABASE_URL}/rest/v1/user_profiles",
            headers=supabase_headers(),
            params={
                "select": "user_id,email,created_at",
                "status": "eq.pending",
                "signup_notified_at": "is.null",
                "order": "created_at.asc",
                "limit": "20",
            },
            timeout=REQUEST_TIMEOUT,
        )
        if response.status_code != 200:
            print(f"Yeni müraciətlər oxuma xetasi: {response.status_code} | {response.text[:200]}", flush=True)
            return
        pending = response.json() or []
        if not pending:
            return
        chat_ids = admin_chat_ids()
        if not chat_ids:
            return
        emails = "\n".join(f"• {clean_text(row.get('email')) or row.get('user_id')}" for row in pending)
        message = f"🆕 Yeni qeydiyyat müraciəti ({len(pending)}):\n{emails}\n\nAdmin paneldə İstifadəçilər bölməsindən təsdiqləyin və ya rədd edin."
        if not any([send_telegram(message, chat_id=chat_id, bypass_pause=True) for chat_id in chat_ids]):
            return
        user_ids = ",".join(row["user_id"] for row in pending if row.get("user_id"))
        requests.patch(
            f"{SUPABASE_URL}/rest/v1/user_profiles",
            headers=supabase_headers({"Prefer": "return=minimal"}),
            params={"user_id": f"in.({user_ids})", "status": "eq.pending"},
            json={"signup_notified_at": datetime.now(BAKU_TZ).isoformat()},
            timeout=REQUEST_TIMEOUT,
        )
    except Exception as exc:
        print(f"Yeni müraciət bildirişi istisnasi: {exc}", flush=True)


def log_retention_rules(now):
    """(table, timestamp column, cutoff) for rows that are logs, not customer data."""
    log_cutoff = now - timedelta(days=max(LOG_RETENTION_DAYS, 1))
    # sent_news is the URL dedupe list: keep it as long as the monitored items.
    dedupe_cutoff = now - timedelta(days=max(MONITOR_DATA_RETENTION_DAYS, LOG_RETENTION_DAYS, 1))
    day_cutoff = now - timedelta(days=1)
    return [
        ("discovery_logs", "created_at", log_cutoff),
        ("sent_news", "created_at", dedupe_cutoff),
        ("telegram_link_tokens", "expires_at", day_cutoff),
        ("edge_rate_limits", "window_start", day_cutoff),
    ]


def cleanup_old_log_rows(now):
    for table, column, cutoff in log_retention_rules(now):
        try:
            response = requests.delete(
                f"{SUPABASE_URL}/rest/v1/{table}",
                headers=supabase_headers({"Prefer": "return=minimal"}),
                params={column: f"lt.{cutoff.isoformat()}"},
                timeout=REQUEST_TIMEOUT,
            )
            if response.status_code not in (200, 204):
                print(f"Log cleanup xetasi: {table} | {response.status_code} | {response.text[:160]}", flush=True)
        except Exception as exc:
            print(f"Log cleanup istisnasi: {table} | {redact_secrets(exc)}", flush=True)


def save_to_vizual_monitor(site, item, clean_title, published_time):
    if not supabase_ready():
        return None
    link = normalize_link(item.get("link"))
    if not link:
        return None
    source_id = get_or_create_monitor_source(
        site.get("name"),
        item.get("source"),
        site.get("url"),
        site.get("id"),
    )
    if not source_id:
        print("Vizual Monitor: source_id tapılmadı", flush=True)
        return None
    item["_source_id"] = source_id
    dt = parse_datetime_to_baku(published_time)
    payload = {
        "source_id": source_id,
        "title": clean_title,
        "url": link,
        "published_at": dt.isoformat() if dt else None,
        "detected_at": datetime.now(BAKU_TZ).isoformat(),
        "item_hash": link,
        "status": "new",
    }
    try:
        response = requests.post(
            f"{SUPABASE_URL}/rest/v1/monitored_items",
            headers=supabase_headers({"Prefer": "resolution=ignore-duplicates,return=representation"}),
            json=payload,
            timeout=REQUEST_TIMEOUT,
        )
        if response.status_code in (200, 201) and response.json():
            item_id = response.json()[0].get("id")
            print(f"✅ Vizual Monitor-a yazıldı: {clean_title[:80]}", flush=True)
            return item_id
        if response.status_code in (204, 409):
            existing = requests.get(
                f"{SUPABASE_URL}/rest/v1/monitored_items",
                headers=supabase_headers(),
                params={"select": "id,source_id", "url": f"eq.{link}", "limit": "1"},
                timeout=REQUEST_TIMEOUT,
            )
            if existing.status_code == 200 and existing.json():
                existing_item = existing.json()[0]
                existing_item_id = existing_item.get("id")
                existing_source_id = existing_item.get("source_id")
                if existing_item_id and existing_source_id != source_id:
                    patch_response = requests.patch(
                        f"{SUPABASE_URL}/rest/v1/monitored_items",
                        headers=supabase_headers({"Prefer": "return=minimal"}),
                        params={"id": f"eq.{existing_item_id}"},
                        json={"source_id": source_id},
                        timeout=REQUEST_TIMEOUT,
                    )
                    if patch_response.status_code in (200, 204):
                        print(f"Vizual Monitor source_id düzəldildi: item={existing_item_id} | source={source_id}", flush=True)
                return existing_item_id
        print(f"Vizual Monitor yazma xətası: {response.status_code} | {response.text[:300]}", flush=True)
        return None
    except Exception as exc:
        print(f"Vizual Monitor istisnası: {exc}", flush=True)
        return None


def inactive_account_user_ids():
    """Owners whose monitors must not run: pending, rejected, expired, inactive, blocked."""
    try:
        response = requests.get(
            f"{SUPABASE_URL}/rest/v1/user_profiles",
            headers=supabase_headers(),
            params={"select": "user_id", "status": "neq.active"},
            timeout=REQUEST_TIMEOUT,
        )
        if response.status_code != 200:
            print(f"Hesab statusu oxuma xetasi: {response.status_code} | {response.text[:200]}", flush=True)
            return None
        return {row.get("user_id") for row in response.json() or [] if row.get("user_id")}
    except Exception as exc:
        print(f"Hesab statusu istisnasi: {exc}", flush=True)
        return None


def load_active_monitor_keywords():
    if not supabase_ready():
        return None
    try:
        response = requests.get(
            f"{SUPABASE_URL}/rest/v1/monitor_keywords",
            headers=supabase_headers(),
            params={
                "select": "*,user_monitors(id,name,user_id,status,notify_telegram,telegram_chat_id)"
            },
            timeout=REQUEST_TIMEOUT,
        )
        if response.status_code != 200:
            print(f"Monitor keyword cache oxuma xetasi: {response.status_code} | {response.text[:200]}", flush=True)
            return None
        rows = response.json() or []
        inactive_owners = inactive_account_user_ids()
        if inactive_owners is None:
            return None
        active_rows = [
            row
            for row in rows
            if keyword_is_active(row)
            and (row.get("user_monitors") or {}).get("user_id") not in inactive_owners
        ]
        print(f"Aktiv açar söz cache: {len(active_rows)}", flush=True)
        return active_rows
    except Exception as exc:
        print(f"Monitor keyword cache istisnasi: {exc}", flush=True)
        return None

def find_matching_user_monitors(title, monitor_keywords_cache=None):
    if not supabase_ready():
        return []
    title_text = normalize_text(title)
    try:
        keywords = load_active_monitor_keywords() if monitor_keywords_cache is None else monitor_keywords_cache
        if keywords is None:
            return []
        matched_monitors = []
        seen_matches = set()
        for row in keywords:
            monitor = row.get("user_monitors") or {}
            if not keyword_is_active(row):
                continue
            keyword_original = row.get("keyword", "")
            keyword = normalize_text(keyword_original)
            if not keyword_matches_title(keyword, title_text):
                continue
            match_key = (row.get("monitor_id"), keyword)
            if match_key in seen_matches:
                continue
            seen_matches.add(match_key)
            matched_monitors.append(
                {
                    "monitor_id": row.get("monitor_id"),
                    "monitor_name": monitor.get("name") or "Monitor",
                    "keyword": keyword_original,
                    "telegram_chat_id": get_user_telegram_chat_id(monitor.get("user_id")),
                    "notify_telegram": monitor.get("notify_telegram") is not False,
                }
            )
        return matched_monitors
    except Exception as exc:
        print(f"Monitor keyword yoxlama istisnasi: {exc}", flush=True)
        return []


def match_user_monitors(item_id, title, monitor_keywords_cache=None):
    if not supabase_ready() or not item_id:
        return []
    title_text = normalize_text(title)
    try:
        keywords = load_active_monitor_keywords() if monitor_keywords_cache is None else monitor_keywords_cache
        if keywords is None:
            return []
        matched_monitors = []
        seen_matches = set()
        for row in keywords:
            monitor = row.get("user_monitors") or {}
            if not keyword_is_active(row):
                continue
            keyword_original = row.get("keyword", "")
            keyword = normalize_text(keyword_original)
            if not keyword_matches_title(keyword, title_text):
                continue
            match_key = (row.get("monitor_id"), keyword)
            if match_key not in seen_matches:
                seen_matches.add(match_key)
                matched_monitors.append(
                    {
                        "monitor_id": row.get("monitor_id"),
                        "monitor_name": monitor.get("name") or "Monitor",
                        "keyword": keyword_original,
                        "telegram_chat_id": get_user_telegram_chat_id(monitor.get("user_id")),
                        "notify_telegram": monitor.get("notify_telegram") is not False,
                    }
                )
            payload = {"monitor_id": row.get("monitor_id"), "item_id": item_id, "matched_keyword": keyword_original}
            match_response = requests.post(
                f"{SUPABASE_URL}/rest/v1/monitor_matches",
                headers=supabase_headers({"Prefer": "resolution=ignore-duplicates,return=representation"}),
                json=payload,
                timeout=REQUEST_TIMEOUT,
            )
            if match_response.status_code in (200, 201):
                match_data = match_response.json() or []
                match_id = match_data[0].get("id") if match_data else None
                print(f"✅ Monitor uyğunluğu yazıldı: {keyword_original} | item={item_id}", flush=True)
                if match_id:
                    create_monitor_alert(match_id)
            elif match_response.status_code in (204, 409):
                match_id = get_existing_monitor_match_id(row.get("monitor_id"), item_id)
                if match_id:
                    create_monitor_alert(match_id)
            else:
                print(f"Monitor match yazma xətası: {match_response.status_code} | {match_response.text[:200]}", flush=True)
        return matched_monitors
    except Exception as exc:
        print(f"Monitor match istisnası: {exc}", flush=True)
        return []


def extract_keywords_from_rules(site):
    keywords = set()
    for keyword in site.get("keywords", []):
        if str(keyword).strip():
            keywords.add(str(keyword).lower().strip())
    for rule in site.get("condition_rules", []):
        value = rule.get("value", "")
        for part in re.split(r"[|\r\n]+", value):
            word = clean_text(part).replace(".*", "").strip()
            if word and len(word) > 1:
                keywords.add(word.lower())
    return list(keywords)


def parse_article_patterns(value):
    if isinstance(value, list):
        return [clean_text(item) for item in value if clean_text(item) and not clean_text(item).lower().startswith("url:")]
    text = clean_text(value)
    if not text:
        return []
    return [clean_text(item) for item in text.split(",") if clean_text(item) and not clean_text(item).lower().startswith("url:")]


def parse_url_patterns(value):
    if isinstance(value, list):
        parts = [clean_text(item) for item in value]
    else:
        text = clean_text(value)
        parts = text.split(",") if text else []
    patterns = []
    for item in parts:
        item = clean_text(item)
        if item.lower().startswith("url:"):
            value = clean_text(item[4:])
            if value:
                patterns.append(value)
    return patterns

def load_sites():
    if not supabase_ready():
        print("Supabase bağlantısı yoxdur, sources oxunmadı.", flush=True)
        return []

    all_sites = []
    seen_urls = set()
    source_select = "id,name,base_url,latest_url,rss_url,status,source_type,trust_level,monitor_method,selector,article_pattern,discovery_status,discovery_score,notes"
    if SOURCE_HEALTH_ENABLED:
        source_select += ",last_checked_at,last_success_at,last_article_found_at,last_error,consecutive_fail_count,last_result"
    try:
        offset = 0
        page_size = 1000
        while True:
            response = requests.get(
                f"{SUPABASE_URL}/rest/v1/sources",
                headers=supabase_headers(),
                params={
                    "select": source_select,
                    "status": "eq.active",
                    **({"notes": "ilike.*[release_repair]*"} if VERIFY_RELEASE_REPAIR_ONLY else {}),
                    "order": "name.asc",
                    "limit": str(page_size),
                    "offset": str(offset),
                },
                timeout=REQUEST_TIMEOUT,
            )
            if response.status_code != 200 and SOURCE_HEALTH_ENABLED:
                print("Source health sütunları oxunmadı, köhnə sources select ilə davam edilir.", flush=True)
                source_select = "id,name,base_url,latest_url,rss_url,status,source_type,trust_level,monitor_method,selector,article_pattern,discovery_status,discovery_score,notes"
                response = requests.get(
                    f"{SUPABASE_URL}/rest/v1/sources",
                    headers=supabase_headers(),
                    params={
                        "select": source_select,
                        "status": "eq.active",
                        **({"notes": "ilike.*[release_repair]*"} if VERIFY_RELEASE_REPAIR_ONLY else {}),
                        "order": "name.asc",
                        "limit": str(page_size),
                        "offset": str(offset),
                    },
                    timeout=REQUEST_TIMEOUT,
                )
            if response.status_code != 200:
                print(f"Supabase sources oxuma xətası: {response.status_code} | {response.text[:300]}", flush=True)
                return []
            rows = response.json() or []
            if not rows:
                break
            for row in rows:
                base_url = clean_text(row.get("base_url", ""))
                latest_url = clean_text(row.get("latest_url", ""))
                rss_url = clean_text(row.get("rss_url", ""))
                method = clean_text(row.get("monitor_method", "")).lower()
                article_pattern = row.get("article_pattern") or ""
                xpaths = parse_article_patterns(article_pattern)
                url_patterns = parse_url_patterns(article_pattern)
                if method == "xpath":
                    method = "xpath_pattern"

                fail_count = int(row.get("consecutive_fail_count") or 0)
                pending_bot_proof_results = {"repair_readable", "source_added"}
                last_result = clean_text(row.get("last_result", ""))
                if (
                    SOURCE_HEALTH_ENABLED
                    and SOURCE_MAX_CONSECUTIVE_FAILS > 0
                    and fail_count >= SOURCE_MAX_CONSECUTIVE_FAILS
                    and last_result not in pending_bot_proof_results
                ):
                    print(
                        "Fail limiti keçilib, amma aktiv mənbə real oxuma testinə saxlanılır: "
                        f"{row.get('name') or row.get('base_url')} | fail={fail_count}",
                        flush=True,
                    )

                url = latest_url or base_url or rss_url
                if not url:
                    continue
                if not url.startswith("http"):
                    url = "https://" + url.lstrip("/")
                # Discovery/sync can still exclude broad domains, but an admin-approved
                # source in Supabase must be checked by the monitor bot. Otherwise official
                # sources like edu.gov.az, dim.gov.az, and economy.gov.az never reach the
                # real read/Telegram verification pipeline.
                if is_excluded_domain(url) or is_excluded_domain(base_url) or is_excluded_domain(rss_url):
                    print(f"Excluded domain allowed for approved source: {row.get('name') or url} | {url}", flush=True)
                normalized_url = normalize_link(url)
                if normalized_url in seen_urls:
                    continue
                seen_urls.add(normalized_url)
                if SOURCE_HEALTH_ENABLED and not SCHEDULER_DRY_RUN:
                    force_first_bot_check = last_result in pending_bot_proof_results or clean_text(row.get("discovery_status")).lower() in {"checking", "repair_readable", "source_added"}
                    if not force_first_bot_check:
                        schedule = source_schedule_decision(row)
                        if not schedule.get("due"):
                            print(
                                "Mənbə təhlükəsiz intervala görə keçildi: "
                                f"{row.get('name') or url} | reason={schedule.get('reason')} "
                                f"| remaining={schedule.get('remaining_minutes')}m | next={schedule.get('next_check_at') or '-'}",
                                flush=True,
                            )
                            continue
                all_sites.append({
                    "id": row.get("id"),
                    "name": row.get("name") or get_domain(url),
                    "url": url,
                    "base_url": base_url,
                    "latest_url": latest_url,
                    "rss_url": rss_url,
                    "selector": row.get("selector") or "",
                    "article_pattern": article_pattern,
                    "xpaths": xpaths,
                    "url_patterns": url_patterns,
                    "keywords": [],
                    "limit": MAX_LINKS_PER_SITE,
                    "source_type": row.get("source_type"),
                    "trust_level": row.get("trust_level"),
                    "monitor_method": method,
                    "discovery_status": row.get("discovery_status"),
                    "discovery_score": row.get("discovery_score"),
                    "last_checked_at": row.get("last_checked_at"),
                    "last_success_at": row.get("last_success_at"),
                    "last_error": row.get("last_error"),
                    "consecutive_fail_count": row.get("consecutive_fail_count"),
                    "last_result": row.get("last_result"),
                    "notes": row.get("notes"),
                })
            if len(rows) < page_size:
                break
            offset += page_size
        if VERIFY_RELEASE_REPAIR_ONLY:
            print(f"Release repair verification mode: selected {len(all_sites)} repaired active sources.", flush=True)
        print(f"Supabase active readable sources sayı: {len(all_sites)}", flush=True)
        return all_sites
    except Exception as exc:
        print(f"Supabase sources istisnası: {exc}", flush=True)
        return []


def process_site(index, total, site, patterns_data, monitor_keywords_cache=None):
    started = time.time()
    result = {
        "sent": 0,
        "site": site.get("name"),
        "url": site.get("url"),
        "candidates": 0,
        "reason": "unknown",
        "read_method": "",
        "fallback_used": False,
    }
    print(f"[{index}/{total}] Yoxlanır: {site['name']} | {site['url']}", flush=True)
    try:
        items = fetch_site(site, patterns_data)
    except Exception as exc:
        print(f"❌ [{index}/{total}] {site['name']} | sayt emalı xətası: {redact_secrets(exc)}", flush=True)
        result["reason"] = "site_error"
        update_source_health(site, result)
        return result

    result["candidates"] = len(items)
    result["read_method"] = clean_text(site.get("_read_method"))
    result["fallback_used"] = bool(site.get("_fallback_used"))
    print(f"[{index}/{total}] {site['name']} | uyğun link sayı: {len(items)} | metod={result['read_method'] or 'unknown'} | fallback={result['fallback_used']}", flush=True)

    if not items:
        result["reason"] = get_read_failure_reason(site, "no_article")
        print(f"📊 [{index}/{total}] {site['name']} | namizəd=0 | göndərildi=0 | nəticə={result['reason']} | vaxt={time.time() - started:.1f}s", flush=True)
        update_source_health(site, result)
        return result

    keyword_signature = keywords_signature(monitor_keywords_cache)
    for item in items[:site.get("limit", MAX_LINKS_PER_SITE)]:
        title = item["title"]
        link = item["link"]
        source = item["source"]
        verdict = cached_article_verdict(link, keyword_signature)
        if verdict:
            result["reason"] = verdict
            continue
        matched_keywords = item.get("matched_keywords", [])
        raw_title = item.get("raw_title") or title
        title_info = choose_best_article_title_info(item.get("clean_title") or title, link, source_domain=source)
        clean_title = title_info.get("title", "")
        title_method = title_info.get("method", "")
        title_reject_reason = title_info.get("reject_reason", "")
        print(
            f"Title secimi: source={source} | url={link} | method={title_method or '-'} "
            f"| raw={clean_text(title_info.get('raw_title') or raw_title)[:90]} "
            f"| clean={clean_title[:90]} | reject={title_reject_reason or '-'}",
            flush=True,
        )
        if not clean_title:
            result["reason"] = "bad_title"
            print(
                f"bad_title: source={source} | url={link} | candidate={clean_text(raw_title)[:100]} "
                f"| reason={title_reject_reason or 'title_extraction_failed'}",
                flush=True,
            )
            continue
        item["title"] = clean_title
        item["clean_title"] = clean_title
        item["title_method"] = title_method
        title = clean_title

        if exists(link, clean_title or title):
            result["reason"] = "duplicate_url"
            remember_article_verdict(link, "duplicate_url")
            continue

        title_time = parse_datetime_to_baku(raw_title)
        rss_time = item.get("rss_published")
        listing_time = item.get("listing_published")
        source_context = item.get("source_context")
        item_position = item.get("item_position")
        article_time, article_date_source = extract_publish_time_from_article(link, return_source=True)
        if not article_time:
            article_time = rss_time or listing_time
            article_date_source = "rss_fallback" if rss_time else ("listing_fallback" if listing_time else "missing")
        published_time, freshness_status = evaluate_publish_freshness(
            raw_title,
            article_time,
            rss_time=rss_time,
            listing_time=listing_time,
            source_context=source_context,
            item_position=item_position,
        )

        print(f"[{index}/{total}] Xəbər: {title[:80]} | title_tarix: {title_time} | rss_tarix: {rss_time} | listing_tarix: {listing_time} | article_tarix: {article_time} | article_date_source={article_date_source} | context={source_context} | sıra={item_position} | seçilən tarix: {published_time} | freshness={freshness_status} | Link: {link}", flush=True)

        if freshness_status != "fresh":
            result["reason"] = freshness_status
            if freshness_status == "old_news":
                remember_article_verdict(link, "old_news")
            continue

        clean_title = item.get("clean_title") or clean_title_for_message(title)
        if title_is_probably_corrupt(clean_title) or title_looks_like_url(clean_title):
            fallback_title = clean_title_for_message(title_from_url_slug(link))
            if fallback_title and not title_is_probably_corrupt(fallback_title):
                clean_title = fallback_title
        final_title_reason = title_rejection_reason(clean_title, article_url=link, source_domain=source)
        if final_title_reason:
            result["reason"] = "bad_title"
            print(
                f"bad_title_final: source={source} | url={link} | method={item.get('title_method') or '-'} "
                f"| title={clean_title[:100]} | reason={final_title_reason}",
                flush=True,
            )
            continue
        pre_matches = find_matching_user_monitors(clean_title, monitor_keywords_cache)
        if not pre_matches:
            result["reason"] = "no_monitor_match"
            remember_article_verdict(link, "no_monitor_match", keyword_signature)
            continue

        monitor_item_id = save_to_vizual_monitor(site, item, clean_title, published_time)
        monitor_matches = match_user_monitors(monitor_item_id, clean_title, monitor_keywords_cache) if monitor_item_id else []
        matched_keywords = clean_matched_keywords([match.get("keyword") for match in monitor_matches])

        if not monitor_matches or not matched_keywords:
            result["reason"] = "no_monitor_match"
            continue

        matched_keywords_text = ", ".join(matched_keywords)
        target_chat_ids = []
        seen_target_chats = set()
        for monitor_match in monitor_matches:
            if not monitor_match.get("notify_telegram", True):
                continue
            chat_id = clean_text(monitor_match.get("telegram_chat_id"))
            if not chat_id or chat_id in seen_target_chats:
                continue
            seen_target_chats.add(chat_id)
            target_chat_ids.append(chat_id)

        if not reserve_news(link, clean_title, site, source_id=item.get("_source_id") or site.get("id")):
            result["reason"] = site.pop("_reserve_failure_reason", "duplicate_url")
            continue

        if not target_chat_ids:
            result["reason"] = "no_telegram_recipient"
            print(f"Telegram alıcısı yoxdur, xəbər panel üçün saxlandı: {source} | {clean_title[:70]}", flush=True)
            update_source_health(site, result)
            return result

        sent_chats = set()
        sent_any = False
        for monitor_match in monitor_matches:
            if not monitor_match.get("notify_telegram", True):
                continue
            chat_id = clean_text(monitor_match.get("telegram_chat_id"))
            if not chat_id or chat_id not in seen_target_chats or chat_id in sent_chats:
                continue
            chat_matches = [match for match in monitor_matches if clean_text(match.get("telegram_chat_id")) == chat_id]
            chat_keywords = clean_matched_keywords([match.get("keyword") for match in chat_matches])
            chat_keywords_text = ", ".join(chat_keywords) or matched_keywords_text
            chat_message = f"""Yeni uyğun xəbər

Başlıq:
{clean_title}

Mənbə:
{source}

Açar sözlər:
{chat_keywords_text}

Tarix və saat:
{published_time}

Link:
{link}
"""
            if send_telegram(chat_message, chat_id=chat_id):
                sent_chats.add(chat_id)
                sent_any = True

        if sent_any:
            print(
                f"✅ [{index}/{total}] Göndərildi: {source} | method={item.get('title_method') or '-'} "
                f"| title={clean_title[:70]} | Açar sözlər: {matched_keywords_text}",
                flush=True,
            )
            result["sent"] = 1
            result["reason"] = "sent"
            time.sleep(1)
            update_source_health(site, result)
            return result

        release_reserved_news(link)
        result["reason"] = TELEGRAM_LAST_ERROR or "telegram_error"

    print(f"📊 [{index}/{total}] {site['name']} | namizəd={len(items)} | göndərildi=0 | nəticə={result['reason']} | vaxt={time.time() - started:.1f}s", flush=True)
    update_source_health(site, result)
    return result


def check_sites(poll_commands=True):
    started = time.time()
    if poll_commands:
        connect_telegram_users_from_updates()
    cleanup_old_monitor_data_if_needed()
    account_housekeeping_if_needed()
    # Long-running mode (RUN_ONCE=0) keeps module state between cycles; keep the
    # per-article title cache bounded instead of growing for the process lifetime.
    if len(ARTICLE_TITLE_INFO_CACHE) > 20000:
        ARTICLE_TITLE_INFO_CACHE.clear()
    if len(ARTICLE_VERDICT_CACHE) > ARTICLE_VERDICT_MAX:
        ARTICLE_VERDICT_CACHE.clear()
    sites = load_sites()
    if SCHEDULER_DRY_RUN:
        scheduler_decisions = [evaluate_source_schedule(site) for site in sites]
        log_scheduler_dry_run_summary(sites, scheduler_decisions)
    patterns_data = load_patterns()
    monitor_keywords_cache = load_active_monitor_keywords()
    total = len(sites)
    print(f"Yüklənən sayt sayı: {total}", flush=True)
    print(f"Monitorinq başladı | worker={MAX_WORKERS} | son {NEWS_TIME_LIMIT_HOURS} saat | {datetime.now(BAKU_TZ).strftime('%d.%m.%Y %H:%M:%S')} AZT", flush=True)

    sent_count = 0
    stats = {
        "sent": 0, "no_article": 0, "duplicate": 0, "duplicate_url": 0,
        "db_dedup_conflict": 0, "no_date": 0, "date_parse_failed": 0,
        "future_date": 0, "old_news": 0,
        "no_monitor_match": 0, "no_telegram_recipient": 0,
        "site_error": 0, "telegram_error": 0, "telegram_429": 0,
        "forbidden": 0, "chat_not_found": 0, "bot_blocked": 0,
        "bad_request": 0, "network_error": 0, "chat_migrated": 0,
        "telegram_disabled": 0,
        "http_403": 0, "http_404": 0,
        "http_429": 0, "timeout": 0, "dns_failure": 0, "ssl_failure": 0,
        "rss_empty": 0, "invalid_xml": 0, "selector_empty": 0,
        "xpath_empty": 0, "sitemap_empty": 0, "homepage_empty": 0,
        "latest_page_empty": 0, "fallback_empty": 0,
        "unsafe_url": 0, "unknown": 0,
    }
    max_workers = max(1, min(MAX_WORKERS, total or 1))

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(process_site, index, total, site, patterns_data, monitor_keywords_cache): site for index, site in enumerate(sites, start=1)}
        for future in as_completed(futures):
            try:
                result = future.result() or {}
            except Exception as exc:
                print(f"Worker xətası: {redact_secrets(exc)}", flush=True)
                stats["site_error"] += 1
                continue
            sent = int(result.get("sent", 0) or 0)
            reason = result.get("reason", "unknown")
            sent_count += sent
            stats["sent"] += sent
            if reason != "sent":
                stats[reason] = stats.get(reason, 0) + 1
            if sent_count >= MAX_SEND_PER_RUN:
                print("Bu dövr üçün göndərmə limiti tamamlandı. Qalan başladılmış yoxlamalar tamamlanacaq.", flush=True)
                break

    if BOT_TOKEN and supabase_ready():
        save_telegram_heartbeat()

    elapsed = time.time() - started
    print("=" * 60, flush=True)
    print("📈 MONİTORİNQ YEKUNU", flush=True)
    print(f"🌐 Sayt sayı: {total}", flush=True)
    print(f"⚙️ Worker sayı: {max_workers}", flush=True)
    print(f"📤 Göndərilən xəbər: {sent_count}", flush=True)
    print(f"🔎 Məqalə tapılmayan sayt: {stats.get('no_article', 0)}", flush=True)
    print(f"🧭 Oxuma diaqnostikası: http_403={stats.get('http_403', 0)} | http_404={stats.get('http_404', 0)} | http_429={stats.get('http_429', 0)} | timeout={stats.get('timeout', 0)} | dns={stats.get('dns_failure', 0)} | ssl={stats.get('ssl_failure', 0)} | rss_empty={stats.get('rss_empty', 0)} | invalid_xml={stats.get('invalid_xml', 0)} | selector_empty={stats.get('selector_empty', 0)} | xpath_empty={stats.get('xpath_empty', 0)} | sitemap_empty={stats.get('sitemap_empty', 0)} | latest_page_empty={stats.get('latest_page_empty', 0)} | homepage_empty={stats.get('homepage_empty', 0)} | fallback_empty={stats.get('fallback_empty', 0)} | unsafe_url={stats.get('unsafe_url', 0)}", flush=True)
    print(f"🔁 Təkrar keçilən: {stats.get('duplicate', 0) + stats.get('duplicate_url', 0)}", flush=True)
    print(f"🔗 URL dedup: duplicate_url={stats.get('duplicate_url', 0)} | db_conflict={stats.get('db_dedup_conflict', 0)}", flush=True)
    print(f"🕒 Tarix tapılmayan: {stats.get('no_date', 0)}", flush=True)
    print(f"⚠️ Tarix parse alınmayan: {stats.get('date_parse_failed', 0)}", flush=True)
    print(f"🔮 Gələcək tarixli keçilən: {stats.get('future_date', 0)}", flush=True)
    print(f"⏩ Köhnə xəbər: {stats.get('old_news', 0)}", flush=True)
    print(f"🔎 Monitor açar sözünə uyğun olmayan: {stats.get('no_monitor_match', 0)}", flush=True)
    print(f"📭 Telegram alıcısı olmayan: {stats.get('no_telegram_recipient', 0)}", flush=True)
    print(f"❌ Sayt/worker xətası: {stats.get('site_error', 0)}", flush=True)
    print(f"📨 Telegram xətası: {stats.get('telegram_error', 0)}", flush=True)
    print(f"📨 Telegram diaqnostikası: 429={stats.get('telegram_429', 0)} | forbidden={stats.get('forbidden', 0)} | blocked={stats.get('bot_blocked', 0)} | chat_not_found={stats.get('chat_not_found', 0)} | bad_request={stats.get('bad_request', 0)} | network={stats.get('network_error', 0)} | migrated={stats.get('chat_migrated', 0)} | disabled={stats.get('telegram_disabled', 0)}", flush=True)
    print(f"⏱️ Ümumi vaxt: {elapsed:.1f} saniyə", flush=True)
    print("=" * 60, flush=True)


# ---------------------------------------------------------------------------
# Source lifecycle: trial (read-only) sampling of newly discovered sources.
# Logic lives in source_lifecycle.py; discovery itself runs as its own Railway cron.
# ---------------------------------------------------------------------------
LIFECYCLE_STATE = {"last_trial": 0.0}


def load_trial_rows():
    try:
        response = requests.get(
            f"{SUPABASE_URL}/rest/v1/sources",
            headers=supabase_headers(),
            params={
                "select": "id,name,base_url,latest_url,rss_url,monitor_method,selector,article_pattern,source_type,trust_level,notes",
                "status": "eq.inactive",
                "discovery_status": "eq.accepted",
                "notes": "ilike.*[trial passes=*",
                "limit": str(lifecycle.TRIAL_MAX_PER_RUN),
            },
            timeout=REQUEST_TIMEOUT,
        )
        return response.json() if response.status_code == 200 else []
    except Exception as exc:
        print(f"Trial mənbələri oxunmadı: {exc}", flush=True)
        return []


def trial_row_to_site(row):
    base_url = clean_text(row.get("base_url", ""))
    latest_url = clean_text(row.get("latest_url", ""))
    rss_url = clean_text(row.get("rss_url", ""))
    method = clean_text(row.get("monitor_method", "")).lower()
    article_pattern = row.get("article_pattern") or ""
    url = latest_url or base_url or rss_url
    if not url:
        return None
    if not url.startswith("http"):
        url = "https://" + url.lstrip("/")
    return {
        "id": row.get("id"), "name": row.get("name") or get_domain(url), "url": url,
        "base_url": base_url, "latest_url": latest_url, "rss_url": rss_url,
        "selector": row.get("selector") or "", "article_pattern": article_pattern,
        "xpaths": parse_article_patterns(article_pattern),
        "url_patterns": parse_url_patterns(article_pattern),
        "keywords": [], "limit": MAX_LINKS_PER_SITE,
        "source_type": row.get("source_type"), "trust_level": row.get("trust_level"),
        "monitor_method": "xpath_pattern" if method == "xpath" else method,
    }


def sample_trial_site(site, patterns_data):
    """Read a trial source like the monitor does, but never save or send anything."""
    items = fetch_site(site, patterns_data)
    samples = []
    for item in items[:lifecycle.TRIAL_SAMPLE_SIZE]:
        link = item["link"]
        raw_title = item.get("raw_title") or item["title"]
        info = choose_best_article_title_info(item.get("clean_title") or item["title"], link, source_domain=item["source"])
        article_time, _ = extract_publish_time_from_article(link, return_source=True)
        rss_time = item.get("rss_published")
        listing_time = item.get("listing_published")
        if not article_time:
            article_time = rss_time or listing_time
        _, freshness = evaluate_publish_freshness(
            raw_title, article_time, rss_time=rss_time, listing_time=listing_time,
            source_context=item.get("source_context"), item_position=item.get("item_position"),
        )
        date_state = "future" if freshness == "future_date" else ("ok" if freshness in {"fresh", "old_news"} else "missing")
        samples.append({"title_ok": bool(info.get("title")), "date_state": date_state})
    return samples


def patch_source_row(source_id, payload):
    try:
        response = requests.patch(
            f"{SUPABASE_URL}/rest/v1/sources",
            headers=supabase_headers({"Prefer": "return=minimal"}),
            params={"id": f"eq.{source_id}"},
            json=payload,
            timeout=REQUEST_TIMEOUT,
        )
        return response.status_code in (200, 204)
    except Exception as exc:
        print(f"Source yenilənmədi ({source_id}): {exc}", flush=True)
        return False


def run_trial_pass(patterns_data):
    rows = load_trial_rows()
    if not rows:
        return
    print(f"🧪 Trial yoxlaması: {len(rows)} yeni mənbə (göndərmə yoxdur)", flush=True)

    def handle(row):
        state = lifecycle.parse_trial(row.get("notes"))
        site = trial_row_to_site(row)
        if not state or not site:
            return
        try:
            passed, reason = lifecycle.judge_sample(sample_trial_site(site, patterns_data))
        except Exception as exc:
            passed, reason = False, f"error:{str(exc)[:60]}"
        action, new_state = lifecycle.next_state(state, passed)
        base_notes = lifecycle.strip_trial_tag(row.get("notes"))
        stamp = datetime.now(BAKU_TZ).strftime("%Y-%m-%d %H:%M")
        if action == "promote" and lifecycle.TRIAL_AUTO_PROMOTE:
            payload = {"status": "active", "discovery_status": "accepted", "last_result": "source_added",
                       "notes": f"{base_notes} [auto_promoted {stamp}]".strip()}
        elif action == "promote":
            payload = {"discovery_status": "needs_review",
                       "notes": f"{base_notes} [trial_passed {stamp}]".strip()}
        elif action == "review":
            payload = {"discovery_status": "needs_review",
                       "notes": f"{base_notes} [trial_failed {reason} {stamp}]".strip()}
        else:
            payload = {"notes": lifecycle.build_trial_notes(base_notes, new_state["passes"], new_state["fails"], new_state["since"])}
        patch_source_row(row["id"], payload)
        print(f"🧪 {site['name']} | {'keçdi' if passed else 'keçmədi'} ({reason}) | nəticə={action} | passes={new_state['passes']} fails={new_state['fails']}", flush=True)

    with ThreadPoolExecutor(max_workers=3) as executor:
        list(executor.map(handle, rows))


def run_lifecycle_tick(patterns_data):
    """Called between monitor cycles. Never raises."""
    if VERIFY_RELEASE_REPAIR_ONLY or not supabase_ready():
        return
    now = time.time()
    try:
        if lifecycle.TRIAL_ENABLED and now - LIFECYCLE_STATE["last_trial"] >= lifecycle.TRIAL_INTERVAL_MINUTES * 60:
            LIFECYCLE_STATE["last_trial"] = now
            run_trial_pass(patterns_data)
    except Exception as exc:
        print(f"Lifecycle xətası: {exc}", flush=True)


def main():
    print("🚀 Sayt monitorinq botu işə düşdü.", flush=True)
    if supabase_ready():
        print("✅ Supabase bağlantı məlumatları yükləndi", flush=True)

    if VERIFY_RELEASE_REPAIR_ONLY and not DISABLE_TELEGRAM_SEND:
        raise SystemExit("VERIFY_RELEASE_REPAIR_ONLY requires DISABLE_TELEGRAM_SEND=true. Aborting to prevent Telegram sends.")

    run_once = os.getenv("RUN_ONCE", "1").strip().lower() in {"1", "true", "yes"}
    notify_start = os.getenv("NOTIFY_START", "0").strip().lower() in {"1", "true", "yes"}

    if notify_start:
        send_telegram("✅ Bot işə düşdü və saytları yoxlamağa başladı.")

    if run_once:
        print("🔎 GitHub Actions rejimi: bir dəfə yoxlanılır...", flush=True)
        check_sites()
        print("✅ GitHub Actions monitor yoxlaması tamamlandı.", flush=True)
        return

    if BOT_TOKEN:
        threading.Thread(target=telegram_command_loop, name="telegram-commands", daemon=True).start()
    while True:
        print("🔎 Yeni xəbərlər yoxlanılır...", flush=True)
        check_sites(poll_commands=False)
        run_lifecycle_tick(load_patterns())
        time.sleep(CHECK_INTERVAL_SECONDS)


if __name__ == "__main__":
    main()
