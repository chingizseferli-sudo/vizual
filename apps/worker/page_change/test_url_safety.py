import socket
import sys
import threading
import types

import pytest

sys.modules.setdefault("dotenv", types.SimpleNamespace(load_dotenv=lambda *args, **kwargs: None))
import change_monitor as cm


CONFIG = {"request_timeout_seconds": 5, "max_response_bytes": 1000, "max_redirects": 3, "telegram_token": "123456:ABC-secret_token", "dry_run": False}


def fake_dns(mapping):
    def resolver(host, port, *args, **kwargs):
        if host not in mapping:
            raise socket.gaierror("unknown host")
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, port)) for ip in mapping[host]]

    return resolver


class FakeResponse:
    def __init__(self, status=200, headers=None, body=b"", chunks=None):
        self.status_code = status
        self.headers = headers or {}
        self._body = body
        self._chunks = chunks
        self.encoding = "utf-8"
        self.closed = False

    @property
    def is_redirect(self):
        return self.status_code in {301, 302, 303, 307, 308} and "Location" in self.headers

    def iter_content(self, chunk_size=1):
        if self._chunks is not None:
            yield from self._chunks
        else:
            yield self._body

    def close(self):
        self.closed = True


@pytest.mark.parametrize(
    "url, ips",
    [
        ("http://127.0.0.1/", ["127.0.0.1"]),
        ("http://169.254.169.254/latest/meta-data/", ["169.254.169.254"]),
        ("http://internal.example/", ["10.0.0.5"]),
        ("http://cgnat.example/", ["100.64.1.1"]),
        ("http://v6.example/", ["::1"]),
        ("http://mapped.example/", ["::ffff:192.168.1.1"]),
        ("http://mixed.example/", ["93.184.216.34", "192.168.0.1"]),
        ("http://0.0.0.0/", ["0.0.0.0"]),
    ],
)
def test_private_and_metadata_addresses_blocked(monkeypatch, url, ips):
    host = cm.urlparse(url).hostname
    monkeypatch.setattr(cm.socket, "getaddrinfo", fake_dns({host: ips}))
    with pytest.raises(cm.UnsafeUrlError):
        cm.assert_public_url(url)


@pytest.mark.parametrize(
    "url",
    [
        "file:///etc/passwd",
        "gopher://example.com/",
        "ftp://example.com/",
        "http://user:pass@example.com/",
        "http://localhost:8080/",
        "http://metadata.google.internal/",
        "http://api.railway.internal/",
        "http:///nohost",
    ],
)
def test_bad_schemes_and_hosts_blocked(monkeypatch, url):
    monkeypatch.setattr(cm.socket, "getaddrinfo", fake_dns({"example.com": ["93.184.216.34"]}))
    with pytest.raises(cm.UnsafeUrlError):
        cm.assert_public_url(url)


def test_public_address_allowed(monkeypatch):
    monkeypatch.setattr(cm.socket, "getaddrinfo", fake_dns({"example.com": ["93.184.216.34"]}))
    cm.assert_public_url("https://example.com/news")


def test_redirect_to_private_address_blocked(monkeypatch):
    monkeypatch.setattr(
        cm.socket,
        "getaddrinfo",
        fake_dns({"example.com": ["93.184.216.34"], "evil.example": ["169.254.169.254"]}),
    )
    calls = []

    def fake_request(method, url, **kwargs):
        calls.append(url)
        assert kwargs["allow_redirects"] is False
        assert kwargs["timeout"] == 5
        return FakeResponse(302, {"Location": "http://evil.example/latest/meta-data/"})

    monkeypatch.setattr(cm, "guarded_request", fake_request)
    with pytest.raises(cm.UnsafeUrlError):
        cm.safe_http_request("GET", "https://example.com/", CONFIG)
    assert calls == ["https://example.com/"]


