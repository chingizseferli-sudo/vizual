import site_monitor as sm

TITLE = "Prezident hərbçilərə yeni ali rütbələr verib"


def accepted(page, link, context="html"):
    results = []
    reason = sm.add_item(results, page, TITLE, link, [], {"source_context": context})
    return reason == "" and len(results) == 1


def test_wordpress_plain_permalinks_are_articles():
    assert accepted("https://ucnoqta.az", "https://ucnoqta.az/?p=266229", "rss")
    assert accepted("https://hakimiyyet.info.az", "https://hakimiyyet.info.az/?p=206787&utm_source=rss&utm_medium=rss&utm_campaign=prezident", "rss")
    assert accepted("https://mecra.az", "https://mecra.az/?p=68840")


def test_site_root_and_wordpress_pages_are_not_articles():
    assert not accepted("https://mecra.az", "https://mecra.az/")
    assert not accepted("https://mecra.az", "https://mecra.az/?page_id=2766")
    assert not accepted("https://mecra.az", "https://mecra.az/?p=12")


def test_feed_links_that_lost_their_host_are_repaired():
    assert accepted("https://qaynarinfo.az", ":/az/qidalarin-qebul-olunma-ardicilligi-qan-sekeri-seviyyesine-tesir-ede-biler", "rss")


def test_root_slug_html_articles_in_a_feed():
    assert accepted("https://interpress.az", "https://interpress.az/mudafie-nazirliyinin-bir-sira-herbi-qulluqcularina-ali-herbi-rutbeler-verilib.html", "rss")


def test_slug_then_id_html_articles():
    assert accepted("https://milliyol.az", "https://milliyol.az/bu-gun-general-olan-herbciler-kimlerdir-76843-xeber.html")
    assert accepted("https://bestmedia.az", "https://bestmedia.az/pasinyan-en-boyuk-vezifesinin-ne-oldugunu-aciqladi-4139-xeber.html")


def test_category_path_with_id_and_slug_is_an_article_but_a_category_is_not():
    assert accepted("https://offsideplus.az", "https://offsideplus.az/category/futbol/117365/arsenal-premyer-liqada-tarixinin-en-yaxsi-startini-tekrarladi", "rss")
    assert not accepted("https://offsideplus.az", "https://offsideplus.az/category/futbol")
    assert not accepted("https://offsideplus.az", "https://offsideplus.az/tag/117365/arsenal-premyer-liqa")


def test_php_detail_pages_with_id_or_slug():
    assert accepted("https://herbiand.az", "https://herbiand.az/post.php?id=86069")
    assert accepted("https://asxeber.az", "https://asxeber.az/news_detail.php?slug=masallida-masalli-zefer-qacisi-2026-yarimarafonu")
    assert not accepted("https://herbiand.az", "https://herbiand.az/index.php?id=5")
