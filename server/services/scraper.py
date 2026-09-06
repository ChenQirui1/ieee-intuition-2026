"""Web scraping utilities and helpers."""

import ipaddress
import re
import socket
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup, Tag
from fastapi import HTTPException
from requests.adapters import HTTPAdapter
from urllib3.connection import HTTPConnection, HTTPSConnection
from urllib3.connectionpool import HTTPConnectionPool, HTTPSConnectionPool
from urllib3.exceptions import NewConnectionError
from urllib3.util.connection import create_connection
from urllib3.util.retry import Retry

from models import ContentBlock, ImageItem, LinkItem, PageMeta

# ---------- SSRF / safety helpers ----------

BLOCKED_HOSTS = {"localhost", "localhost.localdomain", "127.0.0.1", "::1"}
MAX_REDIRECTS = 5


def _is_private_ip(ip: str) -> bool:
    """Check if an IP address is private, loopback, or otherwise blocked."""
    try:
        addr = ipaddress.ip_address(ip)
        return not addr.is_global or addr.is_multicast
    except ValueError:
        return True


def assert_public_hostname(hostname: str) -> list[str]:
    """
    Validate that a hostname resolves to a public IP address.
    Raises HTTPException if the hostname is blocked or resolves to a private IP.
    """
    hostname = hostname.strip().rstrip(".").lower()
    if not hostname or hostname in BLOCKED_HOSTS or hostname.endswith(".localhost"):
        raise HTTPException(status_code=400, detail="URL hostname is not allowed")
    try:
        infos = socket.getaddrinfo(hostname, None)
    except socket.gaierror:
        raise HTTPException(status_code=400, detail="DNS lookup failed")

    resolved_ips = {info[4][0] for info in infos}
    if not resolved_ips:
        raise HTTPException(status_code=400, detail="DNS lookup failed")

    for ip in resolved_ips:
        if _is_private_ip(ip):
            raise HTTPException(
                status_code=400, detail="URL resolves to a private/blocked IP"
            )
    return sorted(resolved_ips)


def assert_public_http_url(url: str) -> None:
    """Reject non-HTTP URLs, embedded credentials, and private destinations."""
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        raise HTTPException(
            status_code=400, detail="Only http and https URLs are allowed"
        )
    if parsed.username or parsed.password:
        raise HTTPException(
            status_code=400, detail="URLs with credentials are not allowed"
        )
    if not parsed.hostname:
        raise HTTPException(status_code=400, detail="URL hostname is required")
    assert_public_hostname(parsed.hostname)


class PublicConnectionMixin:
    def _new_conn(self):
        # Resolve once at connection time, validate every answer, and connect to
        # a numeric address. Keep self.host intact for Host, TLS SNI, and certs.
        addresses = assert_public_hostname(self.host)
        last_error = None
        for address in addresses:
            try:
                return create_connection(
                    (address, self.port),
                    self.timeout,
                    source_address=self.source_address,
                    socket_options=self.socket_options,
                )
            except OSError as exc:
                last_error = exc
        raise NewConnectionError(
            self, "Public destination connection failed"
        ) from last_error


class PublicHTTPConnection(PublicConnectionMixin, HTTPConnection):
    pass


class PublicHTTPSConnection(PublicConnectionMixin, HTTPSConnection):
    pass


class PublicHTTPPool(HTTPConnectionPool):
    ConnectionCls = PublicHTTPConnection


class PublicHTTPSPool(HTTPSConnectionPool):
    ConnectionCls = PublicHTTPSConnection


class PublicHTTPAdapter(HTTPAdapter):
    def init_poolmanager(self, *args, **kwargs):
        super().init_poolmanager(*args, **kwargs)
        self.poolmanager.pool_classes_by_scheme = {
            "http": PublicHTTPPool,
            "https": PublicHTTPSPool,
        }


# ---------- Requests session ----------


def build_session() -> requests.Session:
    """Create a requests session with retry logic and connection pooling."""
    s = requests.Session()
    # Do not let ambient HTTP_PROXY settings redirect scraper traffic through
    # an unexpected network path.
    s.trust_env = False
    retry = Retry(
        total=3,
        backoff_factor=0.5,
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=["GET"],
        raise_on_status=False,
    )
    adapter = PublicHTTPAdapter(max_retries=retry, pool_connections=50, pool_maxsize=50)
    s.mount("http://", adapter)
    s.mount("https://", adapter)
    return s


SESSION = build_session()


# ---------- Text helpers ----------


def _clean_text(s: str) -> str:
    """Clean and normalize whitespace in text."""
    return re.sub(r"\s+", " ", s).strip()


