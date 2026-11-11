from datetime import datetime, timezone

import source_lifecycle as lc

NOW = datetime(2026, 11, 11, 12, 0, tzinfo=timezone.utc)
FAILED = "Sayt [trial_failed too_few_articles:0 2026-11-07 18:01]"


def test_failed_trial_is_retried_after_the_waiting_time():
    assert lc.is_due_for_retrial(FAILED, NOW)


def test_recent_failure_waits():
    assert not lc.is_due_for_retrial("[trial_failed too_few_articles:0 2026-11-11 10:00]", NOW)


def test_retrial_budget_is_limited():
    assert not lc.is_due_for_retrial(FAILED + " [retrial n=2]", NOW)
    assert lc.is_due_for_retrial(FAILED + " [retrial n=1]", NOW)


def test_sources_without_a_failed_trial_are_left_alone():
    assert not lc.is_due_for_retrial("[manual_add] note", NOW)
    assert not lc.is_due_for_retrial("", NOW)
    assert not lc.is_due_for_retrial(None, NOW)


def test_retrial_notes_restart_the_trial_and_keep_the_user_note():
    notes = lc.build_retrial_notes("[manual_add] əlavə etdim [trial_failed future_dates:2 2026-11-07 18:01]", NOW)
    assert "trial_failed" not in notes
    assert "[manual_add] əlavə etdim" in notes
    assert "[retrial n=1]" in notes
    state = lc.parse_trial(notes)
    assert state["passes"] == 0 and state["fails"] == 0
    assert lc.retrial_count(lc.build_retrial_notes(notes + " [trial_failed x 2026-11-09 10:00]", NOW)) == 2
