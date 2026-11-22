import importlib.util
import os

import pytest


def load_engagement():
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "engagement.py")
    spec = importlib.util.spec_from_file_location("social_engagement_under_test", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


eg = load_engagement()


@pytest.mark.parametrize("value,expected", [
    (42, 42), ("42", 42), ("1,234", 1234), ("1.2K", 1200), ("3M", 3_000_000), ("1,5k", 1500),
    ({"count": 9}, 9), (None, None), (True, None), ("abc", None), (-1, None), ([{"id": 1}], None),
])
def test_parse_count(value, expected):
    assert eg.parse_count(value) == expected


def test_x_counts():
    item = {"likeCount": 10, "replyCount": 2, "retweetCount": 3, "viewCount": 500}
    assert eg.counts("x", item) == {"likes": 10, "comments": 2, "shares": 3, "views": 500}


def test_linkedin_counts_are_nested():
    item = {"engagement": {"likes": 8, "comments": 1, "shares": 0}}
    assert eg.counts("linkedin", item) == {"likes": 8, "comments": 1, "shares": 0, "views": None}


def test_facebook_counts_skip_lists_and_use_the_next_name():
    item = {"reactions_count": 120, "comments": [{"text": "a"}], "comments_count": 4, "reshare_count": "1.1K"}
    assert eg.counts("facebook", item) == {"likes": 120, "comments": 4, "shares": 1100, "views": None}


def test_unknown_fields_give_empty_counts_and_zero_total():
    counts = eg.counts("instagram", {"caption": "x"})
    assert counts == {"likes": None, "comments": None, "shares": None, "views": None}
    assert eg.total(counts) == 0


def test_youtube_counts_and_total():
    counts = eg.youtube_counts({"viewCount": "1500", "likeCount": "40", "commentCount": "7"})
    assert counts == {"likes": 40, "comments": 7, "shares": None, "views": 1500}
    assert eg.total(counts) == 47