def _is_internal_link(base_url: str, href: str) -> bool:
    """Check if a link is internal to the base URL."""
    try:
        b = urlparse(base_url)
        u = urlparse(href)
        if not u.netloc:
            return True
        return u.netloc == b.netloc
    except ValueError:
        return False


# ---------- DOM helpers ----------


def remove_non_content(soup: BeautifulSoup) -> None:
    """Remove script, style, and other non-content tags."""
    for tag in soup(["script", "style", "noscript", "svg", "canvas", "iframe"]):
        tag.decompose()


def select_root(soup: BeautifulSoup) -> Tag:
    """Select the main content root element."""
    return soup.find("main") or soup.find("article") or soup.body or soup


# ---------- Extraction functions ----------


def extract_meta(soup: BeautifulSoup, base_url: str) -> PageMeta:
    """Extract page metadata (title, description, canonical, lang)."""
    title = (
        _clean_text(soup.title.get_text())
        if soup.title and soup.title.get_text()
        else None
    )

    desc = None
    for attrs in (
        {"name": "description"},
        {"property": "og:description"},
        {"name": "twitter:description"},
    ):
        tag = soup.find("meta", attrs=attrs)
        if tag and tag.get("content"):
            desc = _clean_text(tag["content"])
            if desc:
                break

    canonical = None
    canon = soup.find("link", rel=lambda x: x and "canonical" in x)
    if canon and canon.get("href"):
        canonical = urljoin(base_url, canon["href"])

    html_tag = soup.find("html")
    lang = html_tag.get("lang") if html_tag else None

    return PageMeta(title=title, description=desc, canonical=canonical, lang=lang)


def extract_links_and_images(
    root: Tag, base_url: str, max_links: int = 600, max_images: int = 300
) -> tuple[list[LinkItem], list[ImageItem]]:
    """Extract links and images from the root element."""
    links: list[LinkItem] = []
    images: list[ImageItem] = []

    for a in root.find_all("a"):
        href = a.get("href")
        if not href:
            continue
        abs_href = urljoin(base_url, href)
        if abs_href.startswith(("mailto:", "tel:", "javascript:", "#")):
            continue
        text = _clean_text(a.get_text(" ", strip=True))
        links.append(
            LinkItem(
                href=abs_href,
                text=text,
                is_internal=_is_internal_link(base_url, abs_href),
            )
        )
        if len(links) >= max_links:
            break

    for img in root.find_all("img"):
        src = img.get("src") or img.get("data-src") or img.get("data-lazy-src")
        if not src:
            continue
        abs_src = urljoin(base_url, src)
        alt = _clean_text(img.get("alt") or "")
        images.append(ImageItem(src=abs_src, alt=alt))
        if len(images) >= max_images:
            break

    return links, images


def _block_text(el: Tag) -> str:
    """Extract text from a block element."""
    return _clean_text(el.get_text(" ", strip=True))


def _extract_list(el: Tag, max_items: int = 200) -> list[str]:
    """Extract list items from a list element."""
    items: list[str] = []
    for li in el.find_all("li", recursive=True):
        t = _clean_text(li.get_text(" ", strip=True))
        if t:
            items.append(t)
        if len(items) >= max_items:
            break
    return items


def _extract_table(
    el: Tag, max_rows: int = 200, max_cols: int = 30
) -> tuple[list[str], list[list[str]]]:
    """Extract table headers and rows."""
    headers: list[str] = []
    ths = el.find_all("th")
    if ths:
        headers = [_clean_text(th.get_text(" ", strip=True)) for th in ths][:max_cols]
        headers = [h for h in headers if h]

    rows: list[list[str]] = []
    for tr in el.find_all("tr"):
        cells = tr.find_all(["td", "th"])
        if not cells:
            continue
        row = [_clean_text(c.get_text(" ", strip=True)) for c in cells][:max_cols]
        if any(row):
            rows.append(row)
        if len(rows) >= max_rows:
            break

    return headers, rows


