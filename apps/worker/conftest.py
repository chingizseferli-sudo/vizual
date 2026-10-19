import os
import sys

import pytest

# Legacy rss fixtures install stub requests/bs4/feedparser modules when the real
# ones are not imported yet; load the real libraries first so one pytest process
# can run rss and page_change tests side by side.
import bs4  # noqa: F401,E402
import feedparser  # noqa: F401,E402
import requests  # noqa: F401,E402

WORKER_ROOT = os.path.dirname(os.path.abspath(__file__))
for _sub in ("rss", "page_change"):
    _path = os.path.join(WORKER_ROOT, _sub)
    if _path not in sys.path:
        sys.path.insert(0, _path)


@pytest.hookimpl(tryfirst=True)
def pytest_collectstart(collector):
    # Legacy fixtures load "site_monitor.py" relative to the working directory.
    if isinstance(collector, pytest.Module):
        os.chdir(os.path.dirname(str(collector.path)))
