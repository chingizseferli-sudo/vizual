"""Facebook (Apify) and Instagram (SocialFetch) keyword collector.

Every tick: read social_settings, collect the active monitor keywords, and
search each unique folded keyword once when it is due. A keyword is due when
its last search is older than the shortest interval among the customers who
track it (profile override, else plan limit, else the global default).

Matching posts are stored as monitored_items under the platform's sources row,
then matched and alerted through the rss worker's own functions, so panels,
matches, alerts and retention behave exactly like news items.
"""

import os
import sys
import time
import urllib.parse
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "rss"))

import requests  # noqa: E402

import site_monitor as sm  # noqa: E402

APIFY_TOKEN = os.getenv("APIFY_TOKEN", "").strip()
SOCIALFETCH_API_KEY = os.getenv("SOCIALFETCH_API_KEY", "").strip()
APIFY_BASE = "https://api.apify.com/v2"
APIFY_FB_ACTOR = "topapi~facebook-search-posts-scraper"
SOCIALFETCH_BASE = "https://api.socialfetch.dev"

SOCIAL_TICK_SECONDS = int(os.getenv("SOCIAL_TICK_SECONDS", "300"))
SOCIAL_MAX_POSTS_PER_QUERY = int(os.getenv("SOCIAL_MAX_POSTS_PER_QUERY", "10"))
# Posts older than this are stored for nobody: the first run would otherwise alert old posts.
SOCIAL_MAX_AGE_HOURS = int(os.getenv("SOCIAL_MAX_AGE_HOURS", "48"))
APIFY_RUN_TIMEOUT_SECONDS = int(os.getenv("APIFY_RUN_TIMEOUT_SECONDS", "600"))
# Budget estimates, used when the provider does not report the actual cost.
APIFY_FB_USD_PER_QUERY_ESTIMATE = float(os.getenv("APIFY_FB_USD_PER_QUERY_ESTIMATE", "0.05"))
SOCIALFETCH_USD_PER_CREDIT_ESTIMATE = float(os.getenv("SOCIALFETCH_USD_PER_CREDIT_ESTIMATE", "0.01"))

PLATFORM_BASE_URLS = {"facebook": "https://www.facebook.com", "instagram": "https://www.instagram.com"}
PLATFORM_LABELS = {"facebook": "Facebook", "instagram": "Instagram"}
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


def rest_upsert(table, rows):
    response = requests.post(
        f"{sm.SUPABASE_URL}/rest/v1/{table}",
        headers=sm.supabase_headers({"Prefer": "resolution=merge-duplicates,return=minimal"}),
        json=rows,
        timeout=sm.REQUEST_TIMEOUT,
    )
    if response.status_code not in (200, 201, 204):
        print(f"{table} yazılmadı: {response.status_code} | {response.text[:160]}", flush=True)


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


def keyword_intervals(keyword_rows, profiles, plans, default_interval):
    """{keyword_fold: {"keyword": original, "interval": minutes}} for active monitors."""
    plan_intervals = {}
    for plan in plans:
        value = (plan.get("limits") or {}).get("social_interval_minutes")
        if isinstance(value, int) and value > 0:
            plan_intervals[plan.get("id")] = value
    user_intervals = {}
    for profile in profiles:
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
        interval = user_intervals.get(monitor.get("user_id"), default_interval)
        target = targets.setdefault(folded, {"keyword": original, "interval": interval})
        target["interval"] = min(target["interval"], interval)
    return targets


def due_keywords(platform, targets, now):
    state = {
        row.get("keyword_fold"): parse_time(row.get("last_checked_at"))
        for row in rest_get("social_keyword_state", {"select": "keyword_fold,last_checked_at", "platform": f"eq.{platform}"})
    }
    due = []
    for folded, target in sorted(targets.items()):
        last = state.get(folded)
        if last is None or now - last >= timedelta(minutes=target["interval"]):
            due.append(folded)
    return due


def record_keyword_state(platform, folded_keywords, counts, error=None):
    now_iso = utcnow().isoformat()
    rest_upsert("social_keyword_state", [
        {
            "platform": platform,
            "keyword_fold": folded,
            "last_checked_at": now_iso,
            "last_result_count": counts.get(folded, 0),
            "last_error": error,
        }
        for folded in folded_keywords
    ])


# Monthly budget ---------------------------------------------------------------------


def usage_key(now):
    return f"social_usage_{now:%Y-%m}"


def load_usage(now):
    ok, value = sm.load_runtime_state(usage_key(now))
    return value if ok and isinstance(value, dict) else {"usd": 0.0, "calls": 0}


def add_usage(now, usd, calls):
    usage = load_usage(now)
    usage["usd"] = round(float(usage.get("usd") or 0) + usd, 4)
    usage["calls"] = int(usage.get("calls") or 0) + calls
    sm.save_runtime_state(usage_key(now), usage)
    return usage


def budget_exhausted(settings, now):
    budget = settings.get("monthly_budget_usd")
    if budget in (None, ""):
        return False
    return float(load_usage(now).get("usd") or 0) >= float(budget)


# Providers ----------------------------------------------------------------------------


