import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import site_monitor as sm  # noqa: E402

WP_LINK = (
    "https://showmedia.az/taninmis-aktyor-orqanlarini-bagisladi/"
    "?utm_source=rss&utm_medium=rss&utm_campaign=taninmis-aktyor-orqanlarini-bagisladi"
)
RSS_EXTRA = {"source_context": "rss", "url_patterns": []}


def test_wordpress_feed_link_with_utm_rss_is_accepted_and_cleaned():
    results = []
    sm.add_item(results, "https://showmedia.az/", "Tanınmış aktyor orqanlarını bağışladı", WP_LINK, [], RSS_EXTRA)
    assert [item["link"] for item in results] == ["https://showmedia.az/taninmis-aktyor-orqanlarini-bagisladi/"]


def test_percent_encoded_slug_is_kept():
    link = "https://showmedia.az/prezident-v%c9%99-xanimi-acilisda/?utm_source=rss&utm_medium=rss"
    results = []
    sm.add_item(results, "https://showmedia.az/", "Prezident və xanımı açılışda", link, [], RSS_EXTRA)
    assert results and results[0]["link"] == "https://showmedia.az/prezident-v%c9%99-xanimi-acilisda/"


def test_non_tracking_params_survive():
    assert sm.strip_tracking_params("https://a.az/read?id=5&utm_source=rss&fbclid=x") == "https://a.az/read?id=5"
    assert sm.strip_tracking_params("https://a.az/x/") == "https://a.az/x/"


def test_real_rss_page_link_is_still_rejected():
    results = []
    sm.add_item(results, "https://a.az/", "Bütün xəbərlər üçün RSS lenti", "https://a.az/rss", [], RSS_EXTRA)
    assert results == []
