"""Does a site behave like a news outlet? Decided from its real articles, not from words on the homepage.

A news outlet publishes dated articles with real text, several a week and at least one in the last
three days. A company site with a "News" section has few, old or undated items.
"""
import json
import math
import re
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from bs4 import BeautifulSoup
from dateutil import parser as date_parser

BAKU_TZ = ZoneInfo("Asia/Baku")
SAMPLE_SIZE = 6
MIN_ARTICLES = 3
MIN_WORDS = 80
FRESH_HOURS = 72
FRESH_WEEK_MIN = 3
ARTICLE_TYPES = {"newsarticle", "article", "reportagenewsarticle", "analysisnewsarticle", "blogposting"}
NUMERIC_DATE = re.compile(r"(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:\D{1,20}(\d{1,2})[:.](\d{2}))?")


def parse_published(value, now=None):
    """ISO strings and the dd.mm.yyyy hh:mm style Azerbaijani sites show. None when unreadable."""
    text = str(value or "").strip()
    if not text:
        return None
    now = now or datetime.now(timezone.utc)
    try:
        match = NUMERIC_DATE.search(text)
        if match:
            day, month, year = int(match.group(1)), int(match.group(2)), int(match.group(3))
            hour, minute = int(match.group(4) or 0), int(match.group(5) or 0)
            parsed = datetime(year, month, day, hour, minute, tzinfo=BAKU_TZ)
        else:
            parsed = date_parser.parse(text)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=BAKU_TZ)
    except (ValueError, OverflowError, TypeError):
        return None
    parsed = parsed.astimezone(timezone.utc)
    if parsed.year < 2000 or parsed > now + timedelta(days=2):
        return None
    return parsed


def _walk_json(node):
    if isinstance(node, dict):
        yield node
        for value in node.values():
            yield from _walk_json(value)
    elif isinstance(node, list):
        for item in node:
            yield from _walk_json(item)


def article_evidence(page_html, now=None):
    """What one article page says about itself: publish time, article markup, amount of text."""
    soup = BeautifulSoup(page_html or "", "html.parser")
    markup = False
    candidates = []

    for script in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(script.string or script.get_text() or "")
        except (ValueError, TypeError):
            continue
        for item in _walk_json(data):
            types = item.get("@type")
            types = types if isinstance(types, list) else [types]
            if any(str(kind).lower() in ARTICLE_TYPES for kind in types):
                markup = True
                candidates.append(item.get("datePublished"))

    for meta in soup.find_all("meta"):
        key = (meta.get("property") or meta.get("name") or meta.get("itemprop") or "").lower()
        if key == "og:type" and (meta.get("content") or "").lower() == "article":
            markup = True
        if key in {"article:published_time", "og:article:published_time", "datepublished", "pubdate", "publishdate", "date"}:
            candidates.append(meta.get("content"))

    time_tag = soup.find("time")
    if time_tag:
        candidates.append(time_tag.get("datetime") or time_tag.get_text(" ", strip=True))

    published = next((parsed for parsed in (parse_published(value, now) for value in candidates) if parsed), None)

    body = soup.find("article") or soup
    words = len(" ".join(p.get_text(" ", strip=True) for p in body.find_all("p")).split())
    return {"published": published, "markup": markup, "words": words}


def judge_articles(evidence, now=None):
    """(is_news_site, reason, stats) from the evidence of the sampled articles."""
    now = now or datetime.now(timezone.utc)
    count = len(evidence)
    dated = [item["published"] for item in evidence if item.get("published")]
    fresh_week = sum(1 for moment in dated if now - moment <= timedelta(days=7))
    fresh_recent = sum(1 for moment in dated if now - moment <= timedelta(hours=FRESH_HOURS))
    with_text = sum(1 for item in evidence if item.get("words", 0) >= MIN_WORDS)
    stats = {"articles": count, "dated": len(dated), "fresh_7d": fresh_week, "fresh_72h": fresh_recent, "with_text": with_text}

    half = math.ceil(count / 2)
    if count < MIN_ARTICLES:
        return False, f"too_few_articles:{count}", stats
    if len(dated) < max(2, half):
        return False, f"undated_articles:{len(dated)}/{count}", stats
    if fresh_week < FRESH_WEEK_MIN:
        return False, f"stale:{fresh_week}_in_7d", stats
    if fresh_recent < 1:
        return False, "nothing_in_72h", stats
    if with_text < half:
        return False, f"no_article_text:{with_text}/{count}", stats
    return True, "ok", stats


def judge_feed_dates(published_dates, now=None):
    """Same freshness rule for an RSS feed, used when the site's HTML cannot be read."""
    now = now or datetime.now(timezone.utc)
    fresh_week = sum(1 for moment in published_dates if now - moment <= timedelta(days=7))
    fresh_recent = sum(1 for moment in published_dates if now - moment <= timedelta(hours=FRESH_HOURS))
    stats = {"feed_entries": len(published_dates), "fresh_7d": fresh_week, "fresh_72h": fresh_recent}
    if fresh_week >= FRESH_WEEK_MIN and fresh_recent >= 1:
        return True, "ok", stats
    return False, f"feed_stale:{fresh_week}_in_7d", stats
