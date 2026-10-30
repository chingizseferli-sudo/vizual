import importlib.util
import os
import sys

import pytest

os.environ.setdefault("SUPABASE_URL", "")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "")

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

spec = importlib.util.spec_from_file_location("site_monitor_title_slug", os.path.join(HERE, "site_monitor.py"))
sm = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sm)


@pytest.mark.parametrize(
    "title, url",
    [
        ("“Kiçik Ermənistan üçün 3 min nəfər?” - Rusiyalı rəsmidən ABŞ səfirliyi ilə bağlı açıqlama",
         "https://tereqqi.az/dunya/47863-kiik-ermnistan-n-3-min-nfr-rusiyal-rsmidn-ab-sfirliyi-il-bal-aqlama.html"),
        ("Tayland fəalın həbs müddətini 34 ildən çox müddətə qədər uzadıb",
         "https://reportyor.az/karusel/57802-tayland-faln-hbs-muddtini-34-ildn-cox-muddt-qdr-uzadb.html"),
        ("\"Binəqədi-38\" MMMC-də keçirilən seçkilər barədə...",
         "https://avrasiya.net/sosial/97964-binqdi-38-mmmc-d-keiriln-sekilr-bard.html"),
        ("Bakıda gənc qəzada həlak oldu", "https://sayt.az/xeber/bakida-genc-qezada-helak-oldu"),
    ],
)
def test_slug_with_deleted_azerbaijani_letters_matches_its_title(title, url):
    assert sm.title_matches_url_slug(title, url)


def test_unrelated_title_still_mismatches_the_slug():
    assert not sm.title_matches_url_slug(
        "Prezident yeni qanuna imza atdı və açıqlama verdi",
        "https://tereqqi.az/dunya/47863-kiik-ermnistan-n-3-min-nfr-rusiyal-rsmidn-ab-sfirliyi-il-bal-aqlama.html",
    )


def candidate(method, text="Sabunçuda İNTİHAR"):
    return (method, text, text)


def test_title_the_page_agrees_on_is_accepted_despite_an_old_slug():
    agreed = sm.slug_consensus_title([
        candidate("meta_title"), candidate("og_title"), candidate("selector:main h2"),
    ])
    assert agreed and agreed[1] == "Sabunçuda İNTİHAR"


@pytest.mark.parametrize(
    "methods",
    [
        ["og_title", "twitter_title"],                       # metadata only: could be a site-wide title
        ["selector:main h2"],                                 # one source only
        ["og_title", "selector:h1"],                          # unscoped h1 can be the site logo
    ],
)
def test_without_page_agreement_the_slug_mismatch_stands(methods):
    assert sm.slug_consensus_title([candidate(m) for m in methods]) is None


def test_different_titles_do_not_form_agreement():
    assert sm.slug_consensus_title([candidate("og_title", "Bir başlıq"), candidate("selector:main h1", "Başqa başlıq")]) is None


FEED_TITLE = "Bakıda ağır qəzada ölən gəncin fotoları"
OLD_SLUG_URL = "https://oxu.az/hadise/bakida-avtomobil-yuk-masinina-cirpildi-surucu-oldu"


@pytest.fixture
def page_refuses(monkeypatch):
    monkeypatch.setattr(
        sm, "fetch_article_title_info",
        lambda url, source_domain=None: {"title": "", "method": "http_error", "raw_title": "", "reject_reason": "http_403"},
    )


def test_feed_headline_survives_an_old_slug_and_a_403_page(page_refuses):
    info = sm.choose_best_article_title_info(FEED_TITLE, OLD_SLUG_URL, source_domain="oxu.az", from_feed=True)
    assert info["title"] == FEED_TITLE
    assert info["method"] == "feed_title"


def test_title_not_from_a_feed_is_still_checked_against_the_slug(page_refuses):
    info = sm.choose_best_article_title_info(FEED_TITLE, OLD_SLUG_URL, source_domain="oxu.az", from_feed=False)
    assert info["title"] == ""


def test_feed_title_that_is_just_the_site_name_is_still_rejected(page_refuses):
    info = sm.choose_best_article_title_info("oxu.az", OLD_SLUG_URL, source_domain="oxu.az", from_feed=True)
    assert info["title"] == ""
