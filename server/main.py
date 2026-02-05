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

class Headings(BaseModel):
    h1: List[str] = []
    h2: List[str] = []
    h3: List[str] = []

class ScrapResponse(BaseModel):
    ok: bool = True
    url: str
    title: Optional[str] = None
    description: Optional[str] = None
    headings: Headings
    text: str  # trimmed plain text snippet


# ---------- SSRF / safety helpers ----------

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


# ---------- Requests session with retries ----------

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


# ---------- Scraping helpers ----------

def _clean_text(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()

def extract_meta_description(soup: BeautifulSoup) -> Optional[str]:
    for attrs in (
        {"name": "description"},
        {"property": "og:description"},
        {"name": "twitter:description"},
    ):
        tag = soup.find("meta", attrs=attrs)
        if tag and tag.get("content"):
            val = _clean_text(tag["content"])
            if val:
                return val
    return None

def extract_headings(soup: BeautifulSoup) -> Headings:
    def grab(tag: str) -> List[str]:
        out: List[str] = []
        for el in soup.find_all(tag):
            t = _clean_text(el.get_text(" ", strip=True))
            if t:
                out.append(t)
        return out

    return Headings(h1=grab("h1"), h2=grab("h2"), h3=grab("h3"))

def extract_text(soup: BeautifulSoup, max_len: int = 4000) -> str:
    for tag in soup(["script", "style", "noscript", "svg", "canvas", "iframe"]):
        tag.decompose()

    target = soup.find("main") or soup.find("article") or soup.body or soup
    text = _clean_text(target.get_text(" ", strip=True))
    return text[:max_len]


# ---------- Route ----------

MAX_BYTES = 2_000_000  # 2MB cap to avoid huge downloads

@app.post("/scrap", response_model=ScrapResponse)
def scrap(req: ScrapRequest):
    assert_public_hostname(req.url.host)

    try:
        r = SESSION.get(
            str(req.url),
            timeout=(5, 12),  # (connect, read)
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

    # Read with size cap
    chunks = []
    total = 0
    for chunk in r.iter_content(chunk_size=64 * 1024):
        if not chunk:
            continue
        total += len(chunk)
        if total > MAX_BYTES:
            raise HTTPException(status_code=413, detail="Page too large to scrape")
        chunks.append(chunk)

    raw = b"".join(chunks)
    # Let requests guess encoding; fallback to utf-8
    r.encoding = r.encoding or "utf-8"
    html = raw.decode(r.encoding, errors="replace")

    soup = BeautifulSoup(html, "html.parser")

    title = _clean_text(soup.title.get_text()) if soup.title and soup.title.get_text() else None
    description = extract_meta_description(soup)
    headings = extract_headings(soup)
    text = extract_text(soup)

    # OPTIONAL: save to Firestore (remove if you don't want auto-saving)
    try:
        db.collection("audits").add(
            { 
                "url": str(req.url),
                "title": title,
                "description": description,
                "headings": headings.model_dump(),
                "text": text,
                "ok": True,
            }
        )
    except Exception:
        # Don't break scraping if Firestore write fails (hackathon-friendly)
        pass

    return ScrapResponse(
        ok=True,
        url=str(req.url),
        title=title,
        description=description,
        headings=headings,
        text=text,
    )


# ---------- Quick test route ----------

@app.get("/firestore-test")
def firestore_test():
    ref = db.collection("audits").document()
    ref.set({"hello": "world"})
    return {"ok": True, "id": ref.id}
