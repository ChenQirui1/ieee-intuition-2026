"""Regression tests for scraper URL safety and error handling."""

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from services import scraper, scraping


class RedirectResponse:
    def __init__(self, status_code: int, location: str | None = None):
        self.status_code = status_code
        self.headers = (
            {"location": location} if location else {"content-type": "text/html"}
        )
        self.raw = SimpleNamespace(_connection=None)
        self.encoding = "utf-8"
        self.closed = False

    def close(self):
        self.closed = True

    def iter_content(self, chunk_size: int):
        yield b"<html><body>ok</body></html>"


def test_url_validation_rejects_non_http_and_private_hosts():
    with pytest.raises(HTTPException) as non_http:
        scraper.assert_public_http_url("ftp://example.com/file")
    assert non_http.value.status_code == 400

    with pytest.raises(HTTPException) as localhost:
        scraper.assert_public_http_url("http://localhost/private")
    assert localhost.value.status_code == 400


def test_redirect_destination_is_validated_before_following(monkeypatch):
    first_response = RedirectResponse(302, "http://127.0.0.1/admin")
    requested_urls: list[str] = []

    def fake_validate(url: str):
        if "127.0.0.1" in url:
            raise HTTPException(status_code=400, detail="blocked")

    def fake_get(url: str, **kwargs):
        requested_urls.append(url)
        return first_response

    monkeypatch.setattr(scraper, "assert_public_http_url", fake_validate)
    monkeypatch.setattr(scraper.SESSION, "get", fake_get)

    with pytest.raises(HTTPException) as blocked:
        scraper.fetch_and_parse_html("https://example.com/start")

    assert blocked.value.status_code == 400
    assert requested_urls == ["https://example.com/start"]
    assert first_response.closed is True


def test_scrape_preserves_expected_http_errors(monkeypatch):
    def fail_fetch(url: str):
        raise HTTPException(status_code=413, detail="Page too large to scrape")

    monkeypatch.setattr(scraping, "fetch_and_parse_html", fail_fetch)

    with pytest.raises(HTTPException) as error:
        scraping.scrape_url("https://example.com", db=object())

    assert error.value.status_code == 413
    assert error.value.detail == "Page too large to scrape"


@pytest.mark.parametrize(
    "ip",
    [
        "127.0.0.1",
        "10.0.0.1",
        "169.254.169.254",
        "100.64.0.1",
        "::1",
        "::ffff:127.0.0.1",
        "224.0.0.1",
    ],
)
def test_non_public_networks_are_blocked(ip):
    assert scraper._is_private_ip(ip)


def test_connection_pins_validated_ip_and_keeps_tls_hostname(monkeypatch):
    monkeypatch.setattr(
        scraper.socket,
        "getaddrinfo",
        lambda *args: [(2, 1, 6, "", ("93.184.216.34", 443))],
    )
    destinations = []
    fake_socket = object()

    def connect(address, *args, **kwargs):
        destinations.append(address)
        return fake_socket

    monkeypatch.setattr(scraper, "create_connection", connect)
    connection = scraper.PublicHTTPSConnection("example.com", port=443)
    assert connection._new_conn() is fake_socket
    assert destinations == [("93.184.216.34", 443)]
    assert connection.host == "example.com"


def test_dns_rebinding_is_blocked_before_connect(monkeypatch):
    answers = iter(["93.184.216.34", "127.0.0.1"])
    monkeypatch.setattr(
        scraper.socket,
        "getaddrinfo",
        lambda *args: [(2, 1, 6, "", (next(answers), 443))],
    )
    scraper.assert_public_http_url("https://example.com")
    monkeypatch.setattr(
        scraper,
        "create_connection",
        lambda *args, **kwargs: pytest.fail("Must not connect to rebound private IP"),
    )
    with pytest.raises(HTTPException):
        scraper.PublicHTTPSConnection("example.com", port=443)._new_conn()


def test_response_is_closed_after_oversized_download(monkeypatch):
    response = RedirectResponse(200)
    monkeypatch.setattr(scraper, "assert_public_http_url", lambda url: None)
    monkeypatch.setattr(scraper.SESSION, "get", lambda *args, **kwargs: response)
    with pytest.raises(HTTPException) as error:
        scraper.fetch_and_parse_html("https://example.com", max_bytes=1)
    assert error.value.status_code == 413
    assert response.closed
