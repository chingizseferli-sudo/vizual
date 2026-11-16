import importlib.util
import os
import sys

import pytest

os.environ.setdefault("SUPABASE_URL", "")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "")

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

from article_text import extract_article_body, feed_entry_text  # noqa: E402


@pytest.fixture()
def sm():
    spec = importlib.util.spec_from_file_location("site_monitor_body", os.path.join(HERE, "site_monitor.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


ARTICLE_PAGE = """
<html><head>
<meta property="og:description" content="Direktor valideynlərlə görüşdə qəribə açıqlama verib.">
</head><body>
<header><nav><a href="/">Əsas</a> <a href="/tehsil">Təhsil</a></nav></header>
<div class="container">
  <div class="news-text">
    <p>Paytaxtın 23 nömrəli məktəbinin direktoru valideynlərlə görüşdə qəribə açıqlama verib.</p>
    <p>Direktor bildirib ki, dərslər bundan sonra bir saat gec başlayacaq və valideynlər buna hazır olmalıdır.</p>
  </div>
  <div class="related-news">
    <p>Bakı Dövlət Universitetində yeni tədris ili başladı, tələbələr dərslərə qayıtdı.</p>
  </div>
  <div class="col">
    <p><a href="/x">Gəncədə yeni xəstəxana açıldı, həkimlər işə başladı</a></p>
    <p><a href="/y">Sumqayıtda yol təmiri davam edir, sürücülər narazıdır</a></p>
    <p><a href="/z">Şəkidə turist mövsümü başladı, otellər doludur</a></p>
  </div>
</div>
<footer><p>Bütün hüquqlar qorunur. Saytdan istifadə zamanı istinad mütləqdir, müəllif hüquqları.</p></footer>
</body></html>
"""


def test_body_is_the_article_text_without_related_news_or_footer():
    body = extract_article_body(ARTICLE_PAGE)
    assert "23 nömrəli məktəbinin direktoru" in body
    assert "bir saat gec" in body
    assert "Bakı Dövlət Universitetində" not in body
    assert "hüquqlar" not in body
    assert "Gəncədə" not in body


def test_json_ld_article_body_is_used_first():
    page = """<html><head><script type="application/ld+json">
    {"@context": "https://schema.org", "@graph": [{"@type": "NewsArticle",
     "articleBody": "<p>AZAL Bakı-London reysini bərpa edir, biletlər satışa çıxarılıb.</p>"}]}
    </script></head><body><p>Menyu və başqa mətn, kifayət qədər uzun olsun ki, paraqraf sayılsın.</p></body></html>"""
    assert extract_article_body(page) == "AZAL Bakı-London reysini bərpa edir, biletlər satışa çıxarılıb."


def test_empty_or_broken_pages_give_no_body():
    assert extract_article_body("") == ""
    assert extract_article_body("<html><body><a href='/x'>link</a></body></html>") == ""


def test_feed_entry_text_strips_html_and_merges_summary_and_content():
    entry = {
        "summary": "<p>Qısa: <b>direktor</b> açıqlama verib</p>",
        "content": [{"value": "<div><p>Tam mətn: 23 nömrəli məktəb</p></div>"}],
    }
    text = feed_entry_text(entry)
    assert "Tam mətn: 23 nömrəli məktəb" in text
    assert "Qısa: direktor açıqlama verib" in text
    assert "<" not in text


def test_matcher_finds_keyword_only_in_body_and_remembers_it(sm):
    matcher = sm.article_keyword_matcher(
        "Direktor valideynlərə qəribə açıqlama verdi",
        "Paytaxtın 23 saylı məktəb direktoru dərslərin gec başlayacağını bildirib.",
    )
    assert matcher("23 saylı məktəb")
    assert matcher("direktor")
    assert not matcher("universitet")
    assert matcher.body_only == {sm.keyword_fold("23 saylı məktəb")}


def test_short_keywords_stay_whole_word_in_body(sm):
    matcher = sm.article_keyword_matcher("Yeni qaydalar", "ABDUL Həmidov və Adalət nazirliyi açıqlama verib.")
    assert not matcher("BDU")
    assert not matcher("ADA")


@pytest.mark.parametrize(
    "keyword, text",
    [
        ("Алиев", "Президент Алиева встретился с делегацией"),
        ("Алиев", "Ильхам Алиевым подписан указ"),
        ("Азербайджан", "В Азербайджане начался сезон"),
        ("Азербайджан", "азербайджанская делегация прибыла"),
        ("Москва", "Делегация из Москвы прибыла в Баку"),
        ("Москва", "В Москве прошла встреча"),
        ("школа", "директор школы № 23 сделал заявление"),
        ("МИД", "МИД Азербайджана выступил с заявлением"),
    ],
)
def test_russian_keywords_match_case_endings(sm, keyword, text):
    assert sm.keyword_matches_title(keyword, text)


@pytest.mark.parametrize(
    "keyword, text",
    [
        ("Алиев", "Алиевка - село в Украине"),
        ("МИД", "Мидии подорожали"),
        ("школа", "школьники вернулись"),
    ],
)
def test_russian_keywords_do_not_match_other_words(sm, keyword, text):
    assert not sm.keyword_matches_title(keyword, text)


def test_body_excerpt_shows_text_around_keyword(sm):
    body = "Birinci cümlə. " * 20 + "Paytaxtın 23 saylı məktəb direktoru açıqlama verib. " + "Son cümlə. " * 20
    excerpt = sm.body_excerpt("23 saylı məktəb", body)
    assert "23 saylı məktəb direktoru" in excerpt
    assert excerpt.startswith("…") and excerpt.endswith("…")
    assert len(excerpt) < 260


def test_article_page_is_downloaded_once_for_title_and_date(sm, monkeypatch):
    calls = []

    class Response:
        status_code = 200
        content = ARTICLE_PAGE.encode("utf-8")
        encoding = "utf-8"
        apparent_encoding = "utf-8"
        text = ARTICLE_PAGE
        url = "https://news.az/direktor"

    monkeypatch.setattr(sm, "safe_request", lambda url, **kwargs: calls.append(url) or Response())
    sm.fetch_article_title_info("https://news.az/direktor")
    sm.extract_publish_time_from_article("https://news.az/direktor", return_source=True)
    assert calls == ["https://news.az/direktor"]
    assert "23 nömrəli" in sm.article_body_text({"link": "https://news.az/direktor"})


def test_body_text_never_makes_a_request(sm, monkeypatch):
    monkeypatch.setattr(sm, "safe_request", lambda *args, **kwargs: pytest.fail("no request for body"))
    assert sm.article_body_text({"link": "https://news.az/new", "rss_text": "Feed mətni"}) == "Feed mətni"


def test_body_only_match_is_alerted_with_excerpt(sm, monkeypatch):
    item = {
        "title": "Direktor valideynlərə qəribə açıqlama verdi",
        "link": "https://news.az/direktor-aciqlama",
        "source": "news.az",
        "source_context": "rss",
        "rss_text": "Paytaxtın 23 saylı məktəb direktoru dərslərin gec başlayacağını bildirib.",
    }
    keywords = [{"keyword": "23 saylı məktəb", "monitor_id": "m1", "user_monitors": {"user_id": "u1", "name": "M"}}]
    sent = []
    monkeypatch.setattr(sm, "supabase_ready", lambda: True)
    monkeypatch.setattr(sm, "keyword_is_active", lambda row: True)
    monkeypatch.setattr(sm, "get_user_telegram_chat_id", lambda user_id: "chat-1")
    monkeypatch.setattr(sm, "fetch_site", lambda site, patterns: [dict(item)])
    monkeypatch.setattr(sm, "choose_best_article_title_info", lambda title, link, source_domain=None, from_feed=False: {"title": title})
    monkeypatch.setattr(sm, "exists", lambda link, title=None: False)
    monkeypatch.setattr(sm, "extract_publish_time_from_article", lambda link, return_source=False: ("now", "meta"))
    monkeypatch.setattr(sm, "evaluate_publish_freshness", lambda *args, **kwargs: ("2026-11-16 10:00", "fresh"))
    monkeypatch.setattr(sm, "title_rejection_reason", lambda *args, **kwargs: "")
    monkeypatch.setattr(sm, "save_to_vizual_monitor", lambda site, item, title, published: "item-1")
    monkeypatch.setattr(
        sm,
        "match_user_monitors",
        lambda item_id, title, cache, matcher=None: sm.find_matching_user_monitors(title, cache, matcher=matcher),
    )
    monkeypatch.setattr(sm, "reserve_news", lambda *args, **kwargs: True)
    monkeypatch.setattr(sm, "send_telegram", lambda message, chat_id=None: sent.append((chat_id, message)) or True)
    monkeypatch.setattr(sm, "update_source_health", lambda site, result: None)
    monkeypatch.setattr(sm.time, "sleep", lambda seconds: None)

    result = sm.process_site(1, 1, {"name": "News", "url": "https://news.az", "id": "s1"}, {}, keywords, [])

    assert result["reason"] == "sent"
    chat_id, message = sent[0]
    assert chat_id == "chat-1"
    assert "Mətndən:\nPaytaxtın 23 saylı məktəb direktoru" in message
    assert "Açar sözlər:\n23 saylı məktəb" in message


def test_title_match_alert_has_no_excerpt(sm):
    message = sm.alert_message("BDU-da yeni il", "news.az", "bdu", "2026-11-16 10:00", "https://news.az/x")
    assert "Mətndən" not in message
    assert "Başlıq:\nBDU-da yeni il\n\nMənbə:" in message
