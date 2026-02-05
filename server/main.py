"""Main FastAPI application for the web scraper."""

from __future__ import annotations

from fastapi import FastAPI, HTTPException

from models import ScrapRequest, ScrapResponse
from scraper import (
    assert_public_hostname,
    extract_meta,
    extract_blocks_in_order,
    extract_links_and_images,
    remove_non_content,
    select_root,
    fetch_and_parse_html,
)
from firebase_store import save_scrape, db  # db only used for firestore-test


app = FastAPI(title="Scraper API")


def _safe_trim_blocks(blocks, max_blocks: int = 200, max_total_chars: int = 80_000):
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


@app.post("/scrap", response_model=ScrapResponse)
def scrap(req: ScrapRequest):
    """Scrape a URL and extract metadata, content blocks, links, and images. Also saves to Firestore."""
    assert_public_hostname(req.url.host)

    try:
        soup = fetch_and_parse_html(str(req.url))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to fetch/parse HTML: {e}")

    meta = extract_meta(soup, str(req.url))

    remove_non_content(soup)
    root = select_root(soup)

    blocks = extract_blocks_in_order(root)
    links, images = extract_links_and_images(root, str(req.url))

    # Save to Firestore (won't break request if it fails)
    try:
        save_scrape(
            url=str(req.url),
            meta=meta,
            blocks=_safe_trim_blocks(blocks),
            links=links,
            images=images,
            collection="audits",
        )
    except Exception:
        pass

    return ScrapResponse(
        ok=True,
        url=str(req.url),
        meta=meta,
        blocks=blocks,
        links=links,
        images=images,
    )


@app.get("/firestore-test")
def firestore_test():
    """Quick test route to verify Firestore connectivity."""
    ref = db.collection("audits").document()
    ref.set({"hello": "world"})
    return {"ok": True, "id": ref.id}
