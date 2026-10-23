"""Facebook (Apify), Instagram (SocialFetch) and YouTube (YouTube Data API v3)
keyword collector, plus watched Instagram pages and public Telegram channels.

Every tick: read social_settings, collect the active monitor keywords, and
search each unique folded keyword once when it is due. A keyword is due when
its last search is older than the shortest interval among the customers who
track it (profile override, else plan limit, else the global default).

Matching posts are stored as monitored_items under the platform's sources row,
then matched and alerted through the rss worker's own functions, so panels,
matches, alerts and retention behave exactly like news items.

Watched accounts (social_watched_accounts, admin list) are read whole and
matched here, once per account for every customer: Instagram pages find posts
without a hashtag (only keywords picked for FB/IG match, like hashtag results);
Telegram channels come from the free t.me/s preview and count as a news source,
so every active keyword matches.

A plan's limits.social_platforms lists the networks its customers' keywords are
searched on; unset means Facebook and Instagram. YouTube is free but has a daily
quota (10 000 units, one search = 100), counted per Pacific day.

Posts older than SOCIAL_MAX_AGE_HOURS are never stored, on any platform.
"""

import html
import os
import re
import sys
import time
import urllib.parse
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "rss"))

import requests  # noqa: E402

import site_monitor as sm  # noqa: E402

APIFY_TOKEN = os.getenv("APIFY_TOKEN", "").strip()
SOCIALFETCH_API_KEY = os.getenv("SOCIALFETCH_API_KEY", "").strip()
APIFY_BASE = "https://api.apify.com/v2"
APIFY_FB_ACTOR = "topapi~facebook-search-posts-scraper"
SOCIALFETCH_BASE = "https://api.socialfetch.dev"
YOUTUBE_API_KEY = os.getenv("YOUTUBE_API_KEY", "").strip()
YOUTUBE_SEARCH_URL = "https://www.googleapis.com/youtube/v3/search"
# search.list costs 100 quota units; the quota resets at midnight Pacific time.
YOUTUBE_UNITS_PER_SEARCH = 100
PACIFIC_TZ = ZoneInfo("America/Los_Angeles")

SOCIAL_TICK_SECONDS = int(os.getenv("SOCIAL_TICK_SECONDS", "300"))
# Posts per keyword per Facebook run: admin setting fb_max_posts_per_query, unless this env is set.
SOCIAL_MAX_POSTS_PER_QUERY_ENV = os.getenv("SOCIAL_MAX_POSTS_PER_QUERY", "").strip()
# Posts older than this are stored for nobody: the first run would otherwise alert old posts.
SOCIAL_MAX_AGE_HOURS = int(os.getenv("SOCIAL_MAX_AGE_HOURS", "48"))
APIFY_RUN_TIMEOUT_SECONDS = int(os.getenv("APIFY_RUN_TIMEOUT_SECONDS", "600"))
# Budget estimates, used when the provider does not report the actual cost.
# The Facebook actor bills per delivered post ($2.40 / 1000), no start fee.
APIFY_FB_USD_PER_POST = float(os.getenv("APIFY_FB_USD_PER_POST", "0.0024"))
# SocialFetch Starter: $29 for 18 000 credits.
SOCIALFETCH_USD_PER_CREDIT_ESTIMATE = float(os.getenv("SOCIALFETCH_USD_PER_CREDIT_ESTIMATE", str(29 / 18000)))
# Own monitor memory, so other uses of the actor on this Apify account don't share it.
APIFY_FB_MONITOR_STORE = "vizual-fb-monitor"
# Cost-control defaults, used until migration 20261023000004 adds the settings.
FB_DEFAULTS = {
    "fb_must_contain_query": True,
    "fb_min_interval_minutes": 360,
    "fb_max_posts_per_query": 10,
    "fb_daily_posts_per_keyword": 30,
}
# Used until migration 20261023000005 adds the YouTube settings.
YOUTUBE_DEFAULTS = {"youtube_daily_quota": 9000, "youtube_min_interval_minutes": 360}
# Networks a plan searches when its limits.social_platforms is unset.
DEFAULT_SOCIAL_PLATFORMS = ("facebook", "instagram")

PLATFORM_BASE_URLS = {
    "facebook": "https://www.facebook.com",
    "instagram": "https://www.instagram.com",
    "telegram": "https://t.me",
    "youtube": "https://www.youtube.com",
}
PLATFORM_LABELS = {"facebook": "Facebook", "instagram": "Instagram", "telegram": "Telegram", "youtube": "YouTube"}
# Minutes between reads of a watched account when the admin set none.
ACCOUNT_DEFAULT_INTERVALS = {"instagram": 180, "telegram": 10}
HTTP_TIMEOUT = 90


def utcnow():
    return datetime.now(timezone.utc)


def rest_get(table, params):
    response = requests.get(
        f"{sm.SUPABASE_URL}/rest/v1/{table}",
        headers=sm.supabase_headers(),
        params=params,
        timeout=sm.REQUEST_TIMEOUT,
    )
    if response.status_code != 200:
        raise RuntimeError(f"{table}:{response.status_code}:{response.text[:160]}")
    return response.json() or []


def parse_time(value):
    if value in (None, ""):
        return None
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value / 1000 if value > 1e11 else value, timezone.utc)
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


# Settings, keywords, intervals ------------------------------------------------------


