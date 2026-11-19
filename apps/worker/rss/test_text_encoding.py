import feedparser

import site_monitor as sm


class FakeResponse:
    def __init__(self, content, encoding=None, apparent_encoding=None):
        self.content = content
        self.encoding = encoding
        self.apparent_encoding = apparent_encoding
        self.text = content.decode(encoding or "utf-8", errors="replace")


RUSSIAN = "На вершине Кремля обсуждают переговоры. Где Интервью? Йод, Ёж"


def as_cp1251_mojibake(text):
    return text.encode("utf-8").decode("cp1251", errors="replace")


def test_utf8_russian_page_is_not_read_as_cp1251():
    page = f"<html><head><meta charset='utf-8'></head><body><h1>{RUSSIAN}</h1></body></html>".encode()
    for declared in (None, "ISO-8859-1", "windows-1251"):
        decoded = sm.decode_response_text(FakeResponse(page, encoding=declared, apparent_encoding="windows-1251"))
        assert RUSSIAN in decoded


def test_real_cp1251_page_still_decodes():
    page = f"<html><body><h1>{RUSSIAN}</h1></body></html>".encode("cp1251")
    decoded = sm.decode_response_text(FakeResponse(page, encoding="windows-1251", apparent_encoding="windows-1251"))
    assert RUSSIAN in decoded


def test_russian_feed_titles_are_not_flagged_as_mojibake():
    feed = f"""<?xml version="1.0" encoding="utf-8"?><rss><channel><item>
<title>{RUSSIAN}</title><link>https://site.az/ru/1</link></item></channel></rss>""".encode()
    title = sm.clean_article_text(feedparser.parse(feed).entries[0].title)
    assert title == RUSSIAN
    assert sm.mojibake_score(title) == 0


def test_cp1251_mojibake_titles_are_repaired():
    assert sm.clean_text(as_cp1251_mojibake(RUSSIAN)) == RUSSIAN
    # U+FFFD stands where the undefined byte 0x98 of "И" was.
    assert sm.repair_mojibake(as_cp1251_mojibake("Интервью")) == "Интервью"
    assert sm.repair_mojibake(as_cp1251_mojibake("Bakıda güclü əhali")) == "Bakıda güclü əhali"


def test_ordinary_text_is_left_alone():
    for text in ("МЧС: «Газпром» — ДТП в Ереване", "Ёлка СМИ» РЖД»", "Prezident İlham Əliyev çıxış edib"):
        assert sm.repair_mojibake(text) == text
        assert sm.mojibake_score(text) == 0
