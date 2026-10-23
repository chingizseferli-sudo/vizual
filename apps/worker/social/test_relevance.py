import pytest

import relevance as rel
from collector import social_keyword_matches


@pytest.mark.parametrize("text", [
    "Mygov portalında yeni xidmət",                      # ə
    "Check mygov.az for the new e-service",              # .az link
    "Kapital Bank'ın yeni kartı",                        # Turkic letters, no Turkish word
    "Портал mygov теперь доступен в Баку",               # Russian, Baku
    "Новый сервис mygov в Азербайджане",                 # Russian, Azerbaijan
    "MyGov app now live in Azerbaijan",                  # English, Azerbaijan
    "Qızıl qiymətləri",                                  # q + Turkic letters
    "mygov 🇦🇿",                                         # flag
    "MYGOV BAKI",                                        # upper-case Bakı
])
def test_azerbaijani_posts_are_recognised(text):
    assert rel.post_is_azerbaijani({"text": text})


@pytest.mark.parametrize("text", [
    "MyGov India launches new citizen portal with Aadhaar login",
    "मायगव पोर्टल पर नया अपडेट",
    "Новый портал mygov запущен в Дели",
    "Türkiye için yeni mygov uygulaması çok iyi",          # Turkish
    "mygov.in update",
    "Download from azure.com today",                      # .az inside another domain
])
def test_foreign_posts_are_not_azerbaijani(text):
    assert not rel.post_is_azerbaijani({"text": text})


def test_author_location_and_links_count():
    assert rel.post_is_azerbaijani({"text": "mygov update", "author_location": "Baku, Azerbaijan"})
    assert rel.post_is_azerbaijani({"text": "mygov update", "links": ["https://e-gov.az/x"]})
    assert not rel.post_is_azerbaijani({"text": "mygov update", "author_location": "New Delhi"})


def row(az_only=True, exclude=()):
    return {"keyword": "mygov", "az_only": az_only, "exclude_words": list(exclude)}


def allows(row_value, text):
    post = {"text": text}
    return rel.keyword_row_allows(row_value, post, rel.post_is_azerbaijani(post), social_keyword_matches)


def test_keyword_row_filters():
    india = "MyGov India launches new citizen portal"
    assert allows(row(), india) == "not_az"
    assert allows(row(az_only=False), india) is None
    assert allows(row(), "Mygov portalında yeni xidmət") is None
    assert allows(row(), "Портал mygov в Баку") is None
    # Exclude words drop a post whatever the language, with suffixes and hashtags.
    assert allows(row(az_only=False, exclude=["India"]), india) == "excluded"
    assert allows(row(exclude=["india"]), "Mygov #India əməkdaşlığı") == "excluded"
    assert allows(row(exclude=["Modi"]), "Mygov portalında yeni xidmət") is None
    # Rows from before the migration have no keys: az_only, no exclusions.
    assert allows({"keyword": "mygov"}, india) == "not_az"