def social_keyword_ids():
    """Keyword ids the customers chose for FB/IG, capped at each plan's limit
    (social_keyword_ids_for_worker, migration 20261022000006). None if missing."""
    response = requests.post(
        f"{sm.SUPABASE_URL}/rest/v1/rpc/social_keyword_ids_for_worker",
        headers=sm.supabase_headers(),
        json={},
        timeout=sm.REQUEST_TIMEOUT,
    )
    if response.status_code != 200:
        print(f"Sosial açar sözlər oxunmadı ({response.status_code}); migration 20261022000006 lazımdır.", flush=True)
        return None
    return {row.get("keyword_id") for row in response.json() or []}


def load_settings():
    rows = rest_get("social_settings", {"select": "*", "id": "eq.1", "limit": "1"})
    return rows[0] if rows else {}


def fb_setting(settings, key):
    value = settings.get(key)
    return FB_DEFAULTS[key] if value is None else value


def fb_max_posts_per_query(settings):
    if SOCIAL_MAX_POSTS_PER_QUERY_ENV:
        return max(1, int(SOCIAL_MAX_POSTS_PER_QUERY_ENV))
    return max(1, min(50, int(fb_setting(settings, "fb_max_posts_per_query"))))


def youtube_setting(settings, key):
    value = settings.get(key)
    return YOUTUBE_DEFAULTS[key] if value is None else value


def baku_day(now):
    return now.astimezone(sm.BAKU_TZ).strftime("%Y-%m-%d")


def plan_platforms(plan):
    value = (plan.get("limits") or {}).get("social_platforms") if plan else None
    return set(value) if isinstance(value, list) else set(DEFAULT_SOCIAL_PLATFORMS)


def keywords_for_platform(platform, keyword_rows, profiles, plans):
    """Keyword rows whose owner's plan searches this network (limits.social_platforms).
    Owners without a profile or plan get the default networks."""
    by_plan = {plan.get("id"): plan for plan in plans}
    user_plans = {profile.get("user_id"): by_plan.get(profile.get("plan_id")) for profile in profiles}
    return [
        row for row in keyword_rows
        if platform in plan_platforms(user_plans.get((row.get("user_monitors") or {}).get("user_id")))
    ]


def keyword_intervals(keyword_rows, profiles, plans, default_interval):
    """{keyword_fold: {"keyword": original, "interval": minutes}} for active monitors."""
    plan_intervals = {}
    for plan in plans:
        value = (plan.get("limits") or {}).get("social_interval_minutes")
        if isinstance(value, int) and value > 0:
            plan_intervals[plan.get("id")] = value
    user_intervals = {}
    custom_users = set()
    for profile in profiles:
        if profile.get("social_interval_minutes"):
            custom_users.add(profile.get("user_id"))
        interval = profile.get("social_interval_minutes") or plan_intervals.get(profile.get("plan_id")) or default_interval
        user_intervals[profile.get("user_id")] = interval

    targets = {}
    for row in keyword_rows:
        monitor = row.get("user_monitors") or {}
        if not sm.keyword_is_active(row):
            continue
        original = sm.clean_text(row.get("keyword"))
        folded = sm.keyword_fold(original).strip()
        if not folded:
            continue
        user_id = monitor.get("user_id")
        interval = user_intervals.get(user_id, default_interval)
        # custom: an admin's per-customer offer ("Fərdi təklif"), which the
        # Facebook floor does not override.
        custom = user_id in custom_users
        target = targets.setdefault(folded, {"keyword": original, "interval": interval, "custom": custom})
        if interval < target["interval"] or (interval == target["interval"] and custom):
            target["interval"] = interval
            target["custom"] = custom
    return targets


def load_keyword_state(platform):
    """{keyword_fold: state row}; '*' so it works before last_stats exists."""
    return {
        row.get("keyword_fold"): row
        for row in rest_get("social_keyword_state", {"select": "*", "platform": f"eq.{platform}"})
    }


def due_keywords(platform, targets, now, state=None, settings=None):
    state = load_keyword_state(platform) if state is None else state
    settings = settings or {}
    # Facebook bills per delivered post, so plan intervals never go below the
    # admin floor; only a customer's own paid override ("Fərdi təklif") may.
    # YouTube's daily quota is a hard limit, so its floor binds everyone.
    floor = 0
    if platform == "facebook":
        floor = int(fb_setting(settings, "fb_min_interval_minutes"))
    elif platform == "youtube":
        floor = int(youtube_setting(settings, "youtube_min_interval_minutes"))
    daily_cap = fb_setting(settings, "fb_daily_posts_per_keyword") if platform == "facebook" else None
    today = baku_day(now)
    due = []
    for folded, target in sorted(targets.items()):
        row = state.get(folded) or {}
        last = parse_time(row.get("last_checked_at"))
        custom = target.get("custom") and platform != "youtube"
        interval = target["interval"] if custom else max(target["interval"], floor)
        if last is not None and now - last < timedelta(minutes=interval):
            continue
        stats = row.get("last_stats") or {}
        if daily_cap and stats.get("day") == today and int(stats.get("day_posts") or 0) >= int(daily_cap):
            continue
        due.append(folded)
    return due


