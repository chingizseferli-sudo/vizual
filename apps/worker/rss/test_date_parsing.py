import importlib.util
import os
import sys
import types
from datetime import datetime, timedelta


os.environ.setdefault("SUPABASE_URL", "")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "")



if "requests" not in sys.modules:
    requests = types.ModuleType("requests")

    class _RequestException(Exception):
        pass

    class _Timeout(_RequestException):
        pass

    class _SSLError(_RequestException):
        pass

    class _ConnectionError(_RequestException):
        pass

    requests.Timeout = _Timeout
    requests.exceptions = types.SimpleNamespace(
        SSLError=_SSLError,
        ConnectionError=_ConnectionError,
        RequestException=_RequestException,
    )
    requests.get = lambda *_args, **_kwargs: None
    requests.post = lambda *_args, **_kwargs: None
    requests.patch = lambda *_args, **_kwargs: None
    sys.modules["requests"] = requests

if "feedparser" not in sys.modules:
    feedparser = types.ModuleType("feedparser")
    feedparser.parse = lambda *_args, **_kwargs: types.SimpleNamespace(entries=[], bozo=False)
    sys.modules["feedparser"] = feedparser


if "bs4" not in sys.modules:
    bs4 = types.ModuleType("bs4")

    class _BeautifulSoup:
        def __init__(self, *_args, **_kwargs):
            pass

        def find(self, *_args, **_kwargs):
            return None

        def find_all(self, *_args, **_kwargs):
            return []

        def select(self, *_args, **_kwargs):
            return []

    bs4.BeautifulSoup = _BeautifulSoup
    sys.modules["bs4"] = bs4


spec = importlib.util.spec_from_file_location("site_monitor", "site_monitor.py")
site_monitor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(site_monitor)


def assert_status(label, title, article_time, expected):
    published_time, status = site_monitor.evaluate_publish_freshness(title, article_time)
    assert status == expected, f"{label}: expected {expected}, got {status}, published={published_time}"
    return published_time


def assert_status_with_context(label, title, article_time, expected, **context):
    published_time, status = site_monitor.evaluate_publish_freshness(title, article_time, **context)
    assert status == expected, f"{label}: expected {expected}, got {status}, published={published_time}"
    return published_time


