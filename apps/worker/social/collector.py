"""Facebook (Apify) and Instagram (SocialFetch) keyword collector, plus
watched Instagram pages and public Telegram channels.

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
"""

import os
import re
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

PLATFORM_BASE_URLS = {
    "facebook": "https://www.facebook.com",
    "instagram": "https://www.instagram.com",
    "telegram": "https://t.me",
}
PLATFORM_LABELS = {"facebook": "Facebook", "instagram": "Instagram", "telegram": "Telegram"}
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
        record_keyword_state(platform, batch, stats, error)
        print(f"{platform}: {len(batch)} söz | {stats_line(stats)} | xəta={error or '-'}", flush=True)
        if error and error.endswith((":401", ":402", ":403")):
            print(f"{platform}: açar rədd edildi və ya kredit bitdi, bu dövr dayandırıldı.", flush=True)
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
            if budget_exhausted(settings, now):
                print("instagram səhifələri: aylıq büdcə limiti dolub, qalan səhifələr keçildi.", flush=True)
                return
            posts, usd, error = socialfetch_instagram_profile(handle)
            add_usage(now, usd, 1)
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
    sm.save_runtime_state("social_heartbeat", {
        "at": now.isoformat(),
        "facebook_enabled": bool(settings.get("facebook_enabled")),
        "instagram_enabled": bool(settings.get("instagram_enabled")),
        "instagram_accounts_enabled": bool(settings.get("instagram_accounts_enabled")),
        "telegram_channels_enabled": bool(settings.get("telegram_channels_enabled")),
        "apify_key": bool(APIFY_TOKEN),
        "socialfetch_key": bool(SOCIALFETCH_API_KEY),
        **extra,
    })


def run_tick(now=None):
    now = now or utcnow()
    settings = load_settings()
    enabled = {
        "facebook": bool(settings.get("facebook_enabled")) and bool(APIFY_TOKEN),
        "instagram": bool(settings.get("instagram_enabled")) and bool(SOCIALFETCH_API_KEY),
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
            # Only keywords the customer chose for FB/IG are searched, and only
            # their owners are alerted about FB/IG posts.
            keyword_cache = [row for row in sm.load_active_monitor_keywords() or [] if row.get("id") in allowed]

    targets = {}
    if any(enabled.values()) and keyword_cache:
        profiles = rest_get("user_profiles", {"select": "user_id,plan_id,social_interval_minutes"})
        plans = rest_get("subscription_plans", {"select": "id,limits"})
        targets = keyword_intervals(keyword_cache, profiles, plans, int(settings.get("default_interval_minutes") or 360))
        extra["keywords"] = len(targets)
    write_heartbeat(settings, now, **extra)
    if not targets and not (instagram_pages and keyword_cache) and not telegram_channels:
        return

    source_ids = platform_source_ids()
    jobs = []
    if targets:
        jobs += [(platform, "keywords") for platform, is_enabled in enabled.items() if is_enabled]
    if instagram_pages and keyword_cache:
        jobs.append(("instagram", "accounts"))
    if telegram_channels:
        jobs.append(("telegram", "accounts"))
    for platform, kind in jobs:
        if not source_ids.get(platform):
            print(f"{platform}: sources sətri yoxdur (migration 20261020000001 / 20261023000003).", flush=True)
            continue
        try:
            if kind == "keywords":
                collect_platform(platform, settings, targets, source_ids[platform], keyword_cache, now)
            elif platform == "instagram":
                collect_accounts(platform, settings, source_ids[platform], keyword_cache, now)
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
