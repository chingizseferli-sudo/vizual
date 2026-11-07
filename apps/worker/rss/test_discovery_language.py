import discovery_bot

BLOAT = "<style>" + "a{color:red}" * 3000 + "</style><script>" + "var x=1;" * 3000 + "</script>"


def test_words_after_long_head_are_counted():
    html = f"<html><head>{BLOAT}</head><body><a>Xəbər</a> <a>Gündəm</a> <a>Siyasət</a> <a>İqtisadiyyat</a></body></html>"
    assert discovery_bot.count_az_news_language_signals(html) >= 3
    assert discovery_bot.is_azerbaijani_source("bizimesr.media", html)


def test_words_inside_scripts_do_not_count():
    html = "<html><body><script>var a='xəbər gündəm siyasət iqtisadiyyat';</script><p>Hello world</p></body></html>"
    assert discovery_bot.count_az_news_language_signals(html) == 0


def test_declared_azerbaijani_language_counts():
    html = '<html lang="az"><head></head><body>x</body></html>'
    assert discovery_bot.is_azerbaijani_source("example.media", html)


def test_russian_page_is_not_azerbaijani():
    html = "<html lang='ru'><body><p>Новости дня политика экономика</p></body></html>"
    assert not discovery_bot.is_azerbaijani_source("example.ru", html)
