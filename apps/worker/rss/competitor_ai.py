"""Claude calls for the competitors page: headline tone and the daily summary.

Only headlines and counts are sent; nothing about the customer's account. Without
ANTHROPIC_API_KEY the worker skips both and the page shows counts only.
"""
import json
import os

AI_MODEL = "claude-haiku-5-5"
SENTIMENTS = ("positive", "neutral", "negative")
CLASSIFY_BATCH_SIZE = 40
TOPIC_MAX_CHARS = 60
SUMMARY_MAX_CHARS = 1200

CLASSIFY_SYSTEM = (
    "You label Azerbaijani, Russian and English news headlines for a media monitoring service. "
    "For each headline give its tone towards the organisation or person it is about: "
    "positive (success, growth, award, new product, praise), negative (fine, complaint, outage, "
    "scandal, loss, accident, criticism) or neutral (plain announcement, schedule, mention). "
    "Also give a short topic of 1-4 words in Azerbaijani (for example \"tarif\", \"şəbəkə nasazlığı\", "
    "\"sponsorluq\"). Judge only from the headline."
)

SUMMARY_SYSTEM = (
    "You write a short daily competitor brief in Azerbaijani for a company that monitors the news. "
    "You get mention counts and tone for the company's own keywords and for each competitor over the "
    "last 7 days, plus recent headlines. Write 3-5 plain sentences: who is mentioned most, whose "
    "coverage is most positive or negative, and the main topics behind it. Use only the numbers and "
    "headlines given; if there is too little data, say so in one sentence. No greetings, no headings, "
    "no lists, no advice you cannot back with the data."
)

CLASSIFY_SCHEMA = {
    "type": "object",
    "properties": {
        "results": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "n": {"type": "integer"},
                    "sentiment": {"type": "string", "enum": list(SENTIMENTS)},
                    "topic": {"type": "string"},
                },
                "required": ["n", "sentiment", "topic"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["results"],
    "additionalProperties": False,
}

SUMMARY_SCHEMA = {
    "type": "object",
    "properties": {"summary": {"type": "string"}},
    "required": ["summary"],
    "additionalProperties": False,
}


def make_client():
    """An Anthropic client, or None when no API key is configured."""
    if not os.getenv("ANTHROPIC_API_KEY", "").strip():
        return None
    import anthropic

    return anthropic.Anthropic(max_retries=2, timeout=60)


def _json_reply(client, system, user_text, schema, max_tokens):
    """One Messages call with a JSON-schema answer; None when Claude declined or was cut off."""
    response = client.messages.create(
        model=AI_MODEL,
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": user_text}],
        output_config={"effort": "low", "format": {"type": "json_schema", "schema": schema}},
    )
    if response.stop_reason in ("refusal", "max_tokens"):
        print(f"Competitor AI cavabı alınmadı: stop_reason={response.stop_reason}", flush=True)
        return None
    for block in response.content:
        if block.type == "text":
            return json.loads(block.text)
    return None


def classify_headlines(client, items):
    """items: [{"id", "title"}] -> {id: {"sentiment", "topic"}}.

    Headlines of a batch Claude answered but skipped get sentiment None, so they
    are not sent again; a batch that failed is left out and retried next run.
    """
    labels = {}
    for start in range(0, len(items), CLASSIFY_BATCH_SIZE):
        batch = items[start:start + CLASSIFY_BATCH_SIZE]
        lines = "\n".join(f"{index}. {str(item.get('title') or '').strip()[:300]}" for index, item in enumerate(batch, start=1))
        try:
            reply = _json_reply(
                client,
                CLASSIFY_SYSTEM,
                f"Label every numbered headline (n = its number):\n{lines}",
                CLASSIFY_SCHEMA,
                max_tokens=4000,
            )
        except Exception as exc:
            print(f"Competitor AI ton xətası: {type(exc).__name__}: {str(exc)[:200]}", flush=True)
            continue
        if reply is None:
            continue
        for item in batch:
            labels[item["id"]] = {"sentiment": None, "topic": None}
        for row in reply.get("results") or []:
            index = row.get("n")
            if not isinstance(index, int) or not 1 <= index <= len(batch):
                continue
            sentiment = row.get("sentiment")
            if sentiment not in SENTIMENTS:
                continue
            labels[batch[index - 1]["id"]] = {
                "sentiment": sentiment,
                "topic": str(row.get("topic") or "").strip()[:TOPIC_MAX_CHARS] or None,
            }
    return labels


def _stats_line(row):
    name = "Öz açar sözləriniz" if row.get("kind") == "own" else row.get("name") or "Rəqib"
    return (
        f"- {name}: {row.get('mentions', 0)} xəbər; müsbət {row.get('positive', 0)}, "
        f"neytral {row.get('neutral', 0)}, mənfi {row.get('negative', 0)}"
    )


def write_summary(client, stats, headlines):
    """stats: competitor_stats() rows; headlines: {entity name: [title, ...]}. Returns text or None."""
    parts = ["Son 7 gün:", *(_stats_line(row) for row in stats), "", "Son başlıqlar:"]
    for name, titles in headlines.items():
        if titles:
            parts.append(f"{name}:")
            parts.extend(f"  - {str(title).strip()[:200]}" for title in titles)
    try:
        reply = _json_reply(client, SUMMARY_SYSTEM, "\n".join(parts), SUMMARY_SCHEMA, max_tokens=3000)
    except Exception as exc:
        print(f"Competitor AI xülasə xətası: {type(exc).__name__}: {str(exc)[:200]}", flush=True)
        return None
    summary = str((reply or {}).get("summary") or "").strip()
    return summary[:SUMMARY_MAX_CHARS] or None