def main():
    now = datetime.now(site_monitor.BAKU_TZ)
    fresh = now - timedelta(minutes=10)
    old = now - timedelta(days=14)
    yesterday = now - timedelta(days=1)
    future = now + timedelta(days=1)
    month_names = {
        1: ("Yanvar", "Yan"),
        2: ("Fevral", "Fev"),
        3: ("Mart", "Mar"),
        4: ("Aprel", "Apr"),
        5: ("May", "May"),
        6: ("İyun", "İyn"),
        7: ("İyul", "İyl"),
        8: ("Avqust", "Avq"),
        9: ("Sentyabr", "Sen"),
        10: ("Oktyabr", "Okt"),
        11: ("Noyabr", "Noy"),
        12: ("Dekabr", "Dek"),
    }
    fresh_month, fresh_short_month = month_names[fresh.month]
    possessive = {
        1: "Yanvarın", 2: "Fevralın", 3: "Martın", 4: "Aprelin", 5: "Mayın", 6: "İyunun",
        7: "İyulun", 8: "Avqustun", 9: "Sentyabrın", 10: "Oktyabrın", 11: "Noyabrın", 12: "Dekabrın",
    }

    fixtures = [
        ("RSS ISO fresh", "", fresh.isoformat(), "fresh"),
        ("RSS RFC fresh", "", fresh.strftime("%a, %d %b %Y %H:%M:%S +0400"), "fresh"),
        ("Azerbaijani month fresh", f"DIM xəbəri {fresh.day} {fresh_month} {fresh.year} {fresh.hour:02d}:{fresh.minute:02d}", "", "fresh"),
        ("DIM numeric fresh", f"{fresh.day:02d}.{fresh.month:02d}.{fresh.year} {fresh.hour:02d}:{fresh.minute:02d}", "", "fresh"),
        ("EDU old", "EDU elan", old.strftime("%d.%m.%Y %H:%M"), "old_news"),
        ("APA future", "APA xəbər", future.strftime("%d.%m.%Y %H:%M"), "future_date"),
        ("Report missing", "Report başlıq", "", "no_date"),
        ("Azertac failed date", "Azertac 32 İyun 2026 xəbər", "", "date_parse_failed"),
        ("University short month", f"Universitet xəbəri {fresh_short_month} {fresh.day}, {fresh.year} | {fresh.hour:02d}:{fresh.minute:02d}", "", "fresh"),
        ("Time-only relative same day", f"{fresh.hour:02d}:{fresh.minute:02d} Tələbə qəbulu ilə bağlı yenilik", "", "fresh"),
        ("Today date-only is fresh", "", now.strftime("%d.%m.%Y"), "fresh"),
        ("Yesterday date-only is old", "", yesterday.strftime("%d.%m.%Y"), "old_news"),
        ("Numeric comma fresh", "", fresh.strftime("%d.%m.%Y, %H:%M"), "fresh"),
        ("Numeric short-year fresh", "", fresh.strftime("%d-%m-%y %H:%M"), "fresh"),
        ("Year-first date-only fresh", "", now.strftime("%Y-%m-%d"), "fresh"),
        ("Relative today word fresh", "", f"Bug\u00fcn {fresh.hour:02d}:{fresh.minute:02d}", "fresh"),
        ("Relative yesterday word old", "", f"D\u00fcn\u0259n {fresh.hour:02d}:{fresh.minute:02d}", "old_news"),
        ("Relative minutes fresh", "", "15 d\u0259qiq\u0259 \u0259vv\u0259l", "fresh"),
        ("Relative hours old", "", "2 saat \u0259vv\u0259l", "old_news"),
        ("Relative days old", "", "2 g\u00fcn \u0259vv\u0259l", "old_news"),
        ("Month possessive fresh", f"{possessive[fresh.month]} {fresh.day}-d\u0259 saat {fresh.hour:02d}:{fresh.minute:02d}", "", "fresh"),
        ("Numeric seconds old", "", "08.04.2026", "old_news"),
        ("Russian month old", "", "03 \u0438\u044e\u043b\u044f 2026 | 20:11", "old_news"),
        ("English month old", "", "27 Jun, 2026", "old_news"),
        ("Time first Azerbaijani fresh", f"{fresh.hour:02d}:{fresh.minute:02d} - {fresh.day} {fresh_month} {fresh.year}", "", "fresh"),
    ]

    for label, title, article_time, expected in fixtures:
        assert_status(label, title, article_time, expected)

    assert_status_with_context(
        "Fresh RSS beats stale article date",
        "Vacib xəbər",
        old.strftime("%d.%m.%Y %H:%M"),
        "fresh",
        rss_time=fresh.isoformat(),
        source_context="rss",
        item_position=0,
    )
    assert_status_with_context(
        "Fresh listing beats missing article date",
        "Son xəbər",
        "",
        "fresh",
        listing_time=fresh.strftime("%d.%m.%Y %H:%M"),
        source_context="latest_page",
        item_position=0,
    )
    assert_status_with_context(
        "Trusted top listing without date is not fresh without proof",
        "Tarixsiz son xəbər",
        "",
        "no_date",
        source_context="latest_page",
        item_position=2,
    )
    assert_status_with_context(
        "Deep sitemap without date is not fresh",
        "Tarixsiz sitemap xəbəri",
        "",
        "no_date",
        source_context="sitemap",
        item_position=20,
    )

    assert site_monitor.parse_datetime_to_baku("Sun, 11 Aug 2024 20:00:00 GMT")
    assert site_monitor.parse_datetime_to_baku("12 İyun 2026, 17:41")
    assert site_monitor.parse_datetime_to_baku("2026-06-11T15:50:00+04:00")
    assert site_monitor.parse_datetime_to_baku("03/07/2026 18:00")
    assert site_monitor.parse_datetime_to_baku("03.07.2026, 18:00")
    assert site_monitor.parse_datetime_to_baku("Bug\u00fcn 12:30")
    assert site_monitor.parse_datetime_to_baku("15 d\u0259qiq\u0259 \u0259vv\u0259l")
    assert site_monitor.parse_datetime_to_baku("03 \u0438\u044e\u043b\u044f 2026 | 20:11")
    assert site_monitor.extract_listing_publish_time_from_text("Başlıq 03/07/2026 18:00") == "03/07/2026 18:00"
    html, source = site_monitor.extract_publish_time_from_html_with_source(
        '<html><head><meta property="article:published_time" content="2026-07-05T12:50:14+04:00"></head></html>'
    )
    assert html == "2026-07-05T12:50:14+04:00"
    assert source
    assert site_monitor.clean_title_for_message("03/07/2026 18:00 Firudin Qurbanov konfransda iştirak edib") == "Firudin Qurbanov konfransda iştirak edib"
    assert site_monitor.clean_title_for_message("Firudin Qurbanov konfransda iştirak edib 03/07/2026 18:00") == "Firudin Qurbanov konfransda iştirak edib"
    assert site_monitor.clean_title_for_message("3 iyul, 2026 [19:44] Qəbul prosesi ilə bağlı xəbər") == "Qəbul prosesi ilə bağlı xəbər"
    assert site_monitor.clean_title_for_message("15:17 - 5 İyul 2026 DİM-də vacib xəbər") == "DİM-də vacib xəbər"
    assert site_monitor.clean_title_for_message("DİM-də vacib xəbər 15:17 - 5 İyul 2026") == "DİM-də vacib xəbər"
    assert site_monitor.clean_title_for_message('Yayda istirahətə gedib peşman olacaqsınız <span class="red_color">YERLƏR</span>') == "Yayda istirahətə gedib peşman olacaqsınız YERLƏR"
    assert site_monitor.clean_title_for_message('Atası ilə birgə ölən Fidanla Tunar dünən imtahan verməli imiş - <span style="color: #ff0000;">FOTO</span>') == "Atası ilə birgə ölən Fidanla Tunar dünən imtahan verməli imiş"
    assert site_monitor.clean_title_for_message("SOSİAL 09:56 Atası ilə birgə ölən Fidanla Tunar dünən imtahan verməli imiş") == "Atası ilə birgə ölən Fidanla Tunar dünən imtahan verməli imiş"
    assert site_monitor.clean_title_for_message("“Rəqəmsal elm dövrü: Qlobal reytinqlər” adlı elmi seminar keçirildi 06.07.2026 / 10:53 Ətraflı") == "“Rəqəmsal elm dövrü: Qlobal reytinqlər” adlı elmi seminar keçirildi"

    print("date fixtures ok")


if __name__ == "__main__":
    main()
