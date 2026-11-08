from site_monitor import extract_links_fallback

SLUGS = [
    "vekil-fexreddin-mehdiyev-edaletli-olmayan-qanun-qanun-ola-bilmez",
    "eliyevin-zelenskiyə-təbrik-məktubu-və-hakimiyyətyonlu-mediada-ukraynaya-ittihamlar",
    "azerbaycan-israil-munasibetleri-azerbaycan-turkiye-munasibetlerine-nece-tesir-edir",
    "xeberin-basligi-bu-gun-baki-seherinde-bas-veren-hadise-haqqinda",
    "prezident-ilham-eliyev-zefer-gunu-munasibetile-xalqi-tebrik-etdi",
    "iqtisadiyyat-nazirliyi-yeni-qerar-qebul-etdi-ve-xeber-yayildi",
    "meclisde-yeni-qanun-layihesi-muzakire-edildi-deputatlar-danisdi",
    "futbol-yigma-komandamiz-novbeti-oyununda-qalib-gelmek-isteyir",
]


def page(slugs):
    return "<html><body>" + "".join(
        f'<a href="https://xural.com/{s}/">{s.replace("-", " ").capitalize()}</a>' for s in slugs
    ) + "</body></html>"


def test_page_full_of_root_slugs_is_a_news_list():
    items = extract_links_fallback("https://xural.com/", page(SLUGS), [])
    assert len(items) == len(SLUGS)


def test_a_few_root_slug_links_are_not_enough():
    assert extract_links_fallback("https://xural.com/", page(SLUGS[:3]), []) == []