def extract_blocks_in_order(root: Tag, max_blocks: int = 800) -> list[ContentBlock]:
    """
    Walk the DOM in document order and emit "useful" blocks.
    Strategy: iterate over a curated set of block-level tags in order of appearance.
    """
    blocks: list[ContentBlock] = []

    # Consider these tags as block-level content for LLM ingestion
    block_tags = {
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "p",
        "ul",
        "ol",
        "table",
        "blockquote",
        "pre",
        "code",
        "hr",
    }

    # Find all candidates in document order
    candidates = root.find_all(lambda t: isinstance(t, Tag) and t.name in block_tags)

    for el in candidates:
        if len(blocks) >= max_blocks:
            break

        name = el.name

        # Skip empty / invisible-ish blocks
        if name in {"p", "blockquote"}:
            txt = _block_text(el)
            if not txt:
                continue

        if name in {"h1", "h2", "h3", "h4", "h5", "h6"}:
            level = int(name[1])
            txt = _block_text(el)
            if txt:
                blocks.append(ContentBlock(type="heading", level=level, text=txt))
            continue

        if name == "p":
            txt = _block_text(el)
            if txt:
                blocks.append(ContentBlock(type="paragraph", text=txt))
            continue

        if name in {"ul", "ol"}:
            items = _extract_list(el)
            if items:
                # approximate nesting depth by counting parent lists
                depth = 0
                parent = el.parent
                while isinstance(parent, Tag):
                    if parent.name in {"ul", "ol"}:
                        depth += 1
                    parent = parent.parent
                blocks.append(ContentBlock(type="list", depth=depth, items=items))
            continue

        if name == "table":
            headers, rows = _extract_table(el)
            if headers or rows:
                blocks.append(
                    ContentBlock(
                        type="table", headers=headers or None, rows=rows or None
                    )
                )
            continue

        if name == "blockquote":
            txt = _block_text(el)
            if txt:
                blocks.append(ContentBlock(type="quote", text=txt))
            continue

        if name in {"pre", "code"}:
            # pre/code can be noisy; keep but trim per-block
            txt = el.get_text("\n", strip=True)
            txt = txt.strip()
            if txt:
                blocks.append(ContentBlock(type="code", text=txt[:4000]))
            continue

        if name == "hr":
            blocks.append(ContentBlock(type="hr"))
            continue

    # Optional: light dedupe of consecutive identical paragraphs/headings
    compacted: list[ContentBlock] = []
    last_sig = None
    for b in blocks:
        sig = (b.type, b.level, b.text, tuple(b.items) if b.items else None)
        if sig == last_sig:
            continue
        compacted.append(b)
        last_sig = sig

    return compacted


def fetch_and_parse_html(url: str, max_bytes: int = 2_000_000) -> BeautifulSoup:
    """
    Fetch a URL and parse the HTML content.

    Args:
        url: URL to fetch
        max_bytes: Maximum bytes to download

    Returns:
        BeautifulSoup object

    Raises:
        HTTPException: If fetch fails or content is too large
    """
    current_url = url
    r: requests.Response | None = None
    for redirect_count in range(MAX_REDIRECTS + 1):
        assert_public_http_url(current_url)
        try:
            r = SESSION.get(
                current_url,
                timeout=(5, 12),
                allow_redirects=False,
                stream=True,
                headers={
                    "User-Agent": "Mozilla/5.0 (compatible; ScrapBot/1.0)",
                    "Accept": "text/html,application/xhtml+xml",
                },
            )
        except requests.Timeout as exc:
            raise HTTPException(
                status_code=504, detail="Upstream fetch timeout"
            ) from exc
        except requests.RequestException as exc:
            raise HTTPException(
                status_code=502, detail="Upstream fetch failed"
            ) from exc

        if r.status_code not in {301, 302, 303, 307, 308}:
            break

        location = r.headers.get("location")
        r.close()
        if not location:
            raise HTTPException(
                status_code=502, detail="Upstream redirect has no location"
            )
        if redirect_count >= MAX_REDIRECTS:
            raise HTTPException(status_code=502, detail="Too many upstream redirects")
        current_url = urljoin(current_url, location)

    if r is None:
        raise HTTPException(status_code=502, detail="Upstream fetch failed")

    try:
        if r.status_code < 200 or r.status_code >= 300:
            raise HTTPException(
                status_code=502, detail=f"Upstream returned {r.status_code}"
            )
        content_type = (r.headers.get("content-type") or "").lower()
        if not any(
            kind in content_type for kind in ("text/html", "application/xhtml+xml")
        ):
            raise HTTPException(status_code=415, detail="Unsupported content-type")
        chunks: list[bytes] = []
        total = 0
        for chunk in r.iter_content(chunk_size=64 * 1024):
            total += len(chunk)
            if total > max_bytes:
                raise HTTPException(status_code=413, detail="Page too large to scrape")
            chunks.append(chunk)
        raw = b"".join(chunks)
        return BeautifulSoup(raw, "html.parser", from_encoding=r.encoding)
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail="Upstream download failed") from exc
    finally:
        r.close()
