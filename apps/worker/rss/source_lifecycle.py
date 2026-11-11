"""Source lifecycle: candidate -> trial (read-only shadow) -> active, or -> needs_review.

Pure logic (no network), so it is easy to test. site_monitor.py does the I/O.

A trial source is a row with status='inactive', discovery_status='accepted' and a
state tag in `notes`:  [trial passes=N fails=M since=ISO]
It is read by the bot but never sent to Telegram. After enough good passes it is
promoted to active; if it keeps failing or never qualifies it goes to needs_review.
"""
import os
import re
from datetime import datetime, timedelta, timezone

TRIAL_FAILED_RE = re.compile(r"\s*\[trial_failed (\S+) (\d{4}-\d{2}-\d{2} \d{2}:\d{2})\]")
RETRIAL_RE = re.compile(r"\s*\[retrial n=(\d+)\]")
BAKU_OFFSET = timezone(timedelta(hours=4))
TRIAL_TAG_RE = re.compile(r"\s*\[trial passes=(\d+) fails=(\d+) since=([^\]\s]+)\]")

TRIAL_ENABLED = os.getenv("TRIAL_ENABLED", "true").lower() != "false"
TRIAL_AUTO_PROMOTE = os.getenv("TRIAL_AUTO_PROMOTE", "true").lower() != "false"
TRIAL_INTERVAL_MINUTES = int(os.getenv("TRIAL_INTERVAL_MINUTES", "60"))
TRIAL_MAX_PER_RUN = int(os.getenv("TRIAL_MAX_PER_RUN", "15"))
TRIAL_MIN_PASSES = int(os.getenv("TRIAL_MIN_PASSES", "3"))
TRIAL_MIN_HOURS = float(os.getenv("TRIAL_MIN_HOURS", "6"))
TRIAL_MAX_HOURS = float(os.getenv("TRIAL_MAX_HOURS", "72"))
TRIAL_MAX_FAILS = int(os.getenv("TRIAL_MAX_FAILS", "6"))
TRIAL_SAMPLE_SIZE = int(os.getenv("TRIAL_SAMPLE_SIZE", "5"))
# A source that failed its trial is tried again later: the reader improves, sites get fixed.
RETRIAL_AFTER_HOURS = float(os.getenv("RETRIAL_AFTER_HOURS", "72"))
RETRIAL_MAX = int(os.getenv("RETRIAL_MAX", "2"))
RETRIAL_PER_RUN = int(os.getenv("RETRIAL_PER_RUN", "5"))


def now_utc():
    return datetime.now(timezone.utc)


def parse_trial(notes):
    match = TRIAL_TAG_RE.search(notes or "")
    if not match:
        return None
    try:
        since = datetime.fromisoformat(match.group(3))
        if since.tzinfo is None:
            since = since.replace(tzinfo=timezone.utc)
    except ValueError:
        return None
    return {"passes": int(match.group(1)), "fails": int(match.group(2)), "since": since}


def strip_trial_tag(notes):
    return TRIAL_TAG_RE.sub("", notes or "").strip()


def build_trial_notes(notes, passes, fails, since):
    tag = f"[trial passes={passes} fails={fails} since={since.isoformat()}]"
    return f"{strip_trial_tag(notes)} {tag}".strip()


def judge_sample(samples):
    """samples: list of {"title_ok": bool, "date_state": "ok"|"missing"|"future"}.

    A pass needs enough articles, clean titles, readable dates and no future dates.
    Returns (passed, reason).
    """
    n = len(samples)
    if n < 3:
        return False, f"too_few_articles:{n}"
    title_ok = sum(1 for s in samples if s.get("title_ok"))
    date_ok = sum(1 for s in samples if s.get("date_state") == "ok")
    future = sum(1 for s in samples if s.get("date_state") == "future")
    if future:
        return False, f"future_dates:{future}"
    if title_ok / n < 0.8:
        return False, f"bad_titles:{title_ok}/{n}"
    if date_ok / n < 0.6:
        return False, f"unreadable_dates:{date_ok}/{n}"
    return True, "ok"


def next_state(state, passed, now=None):
    """Return (action, new_state). action: 'continue' | 'promote' | 'review'."""
    now = now or now_utc()
    passes = state["passes"] + (1 if passed else 0)
    fails = state["fails"] + (0 if passed else 1)
    new_state = {"passes": passes, "fails": fails, "since": state["since"]}
    age_hours = (now - state["since"]).total_seconds() / 3600
    if passes >= TRIAL_MIN_PASSES and age_hours >= TRIAL_MIN_HOURS:
        return "promote", new_state
    if fails >= TRIAL_MAX_FAILS or age_hours >= TRIAL_MAX_HOURS:
        return "review", new_state
    return "continue", new_state


def retrial_count(notes):
    match = RETRIAL_RE.search(notes or "")
    return int(match.group(1)) if match else 0


def is_due_for_retrial(notes, now=None):
    """True when the notes say the trial failed long enough ago and the retrial budget is left."""
    now = now or now_utc()
    match = TRIAL_FAILED_RE.search(notes or "")
    if not match or retrial_count(notes) >= RETRIAL_MAX:
        return False
    try:
        failed_at = datetime.strptime(match.group(2), "%Y-%m-%d %H:%M").replace(tzinfo=BAKU_OFFSET)
    except ValueError:
        return False
    return (now - failed_at).total_seconds() >= RETRIAL_AFTER_HOURS * 3600


def build_retrial_notes(notes, now=None):
    """Drops the failure tag, counts the retrial and starts a fresh trial."""
    now = now or now_utc()
    count = retrial_count(notes) + 1
    base = RETRIAL_RE.sub("", TRIAL_FAILED_RE.sub("", strip_trial_tag(notes))).strip()
    tag = f"[trial passes=0 fails=0 since={now.isoformat()}]"
    return " ".join(part for part in (base, f"[retrial n={count}]", tag) if part)