def carry_totals(stats, previous, now, usd):
    """Adds this run's cost and delivered posts to the day and month totals of the
    previous run's stats (last_stats)."""
    previous = previous or {}
    month = f"{now:%Y-%m}"
    today = baku_day(now)
    stats["usd"] = round(usd, 4)
    stats["month"] = month
    stats["month_usd"] = round((float(previous.get("month_usd") or 0) if previous.get("month") == month else 0) + usd, 4)
    stats["day"] = today
    stats["day_posts"] = (int(previous.get("day_posts") or 0) if previous.get("day") == today else 0) + stats["raw"]
    return stats


# Until migration 20261023000002 adds last_stats, state is written without it.
STATS_COLUMN = {"available": True}


def record_keyword_state(platform, folded_keywords, stats, error=None):
    now_iso = utcnow().isoformat()
    rows = []
    for folded in folded_keywords:
        keyword_stats = stats.get(folded) or new_stats()
        row = {
            "platform": platform,
            "keyword_fold": folded,
            "last_checked_at": now_iso,
            "last_result_count": keyword_stats["raw"],
            "last_error": error,
        }
        if STATS_COLUMN["available"]:
            row["last_stats"] = {**keyword_stats, "error": error}
        rows.append(row)
    response = requests.post(
        f"{sm.SUPABASE_URL}/rest/v1/social_keyword_state",
        headers=sm.supabase_headers({"Prefer": "resolution=merge-duplicates,return=minimal"}),
        json=rows,
        timeout=sm.REQUEST_TIMEOUT,
    )
    if response.status_code in (200, 201, 204):
        return
    if STATS_COLUMN["available"] and "last_stats" in (response.text or ""):
        STATS_COLUMN["available"] = False
        print("social_keyword_state.last_stats yoxdur (migration 20261023000002); statistika yazılmır.", flush=True)
        record_keyword_state(platform, folded_keywords, stats, error)
        return
    print(f"social_keyword_state yazılmadı: {response.status_code} | {response.text[:160]}", flush=True)


STAT_KEYS = ("raw", "no_url", "no_date", "too_old", "no_match", "duplicate", "stored", "matched_users", "alerted")


def new_stats():
    return {**{key: 0 for key in STAT_KEYS}, "samples": []}


def stats_line(stats):
    total = new_stats()
    for keyword_stats in stats.values():
        for key in STAT_KEYS:
            total[key] += keyword_stats[key]
    return (
        f"gələn={total['raw']} linksiz={total['no_url']} tarixsiz={total['no_date']} köhnə={total['too_old']} "
        f"uyğunsuz={total['no_match']} təkrar={total['duplicate']} yeni={total['stored']} "
        f"müştəri={total['matched_users']} bildiriş={total['alerted']}"
    )


# Monthly budget ---------------------------------------------------------------------


def usage_key(now):
    return f"social_usage_{now:%Y-%m}"


def load_usage(now):
    ok, value = sm.load_runtime_state(usage_key(now))
    return value if ok and isinstance(value, dict) else {"usd": 0.0, "calls": 0}


def add_usage(now, usd, calls, platform=None):
    usage = load_usage(now)
    usage["usd"] = round(float(usage.get("usd") or 0) + usd, 4)
    usage["calls"] = int(usage.get("calls") or 0) + calls
    if platform:
        usage[f"{platform}_usd"] = round(float(usage.get(f"{platform}_usd") or 0) + usd, 4)
        usage[f"{platform}_calls"] = int(usage.get(f"{platform}_calls") or 0) + calls
    sm.save_runtime_state(usage_key(now), usage)
    return usage


def budget_exhausted(settings, now, platform=None):
    """The total monthly budget, and the platform's own one, both stop searching."""
    usage = load_usage(now)
    budget = settings.get("monthly_budget_usd")
    if budget not in (None, "") and float(usage.get("usd") or 0) >= float(budget):
        return True
    if platform:
        platform_budget = settings.get(f"{platform}_monthly_budget_usd")
        if platform_budget not in (None, "") and float(usage.get(f"{platform}_usd") or 0) >= float(platform_budget):
            return True
    return False


# YouTube daily quota ----------------------------------------------------------------


def pacific_day(now):
    return now.astimezone(PACIFIC_TZ).strftime("%Y-%m-%d")


def youtube_quota_key(now):
    return f"youtube_quota_{pacific_day(now)}"


def youtube_units_used(now):
    ok, value = sm.load_runtime_state(youtube_quota_key(now))
    return int(value.get("units") or 0) if ok and isinstance(value, dict) else 0


def add_youtube_units(now, units, exhausted_at=None):
    used = youtube_units_used(now) + units if exhausted_at is None else exhausted_at
    sm.save_runtime_state(youtube_quota_key(now), {"units": used})
    return used


def youtube_quota_left(settings, now):
    return int(youtube_setting(settings, "youtube_daily_quota")) - youtube_units_used(now)


# Providers ----------------------------------------------------------------------------


def apify_facebook_input(queries, settings):
    per_query = fb_max_posts_per_query(settings)
    return {
        "searchQueries": list(queries),
        "sortBy": "recent",
        # Only posts earlier runs did not deliver are returned (and billed).
        "monitorMode": True,
        "monitorStoreName": APIFY_FB_MONITOR_STORE,
        "mustContainQuery": bool(fb_setting(settings, "fb_must_contain_query")),
        "startDate": f"{max(1, SOCIAL_MAX_AGE_HOURS // 24)} days",
        "maxPostsPerQuery": per_query,
        "maxItems": per_query * len(queries),
    }


