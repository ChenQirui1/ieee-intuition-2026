"""Main FastAPI application for the web scraper."""

from fastapi import FastAPI

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
from firebase_store import db

app = FastAPI(title="Scraper API")


@app.post("/scrap", response_model=ScrapResponse)
def scrap(req: ScrapRequest):
    """
    Scrape a URL and extract metadata, content blocks, links, and images.
    """
    assert_public_hostname(req.url.host)

    soup = fetch_and_parse_html(str(req.url))

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


@app.get("/firestore-test")
def firestore_test():
    """Quick test route to verify Firestore connectivity."""
    ref = db.collection("audits").document()
    ref.set({"hello": "world"})
    return {"ok": True, "id": ref.id}
