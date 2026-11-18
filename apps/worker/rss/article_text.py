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
# Labels of the "read also" boxes sites put inside or right after the article text. The
# headlines under them belong to other stories, so a keyword there is not this article's.
_READ_ALSO_STRONG = (
    r"həmçinin\s+(?:oxu|bax|izlə)|hemcinin\s+(?:oxu|bax)|oxşar\s+xəbər|oxsar\s+xeber|"
    r"читайте\s+также|также\s+читайте|похожие\s+новости|read\s+also|also\s+read|see\s+also|"
    r"related\s+(?:news|articles|stories)"
)
# Words that may also open a normal sentence ("Bu mövzuda nazir..."): only a label when
# a colon/dash/end follows.
_READ_ALSO_WEAK = (
    r"digər\s+xəbərlər|diger\s+xeberler|bu\s+mövzuda|mövzu\s+ilə\s+bağlı|daha\s+çox\s+oxu|"
    r"ən\s+çox\s+oxunan|son\s+xəbərlər|по\s+теме|читайте\s+по\s+теме|смотрите\s+также|"
    r"другие\s+новости|последние\s+новости|read\s+more|more\s+news"
)
READ_ALSO_RE = re.compile(
    rf"^\W*(?:(?:{_READ_ALSO_STRONG})|(?:{_READ_ALSO_WEAK})\s*(?:[:\-\u2013\u2014\u00bb>|]|$))",
    re.IGNORECASE,
)
SHORT_BLOCK_CHARS = 400
SPACE_RE = re.compile(r"\s+")


def _clean(text):
    return SPACE_RE.sub(" ", unescape(str(text or ""))).strip()


def _drop_read_also_lines(text):
    return "\n".join(line for line in str(text).splitlines() if not READ_ALSO_RE.match(line.strip()))


def html_fragment_text(fragment):
    """Plain text of an HTML snippet (RSS description, content:encoded), without "read also" links."""
    fragment = str(fragment or "")
    if "<" not in fragment:
        return _clean(_drop_read_also_lines(fragment))
    try:
        soup = BeautifulSoup(fragment[:MAX_HTML_CHARS], "lxml")
        _drop_other_stories(soup)
        return _clean(soup.get_text(" "))
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
                return html_fragment_text(_drop_read_also_lines(body))
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


def _text_len(tag):
    return len(_clean(tag.get_text(" ")))


def _link_share(tag):
    text = _text_len(tag)
    if not text:
        return 0.0
    return sum(_text_len(link) for link in tag.find_all("a")) / text


def _plain_len(tag):
    """Length of the text that is not link text."""
    return _text_len(tag) - sum(_text_len(link) for link in tag.find_all("a"))


def _short_block(tag):
    """The largest box around tag that holds no article text of its own besides links."""
    block = tag
    while block.parent is not None and block.parent.name not in ("body", "html", "[document]", "article", "main"):
        parent = block.parent
        if _text_len(parent) > SHORT_BLOCK_CHARS or _plain_len(parent) - _plain_len(block) >= MIN_PARAGRAPH_CHARS:
            break
        block = parent
    return block


def _drop_other_stories(soup):
    """Remove "read also" boxes and headline teasers that sit inside the article text."""
    for label in soup.find_all(["p", "div", "span", "strong", "b", "em", "h2", "h3", "h4", "h5", "h6", "li", "section"]):
        if label.decomposed or label.parent is None:
            continue
        text = _clean(label.get_text(" "))
        if not text or not READ_ALSO_RE.match(text):
            continue
        if len(text) <= 40:
            # A bare label ("Oxşar xəbərlər"): the list after it is the other stories.
            block = _short_block(label)
            following = block.find_next_sibling()
            if following is not None and _link_share(following) >= 0.5:
                following.decompose()
            block.decompose()
        elif len(text) <= SHORT_BLOCK_CHARS or _link_share(label) >= 0.3:
            # "Həmçinin oxu: <a>Other story headline</a>"
            _short_block(label).decompose()
    for heading in soup.find_all(["h2", "h3", "h4", "h5"]):
        if heading.decomposed or heading.parent is None:
            continue
        if heading.find_parent("a") is None and heading.find("a") is None:
            continue
        # A linked headline is a teaser card of another story, maybe with one lead paragraph.
        anchor = heading.find_parent("a") or heading
        card = heading.find_parent(["li", "article"]) or anchor.parent
        if (
            card is not None
            and card.name not in ("body", "html", "[document]", "main")
            and _text_len(card) <= SHORT_BLOCK_CHARS
            and len(card.find_all("p")) <= 1
        ):
            card.decompose()
        else:
            anchor.decompose()
    for block in soup.find_all(["p", "li", "ul", "ol", "div", "section", "table"]):
        if block.decomposed or block.parent is None:
            continue
        if block.find("a") is not None and _link_share(block) >= 0.6:
            block.decompose()


def _paragraph_body(soup):
    """Text of the element holding most of the page's paragraph text (a small readability)."""
    for tag in soup(NOISE_TAGS):
        tag.decompose()
    for tag in soup.find_all(_is_noise):
        if tag.name not in ("html", "body"):
            tag.decompose()
    _drop_other_stories(soup)
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