def apify_facebook_search(targets, folded_keywords, settings=None):
    """One actor run for all due keywords. Returns (posts, usd, error)."""
    headers = {"Authorization": f"Bearer {APIFY_TOKEN}"}
    by_query = {targets[folded]["keyword"]: folded for folded in folded_keywords}
    run_input = apify_facebook_input(by_query, settings or {})
    response = requests.post(
        f"{APIFY_BASE}/acts/{APIFY_FB_ACTOR}/runs",
        params={"waitForFinish": "60"},
        headers=headers,
        json=run_input,
        timeout=HTTP_TIMEOUT,
    )
    if response.status_code not in (200, 201):
        return [], 0.0, f"apify_start:{response.status_code}"
    run = (response.json() or {}).get("data") or {}
    deadline = time.time() + APIFY_RUN_TIMEOUT_SECONDS
    while run.get("status") in ("READY", "RUNNING") and time.time() < deadline:
        response = requests.get(
            f"{APIFY_BASE}/actor-runs/{run.get('id')}",
            params={"waitForFinish": "60"},
            headers=headers,
            timeout=HTTP_TIMEOUT,
        )
        if response.status_code != 200:
            return [], 0.0, f"apify_poll:{response.status_code}"
        run = (response.json() or {}).get("data") or {}
    reported = float(run.get("usageTotalUsd") or 0)
    if run.get("status") != "SUCCEEDED":
        return [], reported, f"apify_run:{run.get('status') or 'timeout'}"
    response = requests.get(
        f"{APIFY_BASE}/datasets/{run.get('defaultDatasetId')}/items",
        params={"clean": "true", "format": "json"},
        headers=headers,
        timeout=HTTP_TIMEOUT,
    )
    if response.status_code != 200:
        return [], reported, f"apify_dataset:{response.status_code}"
    items = response.json() or []
    # Pay-per-result: the bill is the delivered posts; usageTotalUsd may leave it out.
    usd = max(reported, len(items) * APIFY_FB_USD_PER_POST)
    posts = []
    for item in items:
        author = item.get("author")
        if isinstance(author, dict):
            author = author.get("name") or author.get("url")
        folded = by_query.get(item.get("search_query")) or sm.keyword_fold(item.get("search_query") or "").strip()
        posts.append({
            "keyword_fold": folded,
            "external_id": str(item.get("post_id") or item.get("postId") or item.get("id") or item.get("url") or ""),
            "url": item.get("url") or item.get("postUrl") or item.get("link"),
            "text": item.get("message") or item.get("text") or item.get("postText") or "",
            "author": author or item.get("author_title"),
            "published_at": parse_time(item.get("published_at") or item.get("timestamp") or item.get("time") or item.get("date")),
        })
    return posts, usd, None


def instagram_hashtag(keyword):
    # Azerbaijani lower-case (İ->i, I->ı) keeps ı/ə/ş, unlike keyword_fold.
    return "".join(keyword.replace("İ", "i").replace("I", "ı").lower().split())


def socialfetch_instagram_hashtag(targets, folded):
    """Recent posts for one keyword's hashtag. Returns (posts, usd, error)."""
    hashtag = instagram_hashtag(targets[folded]["keyword"])
    response = requests.get(
        f"{SOCIALFETCH_BASE}/v2/instagram/hashtags/{urllib.parse.quote(hashtag)}/media",
        params={"tab": "recent"},
        headers={"x-api-key": SOCIALFETCH_API_KEY, "Accept": "application/json"},
        timeout=HTTP_TIMEOUT,
    )
    if response.status_code != 200:
        return [], 0.0, f"socialfetch:{response.status_code}"
    data = response.json() or {}
    credits = (data.get("meta") or {}).get("creditsCharged") or 0
    usd = credits * SOCIALFETCH_USD_PER_CREDIT_ESTIMATE
    body = data.get("data") or {}
    if body.get("lookupStatus") not in (None, "found"):
        return [], usd, None
    # The "recent" tab lists new posts only, so an undated one is new now.
    return socialfetch_media_posts(body, folded, undated_is_new=True), usd, None


def socialfetch_media_posts(body, folded=None, undated_is_new=False):
    posts = []
    for item in body.get("media") or []:
        owner = item.get("owner") or {}
        published = parse_time(item.get("createdAt") or item.get("takenAt") or item.get("timestamp"))
        posts.append({
            "keyword_fold": folded,
            "external_id": str(item.get("id") or item.get("shortcode") or item.get("url") or ""),
            "url": item.get("url"),
            "text": item.get("caption") or "",
            "author": owner.get("handle"),
            "published_at": published or (utcnow() if undated_is_new else None),
        })
    return posts


