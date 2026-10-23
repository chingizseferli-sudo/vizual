"""Is a social post about Azerbaijan? ("Yalnız Azərbaycan", per keyword.)

International keywords ("mygov", "asan") also match posts from India or
Turkey. A keyword with az_only keeps a post only when the post shows an
Azerbaijani signal; exclude_words drop a post whatever the language.

Signals, all cheap and dependency-free:
- the letter ə (only Azerbaijani among large languages writes it);
- Azerbaijani-only words (üçün, haqqında, bildirib...) and words that mix
  Turkish letters with q or x, which Turkish does not use ("qızıl", "xüsusi");
- Turkic letters (ı, ş, ğ, ç, ö, ü) in a text with no Turkish-only word
  (için, değil, ve, ile...): short Azerbaijani posts often have no ə
  ("Kapital Bank'ın yeni kartı");
- Azerbaijan context in any script: Azərbaycan, Azerbaijan, Азербайджан,
  Bakı, Баку, Gəncə, Sumqayıt, the 🇦🇿 flag, a .az link;
- the same context in the author's name or location.

Russian and English posts about Azerbaijan pass through the context words;
a Russian or English post with no Azerbaijan context is dropped.
"""

import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "rss"))

import site_monitor as sm  # noqa: E402

# Folded with keyword_fold (ı/I/İ -> i), so "Bakı" and "BAKI" are both "baki".
AZ_CONTEXT_WORDS = (
    "azərbaycan", "azerbaycan", "azerbaijan", "azerbaidjan", "azerbaïdjan", "aserbaidschan",
    "azeri", "азербайджан", "азербайджанск", "азери",
    "bakı", "baku", "баку", "bakü",
    "gəncə", "gence", "ganja", "гянджа", "sumqayıt", "sumgait", "сумгаит", "сумгайыт",
    "naxçıvan", "nakhchivan", "нахчыван", "нахичеван", "şuşa", "shusha", "шуша",
    "lənkəran", "lankaran", "mingəçevir", "qarabağ", "karabakh", "карабах",
    "milli məclis", "asan xidmət", "asan xidmet",
)
# Written only in Azerbaijani (Turkish: için, hakkında, bildirdi, dedi).
AZ_ONLY_WORDS = (
    "üçün", "haqqında", "bildirib", "deyib", "qeyd edib", "olunub", "edilib", "keçirilib",
    "ilə", "artıq", "xəbər", "rəsmi", "nazirliyi", "prezident ilham",
)
# Written only in Turkish (Azerbaijani: üçün, deyil, və, ilə, olaraq, çox, yox, kimi).
TURKISH_ONLY_WORDS = ("için", "değil", "ve", "ile", "olarak", "çok", "yok", "gibi", "hakkında", "türkiye")
AZ_FLAG = "\U0001F1E6\U0001F1FF"

_CONTEXT_FOLDED = tuple(sm.keyword_fold(word) for word in AZ_CONTEXT_WORDS)
_ONLY_FOLDED = tuple(sm.keyword_fold(word) for word in AZ_ONLY_WORDS)
_TURKISH_FOLDED = tuple(sm.keyword_fold(word) for word in TURKISH_ONLY_WORDS)
# A .az domain in a link or plain text: mygov.az, https://e-gov.az/...
AZ_DOMAIN = re.compile(r"(?<![\w-])(?:[a-z0-9-]+\.)+az(?![\w.-]*[a-z0-9])", re.IGNORECASE)
# Turkish letters plus q or x in one word: Azerbaijani, not Turkish.
_TURKIC = "ışğçöü"
AZ_QX_WORD = re.compile(rf"\b(?=\w*[qx])(?=\w*[{_TURKIC}])\w+\b")
TURKIC_LETTER = re.compile(rf"[{_TURKIC}]")


def _word_hit(folded_text, folded_words, whole=False):
    end = r"(?!\w)" if whole else ""
    for word in folded_words:
        if re.search(rf"(?<!\w){re.escape(word)}{end}", folded_text):
            return True
    return False


def az_context(text):
    """Azerbaijan named or linked in the text (any language)."""
    raw = str(text or "")
    if AZ_FLAG in raw or AZ_DOMAIN.search(raw):
        return True
    return _word_hit(sm.keyword_fold(raw), _CONTEXT_FOLDED)


def az_language(text):
    """The text is written in Azerbaijani."""
    raw = str(text or "")
    if "ə" in raw or "Ə" in raw:
        return True
    # Plain lower(): an English capital I must not turn into ı.
    lowered = raw.lower()
    if AZ_QX_WORD.search(lowered):
        return True
    folded = sm.keyword_fold(raw)
    if _word_hit(folded, _ONLY_FOLDED):
        return True
    return bool(TURKIC_LETTER.search(lowered)) and not _word_hit(folded, _TURKISH_FOLDED, whole=True)


def post_is_azerbaijani(post):
    """Any Azerbaijani signal in the post text, its links or its author."""
    text = " ".join(
        str(part or "")
        for part in (post.get("text"), post.get("author"), " ".join(post.get("links") or []))
    )
    if az_language(text) or az_context(text):
        return True
    location = post.get("author_location")
    return bool(location) and az_context(location)


def clean_exclude_words(value):
    if not isinstance(value, (list, tuple)):
        return []
    return [word for word in (sm.clean_text(item) for item in value) if word]


def excluded_by(post, words, matches):
    """The first exclude word found in the post (matched like keywords), else None."""
    text = " ".join(str(part or "") for part in (post.get("text"), " ".join(post.get("links") or [])))
    for word in clean_exclude_words(words):
        if matches(word, text):
            return word
    return None


def keyword_row_allows(row, post, is_az, matches):
    """None when the customer's keyword row accepts the post, else the reason:
    "excluded" (an exclude word) or "not_az" (az_only and no Azerbaijani signal)."""
    if excluded_by(post, row.get("exclude_words"), matches):
        return "excluded"
    # Rows written before the column existed have no key: treat them as az_only.
    if row.get("az_only", True) and not is_az:
        return "not_az"
    return None
