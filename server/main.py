"""Main FastAPI application for the web scraper."""

import os

import httpx
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


@app.get("/openai-test")
def openai_test():
    """
    Quick test route to verify OpenAI API connectivity.
    Expects OPENAI_API_KEY in environment.
    """
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=500,
            detail="OPENAI_API_KEY is not set in the environment.",
        )

    model = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")
    url = "https://api.openai.com/v1/responses"
    payload = {
        "model": model,
        "input": "ping",
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    try:
        resp = httpx.post(url, json=payload, headers=headers, timeout=20.0)
        resp.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=exc.response.status_code,
            detail=exc.response.text,
        ) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"OpenAI request failed: {exc}",
        ) from exc

    data = resp.json()
    text_out = ""
    for item in data.get("output", []):
        if item.get("type") == "message":
            for content in item.get("content", []):
                if content.get("type") == "output_text":
                    text_out += content.get("text", "")

    return {
        "ok": True,
        "id": data.get("id"),
        "model": data.get("model"),
        "status": data.get("status"),
        "text": text_out,
    }




