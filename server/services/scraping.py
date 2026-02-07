"""Scraping service - handles web scraping and content extraction."""

import hashlib
from typing import Any, Dict, List
from urllib.parse import urlparse

from fastapi import HTTPException

from services.scraper import (
    assert_public_hostname,
    extract_blocks_in_order,
    extract_links_and_images,
    extract_meta,
    fetch_and_parse_html,
    remove_non_content,
    select_root,
)


def _safe_trim_blocks(blocks, max_blocks: int = 200, max_total_chars: int = 80_000):
    """Trim blocks to prevent memory issues."""
    trimmed = []
    total = 0
    for b in blocks[:max_blocks]:
        item = b.model_dump() if hasattr(b, "model_dump") else b
        s = str(item)
        if total + len(s) > max_total_chars:
            break
        trimmed.append(item)
        total += len(s)
    return trimmed


def blocks_to_text(blocks: List[Dict[str, Any]], max_chars: int = 24_000) -> str:
    """Convert blocks to plain text representation."""
    out: List[str] = []
    for b in blocks:
        t = b.get("type")
        if t == "heading":
            lvl = b.get("level") or 2
            text = (b.get("text") or "").strip()
            if text:
                out.append(f"{'#' * min(6, max(1, lvl))} {text}")
        elif t == "paragraph":
            text = (b.get("text") or "").strip()
            if text:
                out.append(text)
        elif t == "list":
            items = b.get("items") or []
            for it in items[:12]:
                it = (it or "").strip()
                if it:
                    out.append(f"- {it}")
        elif t == "table":
            headers = b.get("headers") or []
            if headers:
                out.append("Table: " + " | ".join(headers[:8]))
        elif t == "quote":
            text = (b.get("text") or "").strip()
            if text:
                out.append(f"> {text}")

        if sum(len(x) for x in out) > max_chars:
            break

    return "\n".join(out)[:max_chars]


def scrape_url(url: str, db, session_id: str = None) -> Dict[str, Any]:
    """Scrape a URL and save to database. Returns page data."""
    from database.interface import page_id_for_url

    host = urlparse(url).hostname or ""
    assert_public_hostname(host)

    try:
        soup = fetch_and_parse_html(url)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to fetch/parse HTML: {e}")

    meta = extract_meta(soup, url)
    remove_non_content(soup)
    root = select_root(soup)

    blocks = extract_blocks_in_order(root)
    links, images = extract_links_and_images(root, url)

    blocks_trim = _safe_trim_blocks(blocks)
    blocks_data = [
        b.model_dump() if hasattr(b, "model_dump") else b for b in blocks_trim
    ]
    links_data = [
        l.model_dump() if hasattr(l, "model_dump") else l for l in (links or [])
    ][:40]
    images_data = [
        i.model_dump() if hasattr(i, "model_dump") else i for i in (images or [])
    ][:20]

    source_text = blocks_to_text(blocks_data)
    source_text_hash = hashlib.sha256(source_text.encode("utf-8")).hexdigest()

    # Convert meta to dict for database compatibility
    meta_dict = meta.model_dump() if hasattr(meta, "model_dump") else meta

    pid = page_id_for_url(url)
    db.save_page(
        page_id=pid,
        url=url,
        meta=meta_dict,
        blocks=blocks_data,
        links=links_data,
        images=images_data,
        source_text=source_text,
        source_text_hash=source_text_hash,
        session_id=session_id,
    )

    return {
        "page_id": pid,
        "url": url,
        "meta": meta.model_dump() if hasattr(meta, "model_dump") else meta,
        "blocks": blocks_data,
        "links": links_data,
        "images": images_data,
        "source_text": source_text,
        "source_text_hash": source_text_hash,
    }
