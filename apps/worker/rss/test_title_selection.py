import site_monitor as m

LEDE = (
    "İspaniyanın paytaxtı Madriddə dövlət təhsil müəssisələrinin müəllimlərinin müddətsiz tətilə çıxması "
    "nəticəsində minlərlə şagird dərsdən yayınıb, hökumət isə danışıqlara hazır olduğunu bildirib və s."
)


def extract(html, url, domain):
    return m.extract_article_title_info_from_html(html, url, domain)


def test_ascii_slug_matches_azerbaijani_title():
    for url, title in [
        ("https://news365.az/bakinin-merkezinde-50-otaqli-otel-herraca-cixarildi/147977", "Bakının mərkəzində 50 otaqlı otel hərraca çıxarıldı – qiyməti 5,6 milyon manatdır"),
        ("https://1xeber.media/gundem/69660-azerbaycanin-qaz-ixraci-azalib.html", "Azərbaycanın qaz ixracı azalıb"),
    ]:
        assert m.title_rejection_reason(title, url, "x") == ""


def test_summary_h2_does_not_beat_og_title():
    html = f'<html><head><meta property="og:title" content="Madriddə müəllimlər müddətsiz tətilə çıxdı"></head><body><main><h2>{LEDE}</h2></main></body></html>'
    info = extract(html, "https://bizimyol.info/aze/articles/2026/10/19/1805hgwolf12o7cyf7.html", "bizimyol.info")
    assert info["method"] == "og_title"


def test_wrong_related_post_title_is_not_used():
    html = '<html><head><meta property="og:title" content="Rus sektoru ilə bağlı yenilik – Bundan sonra…"></head><body><div class="post-title">Laos Prezidenti BDU-nun tələbələri ilə görüşüb</div></body></html>'
    assert extract(html, "https://news365.az/rus-sektoru-ile-bagli-yenilik/147723", "news365.az")["title"] == ""


def test_site_name_meta_does_not_block_real_h1():
    url = "https://dim.gov.az/az/metbuat/xeberler/dovlet-qullugunda-inzibati-vezifelerin-b-novune-aid-bb-vezife-qrupu-uzre-imtahandan-muveffeqiyyet-elde-etmis-sexslerin-nezerine-7"
    h1 = "Dövlət qulluğunda inzibati vəzifələrin B növünə aid BB vəzifə qrupu üzrə imtahandan müvəffəqiyyət əldə etmiş şəxslərin nəzərinə"
    html = f'<html><head><meta property="og:title" content="Dövlət İmtahan Mərkəzi"></head><body><h1>{h1}</h1></body></html>'
    assert extract(html, url, "dim.gov.az")["method"] == "selector:h1"
