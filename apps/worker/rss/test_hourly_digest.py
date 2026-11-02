import os
import sys
from datetime import datetime
from unittest import mock

os.environ.setdefault("SUPABASE_URL", "")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "")
HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import hourly_digest as hd  # noqa: E402

BAKU = hd.sm.BAKU_TZ


def match(monitor, keyword, url="https://a.az/x.html", title="Başlıq <b>"):
    return {
        "monitor_id": monitor,
        "matched_keyword": keyword,
        "created_at": "2026-11-02T10:10:00+00:00",
        "monitored_items": {"title": title, "url": url, "published_at": "2026-11-02T10:05:00+00:00", "detected_at": None},
    }


def test_window_is_previous_full_hour():
    start, end = hd.window_for(datetime(2026, 11, 2, 15, 0, 3, tzinfo=BAKU))
    assert (start.hour, end.hour) == (14, 15)
    assert start.minute == end.minute == 0


def test_rows_merge_keywords_and_scope_to_chat_monitors():
    rows = hd.build_rows(
        [match("m1", "neft"), match("m1", "qaz"), match("m2", "başqa", url="https://b.az/y.html")],
        {"m1"},
    )
    assert len(rows) == 1
    assert rows[0]["keywords"] == ["neft", "qaz"]
    assert rows[0]["source"] == "a.az"


def test_html_escapes_and_embeds_logo():
    rows = hd.build_rows([match("m1", "neft")], {"m1"})
    start, end = hd.window_for(datetime(2026, 11, 2, 15, 0, tzinfo=BAKU))
    out = hd.render_html(rows, start, end, "02.11.2026 15:00")
    assert "Başlıq &lt;b&gt;" in out
    assert "data:image/svg+xml" in out and "Vizual.Az" in out


def test_run_sends_only_to_chats_with_matches():
    sent = []
    with mock.patch.object(hd.sm, "supabase_ready", return_value=True), \
         mock.patch.object(hd.sm, "notifications_paused", return_value=False), \
         mock.patch.object(hd, "load_recipients", return_value={"1": {"m1"}, "2": {"m2"}}), \
         mock.patch.object(hd, "load_window_matches", return_value=[match("m1", "neft")]), \
         mock.patch.object(hd, "send_documents", side_effect=lambda chat, files, cap: sent.append((chat, [f[0] for f in files])) or True):
        assert hd.run(datetime(2026, 11, 2, 15, 0, tzinfo=BAKU)) == 0
    assert sent == [("1", ["vizual-2026-11-02-1400-1500.html", "vizual-2026-11-02-1400-1500.pdf", "vizual-2026-11-02-1400-1500.csv"])]


def test_paused_sends_nothing():
    with mock.patch.object(hd.sm, "supabase_ready", return_value=True), \
         mock.patch.object(hd.sm, "notifications_paused", return_value=True), \
         mock.patch.object(hd, "send_documents") as send:
        assert hd.run(datetime(2026, 11, 2, 15, 0, tzinfo=BAKU)) == 0
    send.assert_not_called()


def test_caption_is_three_lines():
    start, end = hd.window_for(datetime(2026, 11, 2, 15, 0, tzinfo=BAKU))
    caption = hd.build_caption(hd.build_rows([match("m1", "neft")], {"m1"}), start, end)
    assert caption.splitlines() == [
        "📰 <b>Vizual.Az · Saatlıq hesabat</b>",
        "🕐 02.11.2026 14:00 – 15:00",
        "📌 1 xəbər",
    ]


def test_csv_and_pdf_are_valid():
    rows = hd.build_rows([match("m1", "neft"), match("m1", "qaz")], {"m1"})
    start, end = hd.window_for(datetime(2026, 11, 2, 15, 0, tzinfo=BAKU))
    data = hd.build_csv(rows)
    assert data.startswith("\ufeff".encode("utf-8"))
    assert "neft, qaz" in data.decode("utf-8") and "Mənbə" in data.decode("utf-8")
    pdf = hd.build_pdf(rows, start, end, "02.11.2026 15:00")
    assert pdf.startswith(b"%PDF") and len(pdf) > 1000