def socialfetch_instagram_profile(handle):
    """Latest posts of one Instagram page (GET /v2/instagram/profiles/{profile}/media,
    tab=posts, 1 credit per page). Returns (posts, usd, error)."""
    response = requests.get(
        f"{SOCIALFETCH_BASE}/v2/instagram/profiles/{urllib.parse.quote(handle)}/media",
        params={"tab": "posts"},
        headers={"x-api-key": SOCIALFETCH_API_KEY, "Accept": "application/json"},
        timeout=HTTP_TIMEOUT,
    )
    if response.status_code != 200:
        return [], 0.0, f"socialfetch:{response.status_code}"
    data = response.json() or {}
    credits = (data.get("meta") or {}).get("creditsCharged") or 0
    usd = credits * SOCIALFETCH_USD_PER_CREDIT_ESTIMATE
    body = data.get("data") or {}
    status = body.get("lookupStatus")
    if status not in (None, "found"):
        # private / not_found: the page cannot be read; the admin should fix the handle.
        return [], usd, f"profile:{status}"
    # Pinned posts can be old; undated ones are not guessed (counted as no_date).
    return socialfetch_media_posts(body), usd, None


def youtube_search(targets, folded, now):
    """Newest videos for one keyword (search.list, 100 units). Returns (posts, usd, error).
    The key goes in a header so it never appears in a logged URL."""
    response = requests.get(
        YOUTUBE_SEARCH_URL,
        params={
            "part": "snippet",
            "q": targets[folded]["keyword"],
            "type": "video",
            "order": "date",
            "publishedAfter": (now - timedelta(hours=SOCIAL_MAX_AGE_HOURS)).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "regionCode": "AZ",
            "relevanceLanguage": "az",
            "maxResults": 10,
        },
        headers={"X-goog-api-key": YOUTUBE_API_KEY, "Accept": "application/json"},
        timeout=HTTP_TIMEOUT,
    )
    if response.status_code != 200:
        try:
            errors = ((response.json() or {}).get("error") or {}).get("errors") or [{}]
            reason = errors[0].get("reason") or "error"
        except (ValueError, AttributeError):
            reason = "error"
        return [], 0.0, f"youtube:{reason}:{response.status_code}"
    return youtube_posts(response.json() or {}, folded), 0.0, None


def youtube_posts(data, folded):
    posts = []
    for item in data.get("items") or []:
        video_id = (item.get("id") or {}).get("videoId")
        if not video_id:
            continue
        snippet = item.get("snippet") or {}
        # Titles and descriptions come HTML-escaped (&quot;, &#39;).
        title = html.unescape(snippet.get("title") or "")
        description = html.unescape(snippet.get("description") or "")
        posts.append({
            "keyword_fold": folded,
            "external_id": video_id,
            "url": f"https://www.youtube.com/watch?v={video_id}",
            "text": f"{title} {description}".strip(),
            "author": html.unescape(snippet.get("channelTitle") or ""),
            "published_at": parse_time(snippet.get("publishedAt")),
        })
    return posts


def parse_telegram_preview(page_html, channel):
    """Posts of a public channel's t.me/s/<channel> page: [(post dict)], title."""
    soup = sm.BeautifulSoup(page_html or "", "html.parser")
    title_node = soup.select_one(".tgme_channel_info_header_title") or soup.select_one(".tgme_header_title")
    title = title_node.get_text(" ", strip=True) if title_node else channel
    posts = []
    for message in soup.select("div.tgme_widget_message[data-post]"):
        post_ref = message.get("data-post") or ""
        if "/" not in post_ref:
            continue
        text_node = message.select_one(".tgme_widget_message_text")
        time_node = message.select_one(".tgme_widget_message_date time[datetime]") or message.select_one("time[datetime]")
        posts.append({
            "keyword_fold": None,
            "external_id": post_ref,
            "url": f"https://t.me/{post_ref}",
            "text": text_node.get_text(" ", strip=True) if text_node else "",
            "author": title,
            "published_at": parse_time(time_node.get("datetime")) if time_node else None,
        })
    return posts, title


def fetch_telegram_channel(handle):
    """Public preview, no login or key. Returns (posts, usd, error)."""
    url = f"https://t.me/s/{urllib.parse.quote(handle)}"
    try:
        response = sm.safe_request(url, headers=sm.REQUEST_HEADERS, timeout=sm.REQUEST_TIMEOUT, allow_redirects=True)
    except Exception as exc:
        return [], 0.0, f"telegram:{type(exc).__name__}"
    if response.status_code != 200:
        return [], 0.0, f"telegram:{response.status_code}"
    posts, _title = parse_telegram_preview(sm.decode_response_text(response), handle)
    if not posts:
        # t.me redirects to the plain channel page when the preview is off or the name is wrong.
        return [], 0.0, "telegram:no_preview"
    return posts, 0.0, None


# Storing, matching, alerting ------------------------------------------------------------


def platform_source_ids():
    rows = rest_get("sources", {"select": "id,base_url", "base_url": f"in.({','.join(PLATFORM_BASE_URLS.values())})"})
    by_url = {row.get("base_url"): row.get("id") for row in rows}
    return {platform: by_url.get(url) for platform, url in PLATFORM_BASE_URLS.items()}


def post_title(post):
    text = " ".join(sm.clean_text(post.get("text")).split())
    author = sm.clean_text(post.get("author"))
    title = f"{author}: {text}" if author else text
    return title[:300]


