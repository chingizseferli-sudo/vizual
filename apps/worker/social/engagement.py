"""Like / comment / share / view counts from the providers' post objects.

The providers already return these numbers with every post; nothing extra is
requested (except YouTube, where videos.list costs 1 quota unit per 50 videos).
Field names differ per provider and version, so each count is the first of
several known names, and a dotted name reads a nested object.
"""

import re

FIELDS = ("likes", "comments", "shares", "views")

# Known names per platform, first match wins.
PLATFORM_KEYS = {
    "facebook": {
        "likes": ("reactions_count", "reactionsCount", "reactions.count", "likes", "likesCount", "likes_count"),
        "comments": ("comments_count", "commentsCount", "comments.count", "comments"),
        "shares": ("reshare_count", "shares_count", "sharesCount", "shares"),
        "views": ("video_view_count", "viewsCount", "views"),
    },
    "instagram": {
        "likes": ("likeCount", "likesCount", "like_count", "likes", "metrics.likes", "stats.likes"),
        "comments": ("commentCount", "commentsCount", "comment_count", "comments", "metrics.comments", "stats.comments"),
        "shares": ("shareCount", "sharesCount", "metrics.shares"),
        "views": ("viewCount", "playCount", "videoViewCount", "play_count", "view_count", "metrics.views", "stats.views"),
    },
    "x": {
        "likes": ("likeCount", "favorite_count", "favoriteCount"),
        "comments": ("replyCount", "reply_count"),
        "shares": ("retweetCount", "retweet_count"),
        "views": ("viewCount", "views.count"),
    },
    "linkedin": {
        "likes": ("engagement.likes", "engagement.reactions", "numLikes", "likesCount", "reactionsCount"),
        "comments": ("engagement.comments", "numComments", "commentsCount"),
        "shares": ("engagement.shares", "numShares", "sharesCount", "repostsCount"),
        "views": ("engagement.views", "numImpressions"),
    },
}

_SUFFIX = {"k": 1_000, "m": 1_000_000, "b": 1_000_000_000}


def parse_count(value):
    """An int from 42, "42", "1,234", "1.2K", "3M"; None for anything else."""
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return int(value) if value >= 0 else None
    if isinstance(value, list):
        # Some providers return the list of reactions or comments itself.
        return None
    if isinstance(value, dict):
        for key in ("count", "total", "totalCount"):
            if key in value:
                return parse_count(value[key])
        return None
    text = str(value).strip().lower().replace(" ", "").replace(" ", "")
    match = re.fullmatch(r"(\d+(?:[.,]\d+)?)([kmb]?)", text)
    if not match:
        return None
    number, suffix = match.groups()
    if suffix:
        return int(float(number.replace(",", ".")) * _SUFFIX[suffix])
    return int(number.replace(",", "").replace(".", ""))


def _lookup(item, dotted):
    value = item
    for part in dotted.split("."):
        if not isinstance(value, dict):
            return None
        value = value.get(part)
    return value


def counts(platform, item):
    """{"likes", "comments", "shares", "views"} -> int or None, from one raw post."""
    keys = PLATFORM_KEYS.get(platform) or {}
    result = {}
    for field in FIELDS:
        result[field] = None
        for key in keys.get(field, ()):
            number = parse_count(_lookup(item, key))
            if number is not None:
                result[field] = number
                break
    return result


def youtube_counts(statistics):
    statistics = statistics or {}
    return {
        "likes": parse_count(statistics.get("likeCount")),
        "comments": parse_count(statistics.get("commentCount")),
        "shares": None,
        "views": parse_count(statistics.get("viewCount")),
    }


def total(post):
    """likes + comments + shares (views are a different scale and left out)."""
    return sum(post.get(field) or 0 for field in ("likes", "comments", "shares"))
