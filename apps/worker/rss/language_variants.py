"""Find the other-language editions of a news site (1news.az/az/, /en/ ...)."""
import re
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup

LANGUAGES = ("az", "en", "ru", "tr")
LANG_PATH_RE = re.compile(r"^/(%s)/?$" % "|".join(LANGUAGES))
HREFLANG_RE = re.compile(r"^(%s)(?:[-_][a-z]{2})?$" % "|".join(LANGUAGES))


def _host(url):
    host = (urlparse(url).hostname or "").lower()
    return host[4:] if host.startswith("www.") else host


def _same_site(host, page_host):
    return host == page_host or host.endswith("." + page_host) or page_host.endswith("." + host)


def find_language_variants(page_url, page_html, limit=3):
    """Return other-language homepage URLs linked from page_url (hreflang first,
    then switcher links like /az/ or az.site.com). Same site only."""
    page_host = _host(page_url)
    own_path = (urlparse(page_url).path or "/").rstrip("/") + "/"
    found = {}
    try:
        soup = BeautifulSoup(page_html or "", "html.parser")
    except Exception:
        return []

    def add(lang, href):
        url = urljoin(page_url, href).split("#")[0].split("?")[0]
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https") or not _same_site(_host(url), page_host):
            return
        path = (parsed.path or "/").rstrip("/") + "/"
        if _host(url) == page_host and path == own_path:
            return
        found.setdefault(lang, url if url.endswith("/") else url + "/")

    for tag in soup.find_all("link", href=True):
        if "alternate" not in " ".join(tag.get("rel") or []).lower():
            continue
        match = HREFLANG_RE.match((tag.get("hreflang") or "").lower())
        if match:
            add(match.group(1), tag["href"])
    for tag in soup.find_all("a", href=True):
        url = urljoin(page_url, tag["href"])
        parsed = urlparse(url)
        if not _same_site(_host(url), page_host):
            continue
        path_match = LANG_PATH_RE.match(parsed.path or "")
        if path_match and not parsed.query:
            add(path_match.group(1), url)
            continue
        sub = _host(url).split(".")[0]
        if sub in LANGUAGES and _host(url) != page_host and (parsed.path or "/") == "/":
            add(sub, url)
    return list(found.values())[:limit]
