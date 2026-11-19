"""OpenAI calls for the competitors page: headline tone and the daily summary.

Only headlines and counts are sent; nothing about the customer's account. Without
OPENAI_API_KEY the worker skips both and the page shows counts only.
"""
import json
import os

import requests

AI_MODEL = os.getenv("OPENAI_MODEL", "").strip() or "gpt-5-nano"
OPENAI_URL = "https://api.openai.com/v1/chat/completions"
REQUEST_TIMEOUT = 90
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


# Set when OpenAI answers insufficient_quota (no credit left); the rss worker
# stores it (runtime state ai_credit_low) so the social worker can alert admins.
CREDIT_LOW = {"seen": False}


def note_api_error(exc):
    if "insufficient_quota" in str(exc).lower():
        CREDIT_LOW["seen"] = True


class OpenAIError(RuntimeError):
    pass


class OpenAIClient:
    """Chat Completions over plain HTTP; one retry on 429 rate limits and 5xx."""

    def __init__(self, api_key, model=AI_MODEL, http=requests):
        self.api_key = api_key
        self.model = model
        self.http = http

    def chat(self, body):
        for attempt in range(2):
            response = self.http.post(
                OPENAI_URL,
                headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
                json={"model": self.model, **body},
                timeout=REQUEST_TIMEOUT,
            )
            if response.status_code == 200:
                return response.json()
            error = _error_text(response)
            retryable = response.status_code >= 500 or (response.status_code == 429 and "insufficient_quota" not in error)
            if not retryable or attempt == 1:
                raise OpenAIError(f"HTTP {response.status_code}: {error}")
        raise OpenAIError("unreachable")


def _error_text(response):
    try:
        error = (response.json() or {}).get("error") or {}
        return f"{error.get('code') or error.get('type') or ''} {error.get('message') or ''}".strip()[:300]
    except ValueError:
        return str(response.text or "")[:300]


def make_client():
    """An OpenAI client, or None when no API key is configured."""
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    return OpenAIClient(api_key) if api_key else None


def _json_reply(client, system, user_text, schema, max_tokens):
    """One call with a JSON-schema answer; None when the model declined or was cut off."""
    reply = client.chat({
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user_text}],
        "response_format": {"type": "json_schema", "json_schema": {"name": "answer", "strict": True, "schema": schema}},
        "max_completion_tokens": max_tokens,
        # gpt-5 nano/mini think before answering; labels need no reasoning.
        **({"reasoning_effort": "minimal"} if client.model.startswith("gpt-5") else {}),
    })
    choice = (reply.get("choices") or [{}])[0]
    message = choice.get("message") or {}
    if message.get("refusal") or choice.get("finish_reason") != "stop" or not message.get("content"):
        print(f"Competitor AI cavabı alınmadı: finish_reason={choice.get('finish_reason')}", flush=True)
        return None
    return json.loads(message["content"])


def classify_headlines(client, items):
    """items: [{"id", "title"}] -> {id: {"sentiment", "topic"}}.

    Headlines of a batch the model answered but skipped get sentiment None, so they
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
            note_api_error(exc)
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
        note_api_error(exc)
        print(f"Competitor AI xülasə xətası: {type(exc).__name__}: {str(exc)[:200]}", flush=True)
        return None
    summary = str((reply or {}).get("summary") or "").strip()
    return summary[:SUMMARY_MAX_CHARS] or None
