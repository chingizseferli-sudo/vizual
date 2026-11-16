"""One-time Claude suggestions of other spellings for customer keywords.

A keyword is usually Azerbaijani; the same name in English or Russian news is written
differently ("Azərbaycan Hava Yolları" / "Azerbaijan Airlines" / "Азербайджанские
авиалинии"). Claude is asked once per keyword, never per article; the customer picks
which suggestions to keep. Only the keyword text is sent.
"""
from competitor_ai import _json_reply, note_api_error

BATCH_SIZE = 20
MAX_VARIANTS = 4

SYSTEM = (
    "You help an Azerbaijani media monitoring service find news in English and Russian. "
    "For each numbered keyword (usually Azerbaijani: a company, person, institution, place, "
    "product or event) give the forms news sites use for exactly the same thing: the English "
    "name, the Russian name in Cyrillic, and a well-known abbreviation if there is one. "
    "Rules: only names of the same entity, never related or broader terms; skip a form that is "
    "identical to the keyword; give an empty list for a common word or generic topic whose "
    "translation would mostly match unrelated news (for example \"təhsil\", \"qiymət\"); "
    f"at most {MAX_VARIANTS} forms per keyword; no explanations."
)

SCHEMA = {
    "type": "object",
    "properties": {
        "results": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "n": {"type": "integer"},
                    "variants": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["n", "variants"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["results"],
    "additionalProperties": False,
}


def clean_variants(keyword, variants):
    """Trimmed, 2-100 characters, unique (case-insensitive), not the keyword, at most MAX_VARIANTS."""
    seen = {" ".join(str(keyword or "").split()).casefold()}
    kept = []
    for variant in variants or []:
        text = " ".join(str(variant or "").split())
        key = text.casefold()
        if not 2 <= len(text) <= 100 or key in seen:
            continue
        seen.add(key)
        kept.append(text)
        if len(kept) == MAX_VARIANTS:
            break
    return kept


def suggest_variants(client, keywords):
    """keywords: [str] -> {keyword: [variant, ...]} for every keyword of each batch Claude answered.

    A batch that failed is left out, so its keywords are asked again later."""
    suggestions = {}
    for start in range(0, len(keywords), BATCH_SIZE):
        batch = keywords[start:start + BATCH_SIZE]
        lines = "\n".join(f"{index}. {str(keyword).strip()[:200]}" for index, keyword in enumerate(batch, start=1))
        try:
            reply = _json_reply(client, SYSTEM, f"Keywords (n = its number):\n{lines}", SCHEMA, max_tokens=3000)
        except Exception as exc:
            note_api_error(exc)
            print(f"Açar söz variantları AI xətası: {type(exc).__name__}: {str(exc)[:200]}", flush=True)
            continue
        if reply is None:
            continue
        for keyword in batch:
            suggestions[keyword] = []
        for row in reply.get("results") or []:
            index = row.get("n")
            if isinstance(index, int) and 1 <= index <= len(batch):
                keyword = batch[index - 1]
                suggestions[keyword] = clean_variants(keyword, row.get("variants"))
    return suggestions
