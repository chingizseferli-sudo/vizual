"""Article body text for keyword matching.

Headlines often leave out the name a customer tracks ("school principal did X" with
the school only in the text), so keywords are also looked for in the article text:
the feed's own summary/content first, then the article page the worker already
downloads to read the publish date. No extra request is made for the body.
"""
import json
import re
from html import unescape

from bs4 import BeautifulSoup

MAX_HTML_CHARS = 1_500_000
MAX_BODY_CHARS = 20_000
MIN_PARAGRAPH_CHARS = 40

NOISE_TAGS = ("script", "style", "noscript", "nav", "aside", "footer", "header", "form", "iframe", "svg", "button", "select")
# Blocks around the article (related news, comments, share bars, ads) carry other stories'
# headlines; reading them would match keywords the article itself never mentions.
NOISE_HINT_RE = re.compile(
    r"related|similar|oxsar|oxşar|diger|digər|more-news|read-?more|recommend|popular|"
    r"most-read|trending|sidebar|comment|share|social|tags?\b|banner|advert|reklam|"
    r"breadcrumb|menu|footer|header|subscribe|newsletter|cookie|widget|login",
    re.IGNORECASE,
)
SPACE_RE = re.compile(r"\s+")


def _clean(text):
    return SPACE_RE.sub(" ", unescape(str(text or ""))).strip()


def html_fragment_text(fragment):
    """Plain text of an HTML snippet (RSS description, content:encoded)."""
    fragment = str(fragment or "")
    if "<" not in fragment:
        return _clean(fragment)
    try:
        return _clean(BeautifulSoup(fragment[:MAX_HTML_CHARS], "lxml").get_text(" "))
    except Exception:
        return _clean(re.sub(r"<[^>]+>", " ", fragment))


def feed_entry_text(entry):
    """Summary and full content a feed entry carries, without duplicates."""
    parts = []
    for content in entry.get("content") or []:
        value = content.get("value") if isinstance(content, dict) else getattr(content, "value", "")
        parts.append(html_fragment_text(value))
    parts.append(html_fragment_text(entry.get("summary") or entry.get("description") or ""))
    text = ""
    for part in parts:
        if part and part not in text:
            text = f"{text} {part}".strip()
    return text[:MAX_BODY_CHARS]


def _json_ld_body(soup):
    for script in soup.find_all("script", attrs={"type": "application/ld+json"}):
        try:
            data = json.loads(script.string or script.get_text() or "{}")
        except Exception:
            continue
        nodes = list(data) if isinstance(data, list) else [data]
        while nodes:
            node = nodes.pop(0)
            if not isinstance(node, dict):
                continue
            nodes.extend(child for child in node.get("@graph") or [] if isinstance(child, dict))
            body = node.get("articleBody")
            if isinstance(body, str) and len(_clean(body)) >= MIN_PARAGRAPH_CHARS:
                return html_fragment_text(body)
    return ""


def _meta_description(soup):
    for key in ("og:description", "description", "twitter:description"):
        tag = soup.find("meta", attrs={"property": key}) or soup.find("meta", attrs={"name": key})
        if tag and _clean(tag.get("content")):
            return _clean(tag.get("content"))
    return ""


def _is_noise(tag):
    attrs = getattr(tag, "attrs", None)
    if not attrs:
        return False
    hint = " ".join([" ".join(attrs.get("class") or []), str(attrs.get("id") or "")])
    return bool(hint.strip()) and bool(NOISE_HINT_RE.search(hint))


def _paragraph_body(soup):
    """Text of the element holding most of the page's paragraph text (a small readability)."""
    for tag in soup(NOISE_TAGS):
        tag.decompose()
    for tag in soup.find_all(_is_noise):
        if tag.name not in ("html", "body"):
            tag.decompose()
    marked = soup.find(attrs={"itemprop": "articleBody"})
    if marked:
        text = _clean(marked.get_text(" "))
        if len(text) >= MIN_PARAGRAPH_CHARS:
            return text
    scores = {}
    for paragraph in soup.find_all(["p", "h2", "h3", "blockquote"]):
        text = _clean(paragraph.get_text(" "))
        if len(text) < MIN_PARAGRAPH_CHARS or paragraph.find_parent("a"):
            continue
        link_text = sum(len(_clean(link.get_text(" "))) for link in paragraph.find_all("a"))
        if link_text * 2 > len(text):
            # A headline list ("Oxşar xəbərlər") is mostly links to other stories.
            continue
        parent = paragraph.parent
        if parent is None or parent.name in ("html", "[document]"):
            continue
        key = id(parent)
        entry = scores.setdefault(key, [parent, 0])
        entry[1] += len(text)
    if not scores:
        return ""
    best = max(scores.values(), key=lambda entry: entry[1])[0]
    if best.name == "body":
        # Paragraphs straight under <body>: keep them, not the whole page.
        return " ".join(_clean(p.get_text(" ")) for p in best.find_all("p", recursive=False))
    return _clean(best.get_text(" "))


def extract_article_body(page_html):
    """Lead + body text of an article page, capped; '' when nothing article-like is found."""
    if not page_html:
        return ""
    try:
        soup = BeautifulSoup(page_html[:MAX_HTML_CHARS], "lxml")
    except Exception:
        return ""
    lead = _meta_description(soup)
    body = _json_ld_body(soup) or _paragraph_body(soup)
    if lead and lead[:60] in body:
        lead = ""
    return f"{lead} {body}".strip()[:MAX_BODY_CHARS]
