import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import site_monitor as sm  # noqa: E402


def test_newsid_query_links_are_articles():
    assert sm.is_article_like_link("https://sizinxeber.az/index.php?newsid=164494")
    assert sm.is_article_like_link("https://example.az/?p=11661")


def test_non_article_queries_are_not_articles():
    assert not sm.is_article_like_link("https://sizinxeber.az/index.php?page=2")
    assert not sm.is_article_like_link("https://sizinxeber.az/index.php?newsid=12")
    assert not sm.is_article_like_link("https://example.az/search?p=abc")


def test_newsid_link_passes_add_item():
    results = []
    sm.add_item(results, "https://sizinxeber.az/", "Prezident Zəngilanda yeni təhsil kompleksinin açılışında iştirak edib",
                "https://sizinxeber.az/index.php?newsid=164494", [], {"source_context": "html", "url_patterns": []})
    assert [item["link"] for item in results] == ["https://sizinxeber.az/index.php?newsid=164494"]