def apify_facebook_search(targets, folded_keywords):
    """One actor run for all due keywords. Returns (posts, usd, error)."""
    headers = {"Authorization": f"Bearer {APIFY_TOKEN}"}
    by_query = {targets[folded]["keyword"]: folded for folded in folded_keywords}
    run_input = {
        "searchQueries": list(by_query),
        "sortBy": "recent",
        "monitorMode": True,
        "startDate": f"{max(1, SOCIAL_MAX_AGE_HOURS // 24)} days",
        "maxPostsPerQuery": SOCIAL_MAX_POSTS_PER_QUERY,
        "maxItems": SOCIAL_MAX_POSTS_PER_QUERY * len(by_query),
    }
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
    usd = run.get("usageTotalUsd")
    usd = float(usd) if usd is not None else APIFY_FB_USD_PER_QUERY_ESTIMATE * len(by_query)
    if run.get("status") != "SUCCEEDED":
        return [], usd, f"apify_run:{run.get('status') or 'timeout'}"
    response = requests.get(
        f"{APIFY_BASE}/datasets/{run.get('defaultDatasetId')}/items",
        params={"clean": "true", "format": "json"},
        headers=headers,
        timeout=HTTP_TIMEOUT,
    )
    if response.status_code != 200:
        return [], usd, f"apify_dataset:{response.status_code}"
    posts = []
    for item in response.json() or []:
        author = item.get("author")
        if isinstance(author, dict):
            author = author.get("name") or author.get("url")
        folded = by_query.get(item.get("search_query")) or sm.keyword_fold(item.get("search_query") or "").strip()
        posts.append({
            "keyword_fold": folded,
            "external_id": str(item.get("post_id") or item.get("id") or item.get("url") or ""),
            "url": item.get("url"),
            "text": item.get("message") or item.get("text") or "",
            "author": author or item.get("author_title"),
            "published_at": parse_time(item.get("published_at") or item.get("timestamp")),
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
    posts = []
    for item in body.get("media") or []:
        owner = item.get("owner") or {}
        posts.append({
            "keyword_fold": folded,
            "external_id": str(item.get("id") or item.get("shortcode") or item.get("url") or ""),
            "url": item.get("url"),
            "text": item.get("caption") or "",
            "author": owner.get("handle"),
            "published_at": parse_time(item.get("createdAt")),
        })
    return posts, usd, None


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


def handle_post(platform, source_id, post, keyword_cache, now):
    """Returns the number of chats alerted."""
    if not post.get("url") or not post.get("published_at"):
        return 0
    if now - post["published_at"] > timedelta(hours=SOCIAL_MAX_AGE_HOURS):
        return 0
    text = post_title(post)
    if not sm.find_matching_user_monitors(text, keyword_cache):
        return 0
    item_id = store_post(platform, source_id, post)
    if not item_id:
        return 0
    matches = sm.match_user_monitors(item_id, text, keyword_cache)
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
    return sent


def collect_platform(platform, settings, targets, source_id, keyword_cache, now):
    if budget_exhausted(settings, now):
        print(f"{platform}: aylıq büdcə limiti dolub, axtarış dayandırıldı.", flush=True)
        return
    due = due_keywords(platform, targets, now)
    if not due:
        return
    print(f"{platform}: {len(due)} açar söz axtarılır", flush=True)

    batches = [due] if platform == "facebook" else [[folded] for folded in due]
    for batch in batches:
        if platform == "facebook":
            posts, usd, error = apify_facebook_search(targets, batch)
        else:
            if budget_exhausted(settings, now):
                print("instagram: aylıq büdcə limiti dolub, qalan açar sözlər keçildi.", flush=True)
                return
            posts, usd, error = socialfetch_instagram_hashtag(targets, batch[0])
        add_usage(now, usd, 1)
        counts = {}
        alerted = 0
        for post in posts:
            counts[post["keyword_fold"]] = counts.get(post["keyword_fold"], 0) + 1
            alerted += handle_post(platform, source_id, post, keyword_cache, now)
        record_keyword_state(platform, batch, counts, error)
        print(f"{platform}: {len(batch)} söz | {len(posts)} post | {alerted} bildiriş | xəta={error or '-'}", flush=True)
        if error and error.endswith((":401", ":402", ":403")):
            print(f"{platform}: açar rədd edildi və ya kredit bitdi, bu dövr dayandırıldı.", flush=True)
            return


def run_tick(now=None):
    now = now or utcnow()
    settings = load_settings()
    enabled = {
        "facebook": bool(settings.get("facebook_enabled")) and bool(APIFY_TOKEN),
        "instagram": bool(settings.get("instagram_enabled")) and bool(SOCIALFETCH_API_KEY),
    }
    if not any(enabled.values()):
        return
    allowed = social_keyword_ids()
    if allowed is None:
        return
    # Only keywords the customer chose for FB/IG are searched, and only their
    # owners are alerted about posts.
    keyword_cache = [row for row in sm.load_active_monitor_keywords() or [] if row.get("id") in allowed]
    profiles = rest_get("user_profiles", {"select": "user_id,plan_id,social_interval_minutes"})
    plans = rest_get("subscription_plans", {"select": "id,limits"})
    targets = keyword_intervals(keyword_cache, profiles, plans, int(settings.get("default_interval_minutes") or 360))
    if not targets:
        return
    source_ids = platform_source_ids()
    for platform, is_enabled in enabled.items():
        if not is_enabled:
            continue
        if not source_ids.get(platform):
            print(f"{platform}: sources sətri yoxdur (migration 20261020000001).", flush=True)
            continue
        try:
            collect_platform(platform, settings, targets, source_ids[platform], keyword_cache, now)
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
