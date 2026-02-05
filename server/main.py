from __future__ import annotations

import os
import re
import socket
import ipaddress
from typing import Optional, List

import firebase_admin
from firebase_admin import credentials, firestore
import requests
from bs4 import BeautifulSoup
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, AnyUrl, Field
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

app = FastAPI(title="Scraper API")

# ---------- Firestore init ----------

def get_firestore():
    """
    Initializes Firebase Admin (once) and returns a Firestore client.
    Requires GOOGLE_APPLICATION_CREDENTIALS to point to your service-account JSON.
    """
    if not firebase_admin._apps:
        cred_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
        if not cred_path:
            raise RuntimeError(
                "GOOGLE_APPLICATION_CREDENTIALS is not set. "
                "Set it to the full path of your Firebase service account JSON."
            )
        firebase_admin.initialize_app(credentials.Certificate(cred_path))
    return firestore.client()

db = get_firestore()

# ---------- Models ----------

class ScrapRequest(BaseModel):
    url: AnyUrl = Field(..., description="http(s) URL to scrape")

class PageMeta(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    canonical: Optional[str] = None
    lang: Optional[str] = None

class LinkItem(BaseModel):
    href: str
    text: str
    is_internal: bool

class ImageItem(BaseModel):
    src: str
    alt: str = ""

class ContentBlock(BaseModel):
    type: str  # heading|paragraph|list|table|quote|code|hr
    level: Optional[int] = None          # heading level (1-6)
    depth: Optional[int] = None          # nesting depth for lists
    text: Optional[str] = None           # for heading/paragraph/quote/code
    items: Optional[List[str]] = None    # for list
    headers: Optional[List[str]] = None  # for table
    rows: Optional[List[List[str]]] = None  # for table

class ScrapResponse(BaseModel):
    ok: bool = True
    url: str
    meta: PageMeta
    blocks: List[ContentBlock]
    links: List[LinkItem] = []
    images: List[ImageItem] = []


# ---------------- SSRF protection ----------------

BLOCKED_HOSTS = {"localhost", "127.0.0.1", "::1"}

def _is_private_ip(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
        return (
            addr.is_private
            or addr.is_loopback
            or addr.is_link_local
            or addr.is_reserved
            or addr.is_multicast
            or addr.is_unspecified
        )
    except ValueError:
        return True

def assert_public_hostname(hostname: str) -> None:
    if hostname.lower() in BLOCKED_HOSTS:
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
            raise HTTPException(status_code=400, detail="URL resolves to a private/blocked IP")


# ---------------- Requests session ----------------

def build_session() -> requests.Session:
    s = requests.Session()
    retry = Retry(
        total=3,
        backoff_factor=0.5,
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=["GET"],
        raise_on_status=False,
    )
    adapter = HTTPAdapter(max_retries=retry, pool_connections=50, pool_maxsize=50)
    s.mount("http://", adapter)
    s.mount("https://", adapter)
    return s

SESSION = build_session()


# ---------------- Extraction helpers ----------------

def _clean_text(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()

def _is_internal_link(base_url: str, href: str) -> bool:
    try:
        b = urlparse(base_url)
        u = urlparse(href)
        if not u.netloc:
            return True
        return u.netloc == b.netloc
    except Exception:
        return False

def remove_non_content(soup: BeautifulSoup) -> None:
    # Remove heavy/noisy tags. Keep more “raw” by reducing this list if desired.
    for tag in soup(["script", "style", "noscript", "svg", "canvas", "iframe"]):
        tag.decompose()

def select_root(soup: BeautifulSoup) -> Tag:
    return soup.find("main") or soup.find("article") or soup.body or soup

def extract_meta(soup: BeautifulSoup, base_url: str) -> PageMeta:
    title = _clean_text(soup.title.get_text()) if soup.title and soup.title.get_text() else None

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

def extract_links_and_images(root: Tag, base_url: str, max_links=600, max_images=300):
    links: List[LinkItem] = []
    images: List[ImageItem] = []

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
    # join text while preserving reasonable spacing
    return _clean_text(el.get_text(" ", strip=True))

def _extract_list(el: Tag, max_items=200) -> List[str]:
    items: List[str] = []
    for li in el.find_all("li", recursive=True):
        t = _clean_text(li.get_text(" ", strip=True))
        if t:
            items.append(t)
        if len(items) >= max_items:
            break
    return items

def _extract_table(el: Tag, max_rows=200, max_cols=30):
    headers: List[str] = []
    ths = el.find_all("th")
    if ths:
        headers = [_clean_text(th.get_text(" ", strip=True)) for th in ths][:max_cols]
        headers = [h for h in headers if h]

    rows: List[List[str]] = []
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

def extract_blocks_in_order(root: Tag, max_blocks: int = 800) -> List[ContentBlock]:
    """
    Walk the DOM in document order and emit "useful" blocks.
    Strategy: iterate over a curated set of block-level tags in order of appearance.
    """
    blocks: List[ContentBlock] = []

    # Consider these tags as block-level content for LLM ingestion
    block_tags = {
        "h1","h2","h3","h4","h5","h6",
        "p",
        "ul","ol",
        "table",
        "blockquote",
        "pre","code",
        "hr",
    }

    # Find all candidates in document order
    candidates = root.find_all(lambda t: isinstance(t, Tag) and t.name in block_tags)

    for el in candidates:
        if len(blocks) >= max_blocks:
            break

        name = el.name

        # Skip empty / invisible-ish blocks
        if name in {"p","blockquote"}:
            txt = _block_text(el)
            if not txt:
                continue

        if name in {"h1","h2","h3","h4","h5","h6"}:
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

        if name in {"ul","ol"}:
            items = _extract_list(el)
            if items:
                # approximate nesting depth by counting parent lists
                depth = 0
                parent = el.parent
                while isinstance(parent, Tag):
                    if parent.name in {"ul","ol"}:
                        depth += 1
                    parent = parent.parent
                blocks.append(ContentBlock(type="list", depth=depth, items=items))
            continue

        if name == "table":
            headers, rows = _extract_table(el)
            if headers or rows:
                blocks.append(ContentBlock(type="table", headers=headers or None, rows=rows or None))
            continue

        if name == "blockquote":
            txt = _block_text(el)
            if txt:
                blocks.append(ContentBlock(type="quote", text=txt))
            continue

        if name in {"pre","code"}:
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
    compacted: List[ContentBlock] = []
    last_sig = None
    for b in blocks:
        sig = (b.type, b.level, b.text, tuple(b.items) if b.items else None)
        if sig == last_sig:
            continue
        compacted.append(b)
        last_sig = sig

    return compacted


# ---------------- Route ----------------

MAX_BYTES = 2_000_000  # 2MB cap

@app.post("/scrap", response_model=ScrapResponse)
def scrap(req: ScrapRequest):
    assert_public_hostname(req.url.host)

    try:
        r = SESSION.get(
            str(req.url),
            timeout=(5, 12),
            allow_redirects=True,
            stream=True,
            headers={
                "User-Agent": "Mozilla/5.0 (compatible; ScrapBot/1.0)",
                "Accept": "text/html,application/xhtml+xml",
            },
        )
    except requests.Timeout:
        raise HTTPException(status_code=504, detail="Upstream fetch timeout")
    except requests.RequestException:
        raise HTTPException(status_code=502, detail="Upstream fetch failed")

    if r.status_code < 200 or r.status_code >= 300:
        raise HTTPException(status_code=502, detail=f"Upstream returned {r.status_code}")

    content_type = (r.headers.get("content-type") or "").lower()
    if "text/html" not in content_type:
        raise HTTPException(status_code=415, detail=f"Unsupported content-type: {content_type}")

    chunks: List[bytes] = []
    total = 0
    for chunk in r.iter_content(chunk_size=64 * 1024):
        if not chunk:
            continue
        total += len(chunk)
        if total > MAX_BYTES:
            raise HTTPException(status_code=413, detail="Page too large to scrape")
        chunks.append(chunk)

    raw = b"".join(chunks)
    r.encoding = r.encoding or "utf-8"
    html = raw.decode(r.encoding, errors="replace")

    soup = BeautifulSoup(html, "html.parser")

    meta = extract_meta(soup, str(req.url))

    # Clean noise for better LLM-friendly blocks
    remove_non_content(soup)

    root = select_root(soup)

    blocks = extract_blocks_in_order(root)
    links, images = extract_links_and_images(root, str(req.url))

    return ScrapResponse(
        ok=True,
        url=str(req.url),
        meta=meta,
        blocks=blocks,
        links=links,
        images=images,
    )


# ---------- Quick test route ----------

@app.get("/firestore-test")
def firestore_test():
    ref = db.collection("audits").document()
    ref.set({"hello": "world"})
    return {"ok": True, "id": ref.id}