def test_response_size_cap(monkeypatch):
    monkeypatch.setattr(cm.socket, "getaddrinfo", fake_dns({"example.com": ["93.184.216.34"]}))
    monkeypatch.setattr(cm, "guarded_request", lambda *a, **k: FakeResponse(200, chunks=[b"x" * 600, b"y" * 600]))
    with pytest.raises(cm.ResponseTooLargeError):
        cm.safe_http_request("GET", "https://example.com/", CONFIG)

    monkeypatch.setattr(cm, "guarded_request", lambda *a, **k: FakeResponse(200, {"Content-Length": "999999"}))
    with pytest.raises(cm.ResponseTooLargeError):
        cm.safe_http_request("GET", "https://example.com/", CONFIG)


def test_small_response_body_is_returned(monkeypatch):
    monkeypatch.setattr(cm.socket, "getaddrinfo", fake_dns({"example.com": ["93.184.216.34"]}))
    monkeypatch.setattr(cm, "guarded_request", lambda *a, **k: FakeResponse(200, body=b"<html>ok</html>"))
    response = cm.safe_http_request("GET", "https://example.com/", CONFIG)
    assert response._content == b"<html>ok</html>"


def test_telegram_network_error_does_not_leak_token(monkeypatch):
    def boom(url, **kwargs):
        raise cm.requests.ConnectionError(f"Max retries exceeded with url: {url}")

    monkeypatch.setattr(cm.requests, "post", boom)
    ok, error = cm.send_telegram(CONFIG, "42", "hello")
    assert ok is False
    assert "ABC-secret_token" not in error
    assert "bot<redacted>" in error


class FakeSocket:
    def __init__(self, peer):
        self.peer = peer
        self.closed = False

    def getpeername(self):
        return (self.peer, 80)

    def close(self):
        self.closed = True


@pytest.mark.parametrize("peer", ["127.0.0.1", "10.1.2.3", "169.254.169.254", "::1", "::ffff:192.168.0.1"])
def test_connection_to_private_peer_is_refused(monkeypatch, peer):
    """DNS rebinding: the pre-check saw a public IP, the connect landed on a private one."""
    sock = FakeSocket(peer)
    monkeypatch.setattr(cm.HTTPConnection, "_new_conn", lambda self: sock)
    conn = cm._PeerCheckedHTTPConnection("rebind.example", 80)
    with pytest.raises(cm.UnsafeUrlError):
        conn._new_conn()
    assert sock.closed


def test_connection_to_public_peer_is_kept(monkeypatch):
    sock = FakeSocket("93.184.216.34")
    monkeypatch.setattr(cm.HTTPConnection, "_new_conn", lambda self: sock)
    conn = cm._PeerCheckedHTTPConnection("example.com", 80)
    assert conn._new_conn() is sock
    assert not sock.closed


def test_guarded_session_uses_peer_checked_pools():
    cm._GUARDED_SESSION.__dict__.pop("session", None)
    with pytest.raises(Exception):
        cm.guarded_request("GET", "http://127.0.0.1:9/", timeout=1)
    session = cm._GUARDED_SESSION.session
    assert session.trust_env is False
    adapter = session.get_adapter("https://example.com/")
    assert adapter.poolmanager.pool_classes_by_scheme["https"] is cm._PeerCheckedHTTPSPool
    assert adapter.poolmanager.pool_classes_by_scheme["http"] is cm._PeerCheckedHTTPPool


def test_guarded_request_refuses_loopback_server():
    """End to end with a real local socket: the pre-check is bypassed, the peer check still refuses."""
    import http.server

    server = http.server.HTTPServer(("127.0.0.1", 0), http.server.BaseHTTPRequestHandler)
    port = server.server_address[1]
    thread = threading.Thread(target=server.handle_request, daemon=True)
    thread.start()
    try:
        with pytest.raises(cm.UnsafeUrlError):
            cm.guarded_request("GET", f"http://127.0.0.1:{port}/", timeout=2)
    finally:
        server.server_close()
