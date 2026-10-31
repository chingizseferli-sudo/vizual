import discovery_bot as d

PAGE = "https://anews.az"
HTML = """
<a href="/xeber/1">own article</a>
<a href="https://musavat.com/news/5">Müsavat</a>
<a href="https://www.yeni-sayt.az/">Yeni</a>
<a href="https://sub.anews.az/x">own subdomain</a>
<a href="https://facebook.com/anews">social</a>
<a href="mailto:a@b.az">mail</a>
<a href="javascript:void(0)">js</a>
"""


def test_only_other_news_sites_are_extracted():
    found = d.extract_external_site_urls(HTML, PAGE)
    assert "https://musavat.com" in found
    assert "https://www.yeni-sayt.az" in found
    assert not any("anews.az" in url or "facebook" in url for url in found)


def test_sites_linked_from_several_sources_rank_first_and_known_ones_are_skipped():
    links = {
        "https://a.az": {"https://tez.az", "https://tek.az", "https://bilinen.az"},
        "https://b.az": {"https://tez.az", "https://bilinen.az"},
    }
    ranked = d.rank_outbound_candidates(links, known_domains={"bilinen.az"}, processed_domains=set())
    assert ranked == ["https://tez.az"]


def test_recently_processed_domains_are_not_candidates_again():
    links = {"https://a.az": {"https://tez.az"}, "https://b.az": {"https://tez.az"}}
    assert d.rank_outbound_candidates(links, set(), {"tez.az"}) == []


def test_outbound_candidates_join_the_discovery_batches(monkeypatch):
    monkeypatch.setattr(d, "outbound_link_candidates", lambda session, known, processed: ["https://tez.az"])
    batches = list(d.candidate_batches(object(), [], {"max_entries_per_query": 5}, set(), set()))
    assert batches == [[{"source": {"title": None, "href": "https://tez.az"}}]]
