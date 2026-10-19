from datetime import datetime, timedelta, timezone

import source_lifecycle as lc

NOW = datetime(2026, 10, 19, 12, 0, tzinfo=timezone.utc)


def good(n=5):
    return [{"title_ok": True, "date_state": "ok"} for _ in range(n)]


def test_tag_roundtrip():
    since = NOW - timedelta(hours=2)
    notes = lc.build_trial_notes("rss ok", 1, 0, since)
    state = lc.parse_trial(notes)
    assert state == {"passes": 1, "fails": 0, "since": since}
    assert lc.strip_trial_tag(notes) == "rss ok"
    assert lc.parse_trial("no tag") is None


def test_judge_sample():
    assert lc.judge_sample(good())[0]
    assert not lc.judge_sample(good(2))[0]
    assert lc.judge_sample(good(4) + [{"title_ok": True, "date_state": "future"}])[1].startswith("future_dates")
    bad_titles = [{"title_ok": False, "date_state": "ok"}] * 3 + good(2)
    assert lc.judge_sample(bad_titles)[1].startswith("bad_titles")
    no_dates = [{"title_ok": True, "date_state": "missing"}] * 4 + good(1)
    assert lc.judge_sample(no_dates)[1].startswith("unreadable_dates")


def test_promotion_needs_passes_and_time():
    young = {"passes": 2, "fails": 0, "since": NOW - timedelta(hours=1)}
    assert lc.next_state(young, True, NOW)[0] == "continue"  # enough passes, too early
    old = {"passes": 2, "fails": 0, "since": NOW - timedelta(hours=7)}
    assert lc.next_state(old, True, NOW)[0] == "promote"
    assert lc.next_state(old, False, NOW)[0] == "continue"


def test_review_on_fails_or_timeout():
    failing = {"passes": 0, "fails": lc.TRIAL_MAX_FAILS - 1, "since": NOW - timedelta(hours=1)}
    assert lc.next_state(failing, False, NOW)[0] == "review"
    stale = {"passes": 1, "fails": 0, "since": NOW - timedelta(hours=lc.TRIAL_MAX_HOURS + 1)}
    assert lc.next_state(stale, True, NOW)[0] == "review"
