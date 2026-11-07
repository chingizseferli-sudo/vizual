import site_monitor as sm


def test_add_item_returns_empty_string_when_accepted_and_reason_when_rejected():
    results = []
    ok = sm.add_item(results, "https://tez.az", "Prezident bu gün yeni fərman imzalayıb", "https://tez.az/xeber/siyaset/123456.html", [])
    assert ok == "" and len(results) == 1
    assert sm.add_item(results, "https://tez.az", "Prezident bu gün yeni fərman imzalayıb", "https://basqa.az/x/123456.html", []) == "other_domain"
    assert sm.add_item(results, "https://tez.az", "qısa", "https://tez.az/xeber/1", []) == "non_news_title"
    assert len(results) == 1


def test_reject_summary_names_reasons_and_shows_examples():
    rejected = [("not_article_like", "https://mecra.az/a", "Başlıq bir"), ("other_domain", "https://x.az/b", "Başlıq iki"), ("not_article_like", "https://mecra.az/c", "Başlıq üç")]
    line = sm.describe_rss_rejects("mecra.az", rejected)
    assert "not_article_like=2" in line and "other_domain=1" in line
    assert "https://mecra.az/a" in line