def store_post(platform, source_id, post):
    """Inserts the post; returns its item id, or None when it is already stored."""
    response = requests.post(
        f"{sm.SUPABASE_URL}/rest/v1/monitored_items",
        headers=sm.supabase_headers({"Prefer": "resolution=ignore-duplicates,return=representation"}),
        json={
            "source_id": source_id,
            "title": post_title(post),
            "url": post["url"],
            "published_at": post["published_at"].isoformat() if post.get("published_at") else None,
            "detected_at": utcnow().isoformat(),
            "item_hash": f"{platform}:{post.get('external_id') or post['url']}",
            "status": "new",
        },
        timeout=sm.REQUEST_TIMEOUT,
    )
    if response.status_code in (200, 201):
        rows = response.json() or []
        return rows[0].get("id") if rows else None
    print(f"Sosial post yazılmadı: {response.status_code} | {response.text[:160]}", flush=True)
    return None


def alert_text(platform, post, keywords):
    published = post["published_at"].astimezone(sm.BAKU_TZ).strftime("%d.%m.%Y %H:%M") if post.get("published_at") else "-"
    return (
        f"Yeni uyğun {PLATFORM_LABELS[platform]} paylaşımı\n\n"
        f"Mətn:\n{post_title(post)}\n\n"
        f"Açar sözlər:\n{keywords}\n\n"
        f"Tarix və saat:\n{published}\n\n"
        f"Link:\n{post['url']}\n"
    )


def is_short_keyword(folded):
    return folded in sm.STRICT_WORDS_FOLDED or len(folded) <= 4


# Social posts often drop Azerbaijani letters: "#azerisiq" for "Azərişıq".
LATIN_FOLD = str.maketrans("əşçğöü", "escgou")


def social_keyword_matches(keyword, text):
    """Looser than news titles: posts write "Kapital Bankın" and "#kapitalbank".

    Short and strict words stay whole-word ("#bdu" matches, "ABDU" does not).
    A phrase may be written with or without spaces, with a suffix on the end,
    and in plain Latin letters."""
    folded = sm.keyword_fold(keyword).strip()
    if not folded:
        return False
    folded_text = sm.keyword_fold(text)
    if sm.keyword_matches_title(folded, folded_text):
        return True
    if is_short_keyword(folded):
        return False
    latin, latin_text = folded.translate(LATIN_FOLD), folded_text.translate(LATIN_FOLD)
    pattern = r"(?<!\w)" + r"[\s\-_.]*".join(re.escape(word) for word in latin.split())
    return bool(re.search(pattern, latin_text))


def post_matcher(platform, post):
    """A matcher for this post's text. Instagram returned the post for the exact
    hashtag of its keywords, so those keywords match even when the caption
    does not repeat them (unless they are short and noisy)."""
    provider_folds = set(post.get("keyword_folds") or [post.get("keyword_fold")])

    def matches(keyword, text):
        if social_keyword_matches(keyword, text):
            return True
        folded = sm.keyword_fold(keyword).strip()
        return platform == "instagram" and folded in provider_folds and not is_short_keyword(folded)

    return matches


def handle_post(platform, source_id, post, keyword_cache, now):
    """Returns (outcome, matched_users, chats_alerted)."""
    if not post.get("url"):
        return "no_url", 0, 0
    if not post.get("published_at"):
        return "no_date", 0, 0
    if now - post["published_at"] > timedelta(hours=SOCIAL_MAX_AGE_HOURS):
        return "too_old", 0, 0
    text = post_title(post)
    matcher = post_matcher(platform, post)
    if not sm.find_matching_user_monitors(text, keyword_cache, matcher=matcher):
        return "no_match", 0, 0
    item_id = store_post(platform, source_id, post)
    if not item_id:
        return "duplicate", 0, 0
    matches = sm.match_user_monitors(item_id, text, keyword_cache, matcher=matcher)
    sent = 0
    chats = {}
    for match in matches:
        chat_id = sm.clean_text(match.get("telegram_chat_id"))
        if match.get("notify_telegram", True) and chat_id:
            chats.setdefault(chat_id, []).append(match)
    for chat_id, chat_matches in chats.items():
        keywords = ", ".join(sm.clean_matched_keywords([m.get("keyword") for m in chat_matches]))
        if sm.send_telegram(alert_text(platform, post, keywords), chat_id=chat_id):
            sent += 1
    return "stored", len(matches), sent


def merge_posts(posts):
    """One entry per post; a post found for several keywords keeps them all."""
    merged = {}
    for post in posts:
        key = post.get("external_id") or post.get("url") or id(post)
        if key in merged:
            folds = merged[key]["keyword_folds"]
            if post["keyword_fold"] not in folds:
                folds.append(post["keyword_fold"])
        else:
            merged[key] = {**post, "keyword_folds": [post["keyword_fold"]]}
    return list(merged.values())


def sample(post):
    published = post.get("published_at")
    return {
        "url": post.get("url"),
        "text": " ".join(sm.clean_text(post.get("text")).split())[:120],
        "date": published.isoformat() if published else None,
    }


