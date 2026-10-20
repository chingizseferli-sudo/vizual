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


def test_cyrillic_title_matches_transliterated_slug():
    title_rejection_reason = m.title_rejection_reason
    cases = [
        ("https://media.az/society/v-baku-pri-stolknovenii-dvuh-avtomobilej-pogib-peshehod", "Стали известны подробности гибели пешехода в Баку"),
        ("https://korrespondent.az/news/v-azerbaydjane-novyy-ministr-zdravoohraneniya/111366", "В Азербайджане новый министр здравоохранения"),
        ("https://media.az/economy/v-selah-hodzhavendskogo-rajona-vedetsya-prokladka-gazovyh-linij", "В селах Ходжавендского района ведется прокладка газовых линий"),
    ]
    for url, title in cases:
        assert title_rejection_reason(title, url) == "", (url, title)


def test_cyrillic_title_for_unrelated_slug_is_still_rejected():
    title_rejection_reason = m.title_rejection_reason
    url = "https://media.az/society/v-baku-pri-stolknovenii-dvuh-avtomobilej-pogib-peshehod"
    assert title_rejection_reason("Курс доллара вырос на бирже сегодня утром", url) == "slug_mismatch"


def test_trailing_digit_in_slug_word_is_ignored():
    title_rejection_reason = m.title_rejection_reason
    assert title_rejection_reason("Qarabağ - Azərbaycandır!", "https://musicacademy.edu.az/az/kheberler/lahiyeler/qarabaq-azerbaycandir1.html") == ""


def test_in_word_hyphen_is_not_cut_as_site_suffix():
    suffix = " » Son xəbərlər,Azərbaycanda və Dünyada ən aktual hadisələr 1Xeber.com"
    for title in ['"Sabah" bu gün Dortmund "Borussiya"sı ilə üz-üzə gələcək', "Bakıda küləyin sürəti 27 m/s-yə çatır"]:
        assert m.clean_title_for_message(title + suffix) == title
    assert m.clean_title_for_message("Xəbər başlığı - Son xəbərlər, Azərbaycanda") == "Xəbər başlığı"
