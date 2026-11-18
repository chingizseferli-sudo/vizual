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


def test_body_only_match_is_alerted_without_excerpt(sm, monkeypatch):
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
    assert "Mətndən" not in message and "direktoru" not in message
    assert "Başlıq:\n" in message and "Tarix və saat:\n" in message and "Link:\n" in message
    assert "Açar sözlər:\n23 saylı məktəb" in message


def test_alert_has_title_source_keywords_date_link_only(sm):
    message = sm.alert_message("BDU-da yeni il", "news.az", "bdu", "2026-11-16 10:00", "https://news.az/x")
    assert "Mətndən" not in message
    assert "Başlıq:\nBDU-da yeni il\n\nMənbə:" in message


INLINE_READ_ALSO_PAGE = """
<html><body><div class="content">
  <h1>Nazir məktəbdə görüş keçirdi</h1>
  <div class="text">
    <p>Təhsil naziri bu gün paytaxtdakı məktəblərdən birində müəllimlərlə görüş keçirib.</p>
    <p><strong>Həmçinin oxu:</strong> <a href="/news/2">AZAL Bakı-London reysini bərpa edir</a></p>
    <p>Görüşdə yeni tədris proqramı və dərsliklər müzakirə olunub, təkliflər dinlənilib.</p>
    <div class="box">
      <h3>Oxşar xəbərlər</h3>
    </div>
    <ul><li><a href="/news/3">Bakı Dövlət Universitetində yeni fakültə açıldı</a></li>
        <li><a href="/news/4">Sumqayıtda yol təmiri davam edir</a></li></ul>
    <div class="cards">
      <div class="item"><a href="/news/5"><h3>Gəncədə yeni xəstəxana açıldı</h3></a>
        <p>Gəncə şəhərində 300 çarpayılıq yeni xəstəxana istifadəyə verilib, həkimlər işə başlayıb.</p></div>
    </div>
  </div>
</div></body></html>
"""


def test_read_also_links_and_teaser_cards_are_not_article_text():
    body = extract_article_body(INLINE_READ_ALSO_PAGE)
    assert "müəllimlərlə görüş" in body and "yeni tədris proqramı" in body
    for other_story in ("AZAL", "Bakı Dövlət Universitetində", "Sumqayıtda", "Gəncə"):
        assert other_story not in body


def test_russian_read_also_in_json_ld_body_is_dropped():
    page = """<html><head><script type="application/ld+json">
    {"@type": "NewsArticle", "articleBody": "Министр провёл встречу с учителями в одной из школ столицы.\\nЧитайте также: AZAL возобновляет рейсы Баку-Лондон\\nНа встрече обсуждались новые учебники."}
    </script></head><body></body></html>"""
    body = extract_article_body(page)
    assert "встречу с учителями" in body and "новые учебники" in body
    assert "AZAL" not in body


def test_sentence_that_starts_like_a_label_is_kept():
    page = """<html><body><div class="text">
    <p>Son xəbərlərə görə, nazir sabah regionlara səfər edəcək və məktəblərlə tanış olacaq.</p>
    <p>Bu mövzuda danışan rəsmi bildirib ki, səfər bir həftə davam edəcək, proqram hazırdır.</p>
    </div></body></html>"""
    body = extract_article_body(page)
    assert "Son xəbərlərə görə" in body and "Bu mövzuda danışan" in body


def test_feed_content_read_also_link_is_dropped():
    entry = {"content": [{"value": "<p>Nazir məktəbdə müəllimlərlə görüş keçirib.</p><p>Həmçinin oxu: <a href='/x'>AZAL reysi bərpa edir</a></p>"}]}
    text = feed_entry_text(entry)
    assert "müəllimlərlə görüş" in text and "AZAL" not in text


def test_every_fresh_match_on_a_page_is_sent_in_one_check(sm, monkeypatch):
    items = [
        {"title": f"BDU-da {n}-ci yenilik elan olundu", "link": f"https://news.az/bdu-{n}", "source": "news.az", "source_context": "rss"}
        for n in (1, 2, 3)
    ]
    keywords = [{"keyword": "BDU", "monitor_id": "m1", "user_monitors": {"user_id": "u1", "name": "M"}}]
    sent = []
    monkeypatch.setattr(sm, "supabase_ready", lambda: True)
    monkeypatch.setattr(sm, "keyword_is_active", lambda row: True)
    monkeypatch.setattr(sm, "get_user_telegram_chat_id", lambda user_id: "chat-1")
    monkeypatch.setattr(sm, "fetch_site", lambda site, patterns: [dict(item) for item in items])
    monkeypatch.setattr(sm, "choose_best_article_title_info", lambda title, link, source_domain=None, from_feed=False: {"title": title})
    monkeypatch.setattr(sm, "exists", lambda link, title=None: False)
    monkeypatch.setattr(sm, "extract_publish_time_from_article", lambda link, return_source=False: ("now", "meta"))
    monkeypatch.setattr(sm, "evaluate_publish_freshness", lambda *args, **kwargs: ("2026-11-16 10:00", "fresh"))
    monkeypatch.setattr(sm, "title_rejection_reason", lambda *args, **kwargs: "")
    monkeypatch.setattr(sm, "save_to_vizual_monitor", lambda site, item, title, published: "item-" + title)
    monkeypatch.setattr(
        sm,
        "match_user_monitors",
        lambda item_id, title, cache, matcher=None: sm.find_matching_user_monitors(title, cache, matcher=matcher),
    )
    monkeypatch.setattr(sm, "reserve_news", lambda *args, **kwargs: True)
    monkeypatch.setattr(sm, "send_telegram", lambda message, chat_id=None: sent.append(message) or True)
    monkeypatch.setattr(sm, "update_source_health", lambda site, result: None)
    monkeypatch.setattr(sm.time, "sleep", lambda seconds: None)

    result = sm.process_site(1, 1, {"name": "News", "url": "https://news.az", "id": "s1"}, {}, keywords, [])

    assert result["reason"] == "sent" and result["sent"] == 3
    assert [m.split("\n")[3] for m in sent] == [item["title"] for item in items]