def collect_platform(platform, settings, targets, source_id, keyword_cache, now):
    # YouTube costs no money, only its daily quota.
    if platform != "youtube" and budget_exhausted(settings, now, platform):
        print(f"{platform}: aylıq büdcə limiti dolub, axtarış dayandırıldı.", flush=True)
        return
    state = load_keyword_state(platform)
    due = due_keywords(platform, targets, now, state, settings)
    if not due:
        return
    print(f"{platform}: {len(due)} açar söz axtarılır", flush=True)

    batches = [due] if platform == "facebook" else [[folded] for folded in due]
    for batch in batches:
        if platform == "facebook":
            posts, usd, error = apify_facebook_search(targets, batch, settings)
        elif platform == "youtube":
            if youtube_quota_left(settings, now) < YOUTUBE_UNITS_PER_SEARCH:
                print("youtube: gündəlik kvota dolub, qalan açar sözlər sabaha (Sakit okean vaxtı) qaldı.", flush=True)
                return
            posts, usd, error = youtube_search(targets, batch[0], now)
            if error and "quotaExceeded" in error:
                # Google says the day's quota is gone: stop until it resets.
                add_youtube_units(now, 0, exhausted_at=int(youtube_setting(settings, "youtube_daily_quota")))
            else:
                add_youtube_units(now, YOUTUBE_UNITS_PER_SEARCH)
        else:
            if budget_exhausted(settings, now, platform):
                print("instagram: aylıq büdcə limiti dolub, qalan açar sözlər keçildi.", flush=True)
                return
            posts, usd, error = socialfetch_instagram_hashtag(targets, batch[0])
        add_usage(now, usd, 1, platform)
        stats = {folded: new_stats() for folded in batch}
        for post in posts:
            keyword_stats = stats.setdefault(post["keyword_fold"], new_stats())
            keyword_stats["raw"] += 1
            if len(keyword_stats["samples"]) < 3:
                keyword_stats["samples"].append(sample(post))
        for post in merge_posts(posts):
            outcome, matched_users, alerted = handle_post(platform, source_id, post, keyword_cache, now)
            for folded in post["keyword_folds"]:
                keyword_stats = stats.setdefault(folded, new_stats())
                keyword_stats[outcome] += 1
                keyword_stats["matched_users"] += matched_users
                keyword_stats["alerted"] += alerted
        for folded in batch:
            keyword_stats = stats.setdefault(folded, new_stats())
            # Facebook bills per delivered post; Instagram per call (one keyword per call);
            # YouTube is free.
            if platform == "facebook":
                keyword_usd = keyword_stats["raw"] * APIFY_FB_USD_PER_POST
            else:
                keyword_usd = usd / len(batch)
            carry_totals(keyword_stats, (state.get(folded) or {}).get("last_stats"), now, keyword_usd)
        record_keyword_state(platform, batch, stats, error)
        print(f"{platform}: {len(batch)} söz | {stats_line(stats)} | xəta={error or '-'}", flush=True)
        # YouTube answers a bad key with 400 keyInvalid.
        if error and (error.endswith((":401", ":402", ":403")) or "keyInvalid" in error):
            print(f"{platform}: açar rədd edildi və ya kredit/kvota bitdi, bu dövr dayandırıldı.", flush=True)
            return


# Watched Instagram pages and Telegram channels ---------------------------------------


# Until migration 20261023000003 adds social_watched_accounts, accounts are skipped.
def load_watched_accounts(platform):
    response = requests.get(
        f"{sm.SUPABASE_URL}/rest/v1/social_watched_accounts",
        headers=sm.supabase_headers(),
        params={"select": "*", "platform": f"eq.{platform}", "active": "eq.true", "order": "handle"},
        timeout=sm.REQUEST_TIMEOUT,
    )
    if response.status_code != 200:
        print(f"social_watched_accounts oxunmadı ({response.status_code}); migration 20261023000003 lazımdır.", flush=True)
        return []
    return response.json() or []


def due_accounts(platform, rows, now):
    due = []
    for row in rows:
        interval = row.get("check_interval_minutes") or ACCOUNT_DEFAULT_INTERVALS[platform]
        last = parse_time(row.get("last_checked_at"))
        if last is None or now - last >= timedelta(minutes=interval):
            due.append(row)
    return due


def record_account_state(row, stats, error):
    response = requests.patch(
        f"{sm.SUPABASE_URL}/rest/v1/social_watched_accounts",
        headers=sm.supabase_headers({"Prefer": "return=minimal"}),
        params={"id": f"eq.{row.get('id')}"},
        json={
            "last_checked_at": utcnow().isoformat(),
            "last_error": error,
            "last_post_count": stats["raw"],
            "last_stats": {**stats, "error": error},
        },
        timeout=sm.REQUEST_TIMEOUT,
    )
    if response.status_code not in (200, 204):
        print(f"social_watched_accounts yazılmadı: {response.status_code} | {response.text[:160]}", flush=True)


def collect_accounts(platform, settings, source_id, keyword_cache, now):
    due = due_accounts(platform, load_watched_accounts(platform), now)
    if not due:
        return
    print(f"{platform} səhifələri: {len(due)} hesab oxunur", flush=True)
    for row in due:
        handle = sm.clean_text(row.get("handle"))
        if platform == "instagram":
            if budget_exhausted(settings, now, platform):
                print("instagram səhifələri: aylıq büdcə limiti dolub, qalan səhifələr keçildi.", flush=True)
                return
            posts, usd, error = socialfetch_instagram_profile(handle)
            add_usage(now, usd, 1, platform)
        else:
            posts, usd, error = fetch_telegram_channel(handle)
        stats = new_stats()
        stats["raw"] = len(posts)
        stats["samples"] = [sample(post) for post in posts[:3]]
        for post in merge_posts(posts):
            outcome, matched_users, alerted = handle_post(platform, source_id, post, keyword_cache, now)
            stats[outcome] += 1
            stats["matched_users"] += matched_users
            stats["alerted"] += alerted
        record_account_state(row, stats, error)
        print(f"{platform} @{handle} | {stats_line({handle: stats})} | xəta={error or '-'}", flush=True)
        if platform == "instagram" and error and error.endswith((":401", ":402", ":403")):
            print("instagram: açar rədd edildi və ya kredit bitdi, bu dövr dayandırıldı.", flush=True)
            return


