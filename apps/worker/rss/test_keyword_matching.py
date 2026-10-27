import importlib.util
import os
import sys

import pytest


os.environ.setdefault("SUPABASE_URL", "")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "")

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

spec = importlib.util.spec_from_file_location("site_monitor_keywords", os.path.join(HERE, "site_monitor.py"))
site_monitor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(site_monitor)

match = site_monitor.keyword_matches_title


@pytest.mark.parametrize(
    "keyword, title",
    [
        ("BDU", "BDU-da yeni tədris ili başladı"),
        ("bdu", "Rektor BDU-nun tələbələri ilə görüşdü"),
        ("ADA", "ADA-ya qəbul nəticələri açıqlandı"),
        ("DİM", "DİM-də vacib xəbər"),
    ],
)
def test_suffix_after_hyphen(keyword, title):
    assert match(keyword, title)


@pytest.mark.parametrize(
    "keyword, title",
    [
        ("universitet", "Universitetin rektoru açıqlama verdi"),
        ("Azərişıq", "AZƏRİŞIQ yeni tariflər açıqladı"),
        ("azərişıq", "Azərişıq-dan xəbərdarlıq"),
        ("şagird", "Şagirdlər üçün yeni qaydalar"),
        ("təhsil", "Ümumtəhsil məktəblərində dərslər başladı"),
        ("İqtisadiyyat", "iqtisadiyyat nazirliyi"),
        ("ölkə", "ÖLKƏ ÜZRƏ HAVA KƏSKİN DƏYİŞƏCƏK"),
        ("mədəniyyət", "MƏDƏNİYYƏTİN inkişafı"),
        ("peşə təhsili", "Peşə təhsili alanların sayı artıb"),
    ],
)
def test_azerbaijani_letters(keyword, title):
    assert match(keyword, title)


@pytest.mark.parametrize(
    "keyword, title",
    [
        # short / strict keywords must not match inside longer words,
        # including when the neighbouring letter is Azerbaijani-specific
        ("BDU", "ABDUL Həmidov mükafat aldı"),
        ("ADA", "Adalət nazirliyi bəyanat yayıb"),
        ("elm", "Elmi şura toplandı"),
        ("miq", "Əmiqdarı artırıldı"),
        ("dim", "Ədimli kəndində yol təmiri"),
        ("ağa", "Ağacların əkilməsi davam edir"),
        ("peşə təhsili", "Peşə təhsilinin problemləri"),
        ("qız", "Qızıl medal qazandı"),
        ("ADA", "Adaşı ilə görüşdü"),
        ("mir", "Əmir bəy çıxış etdi"),
        ("BDU", "BDUçu tələbələr"),
    ],
)
def test_no_match_inside_longer_words(keyword, title):
    assert not match(keyword, title)


@pytest.mark.parametrize(
    "keyword, title",
    [
        ("bdu", "BDU elan etdi"),
        ("bdu", "Bdu elan etdi"),
        ("UNICEF", "Unicef nümayəndəsi Bakıda"),
        ("İLHAM", "ilham əliyev"),
        ("ilham", "İLHAM ƏLİYEV"),
        ("Bakı", "BAKI-da güclü külək"),
        ("ƏLİYEV", "əliyev"),
    ],
)
def test_case_insensitive(keyword, title):
    assert match(keyword, title)


def test_keyword_fold_handles_turkic_i():
    fold = site_monitor.keyword_fold
    assert fold("İ") == "i"
    assert fold("I") == "i"
    assert fold("ı") == "i"
    assert fold("i̇") == "i"
    assert fold("AZƏRİŞIQ") == fold("Azərişıq") == "azərişiq"


def test_empty_keyword_never_matches():
    assert not match("", "BDU-da")
    assert not match("   ", "BDU-da")


def test_keyword_match_helper_uses_same_rules():
    matched, keywords = site_monitor.keyword_match("BDU-da Universitetin günü", ["BDU", "universitet", "ADA"])
    assert matched
    assert keywords == ["universitet", "bdu"]


@pytest.mark.parametrize(
    "title",
    [
        "DİM-də vacib xəbər",
        "DİM-in qərarı",
        "DİM-ə müraciət etdilər",
        "DIM açıqladı",
        "BU GÜN DİM QƏBUL ELAN ETDİ",
    ],
)
def test_uppercase_acronym_keyword_matches_capitals_only(title):
    assert match("DİM", title)


@pytest.mark.parametrize(
    "title",
    [
        "Dim xəbəri",
        "dim elan etdi",
        "Mən bunu istədim",
        "Heç nə görmədim",
        "düşmədim",
        "DİMin qərarı",
    ],
)
def test_uppercase_acronym_keyword_ignores_lowercase_and_glued_words(title):
    assert not match("DİM", title)


def test_lowercase_keyword_stays_case_insensitive():
    assert match("dim", "DİM-də vacib xəbər")
    assert match("dim", "Dim xəbəri")
    assert not match("dim", "Mən bunu istədim")


def test_user_monitors_pass_original_case_to_the_matcher(monkeypatch):
    seen = []
    monkeypatch.setattr(site_monitor, "supabase_ready", lambda: True)
    monkeypatch.setattr(site_monitor, "keyword_is_active", lambda row: True)
    monkeypatch.setattr(site_monitor, "get_user_telegram_chat_id", lambda user_id: None)

    def matcher(keyword, title):
        seen.append((keyword, title))
        return False

    rows = [{"keyword": "DİM", "monitor_id": "m1", "user_monitors": {"user_id": "u1"}}]
    site_monitor.find_matching_user_monitors("DİM-də xəbər", rows, matcher=matcher)
    assert seen == [("DİM", "DİM-də xəbər")]