# Tick ---------------------------------------------------------------------------------


def write_heartbeat(settings, now, **extra):
    """Admin page shows whether the social service runs at all. Never secrets."""
    beat = {
        "at": now.isoformat(),
        "facebook_enabled": bool(settings.get("facebook_enabled")),
        "instagram_enabled": bool(settings.get("instagram_enabled")),
        "instagram_accounts_enabled": bool(settings.get("instagram_accounts_enabled")),
        "telegram_channels_enabled": bool(settings.get("telegram_channels_enabled")),
        "apify_key": bool(APIFY_TOKEN),
        "socialfetch_key": bool(SOCIALFETCH_API_KEY),
    }
    if settings.get("youtube_enabled"):
        beat.update({
            "youtube_enabled": True,
            "youtube_key": bool(YOUTUBE_API_KEY),
            "youtube_units_today": youtube_units_used(now),
            "youtube_daily_quota": int(youtube_setting(settings, "youtube_daily_quota")),
        })
    sm.save_runtime_state("social_heartbeat", {**beat, **extra})


def run_tick(now=None):
    now = now or utcnow()
    settings = load_settings()
    enabled = {
        "facebook": bool(settings.get("facebook_enabled")) and bool(APIFY_TOKEN),
        "instagram": bool(settings.get("instagram_enabled")) and bool(SOCIALFETCH_API_KEY),
        "youtube": bool(settings.get("youtube_enabled")) and bool(YOUTUBE_API_KEY),
    }
    instagram_pages = bool(settings.get("instagram_accounts_enabled")) and bool(SOCIALFETCH_API_KEY)
    telegram_channels = bool(settings.get("telegram_channels_enabled"))
    if not any(enabled.values()) and not instagram_pages and not telegram_channels:
        write_heartbeat(settings, now, keywords=0)
        return

    extra = {"keywords": 0}
    keyword_cache = []
    if any(enabled.values()) or instagram_pages:
        allowed = social_keyword_ids()
        if allowed is None:
            extra["problem"] = "social_keyword_ids_for_worker"
            enabled = {platform: False for platform in enabled}
            instagram_pages = False
        else:
            # Only keywords the customer chose for social search are searched,
            # and only their owners are alerted about social posts.
            keyword_cache = [row for row in sm.load_active_monitor_keywords() or [] if row.get("id") in allowed]

    # Each network searches (and alerts) only the keywords of plans that include it.
    platform_caches = {}
    targets = {}
    if keyword_cache:
        profiles = rest_get("user_profiles", {"select": "user_id,plan_id,social_interval_minutes"})
        plans = rest_get("subscription_plans", {"select": "id,limits"})
        default_interval = int(settings.get("default_interval_minutes") or 360)
        for platform in ("facebook", "instagram", "youtube"):
            platform_caches[platform] = keywords_for_platform(platform, keyword_cache, profiles, plans)
            if enabled[platform]:
                targets[platform] = keyword_intervals(platform_caches[platform], profiles, plans, default_interval)
        if enabled["facebook"] or enabled["instagram"]:
            extra["keywords"] = len(
                set(keyword_intervals(platform_caches["facebook"], profiles, plans, default_interval))
                | set(keyword_intervals(platform_caches["instagram"], profiles, plans, default_interval))
            )
        if enabled["youtube"]:
            extra["youtube_keywords"] = len(targets["youtube"])
    write_heartbeat(settings, now, **extra)
    instagram_cache = platform_caches.get("instagram") or []
    if not any(targets.values()) and not (instagram_pages and instagram_cache) and not telegram_channels:
        return

    source_ids = platform_source_ids()
    jobs = [(platform, "keywords") for platform, platform_targets in targets.items() if platform_targets]
    if instagram_pages and instagram_cache:
        jobs.append(("instagram", "accounts"))
    if telegram_channels:
        jobs.append(("telegram", "accounts"))
    for platform, kind in jobs:
        if not source_ids.get(platform):
            print(f"{platform}: sources sətri yoxdur (migration 20261020000001 / 20261023000003 / 20261023000005).", flush=True)
            continue
        try:
            if kind == "keywords":
                collect_platform(platform, settings, targets[platform], source_ids[platform], platform_caches[platform], now)
            elif platform == "instagram":
                collect_accounts(platform, settings, source_ids[platform], instagram_cache, now)
            else:
                # Telegram channels are a news source: every active keyword matches.
                collect_accounts(platform, settings, source_ids[platform], sm.load_active_monitor_keywords() or [], now)
        except Exception as exc:
            print(f"{platform} xətası: {sm.redact_secrets(exc)}", flush=True)


def main():
    if not sm.supabase_ready():
        raise SystemExit(1)
    print("Sosial kollektor işə düşdü.", flush=True)
    while True:
        try:
            run_tick()
        except Exception as exc:
            print(f"Sosial dövr xətası: {sm.redact_secrets(exc)}", flush=True)
        time.sleep(SOCIAL_TICK_SECONDS)


if __name__ == "__main__":
    main()
