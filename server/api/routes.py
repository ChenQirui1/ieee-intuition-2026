"""API routes for scraping, simplification, and chat endpoints."""

import os
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends

from api.security import enforce_api_access
from database.interface import page_id_for_url, simplification_id_for
from models.models import (
    ImageCaptionRequest,
    ImageCaptionResponse,
    ScrapRequest,
    ScrapResponse,
    SimplifyRequest,
    SimplifyResponse,
    TextCompletionRequest,
    TextCompletionResponse,
)
from services.scraping import scrape_url
from services.simplification import (
    generate_simplification,
    pick_important_links,
)
from utils.language import language_instruction
from utils.openai_client import (
    call_openai_chat,
    call_openai_image_caption,
    get_openai_model,
)

router = APIRouter()


def _get_db():
    """Get database instance (imported at module level to avoid circular imports)."""
    from main import db

    return db


# / endpoint show a simple message
@router.get("/")
def root():
    return {"message": "ClearWeb API", "health": "/healthz", "docs": "/docs"}


@router.get("/healthz")
def healthz():
    """Zero-cost liveness check; never calls OpenAI or the database."""
    return {"ok": True}


@router.post(
    "/scrap",
    response_model=ScrapResponse,
    dependencies=[Depends(enforce_api_access)],
)
def scrap(req: ScrapRequest):
    """Scrape a URL and return structured content."""
    db = _get_db()
    bundle = scrape_url(str(req.url), db)
    return ScrapResponse(
        ok=True,
        url=bundle["url"],
        meta=bundle["meta"],
        blocks=bundle["blocks"],
        links=bundle["links"],
        images=bundle["images"],
    )


@router.post(
    "/simplify",
    response_model=SimplifyResponse,
    dependencies=[Depends(enforce_api_access)],
)
def simplify(req: SimplifyRequest):
    """Simplify a webpage with intelligent summary and optional checklist."""
    db = _get_db()

    # Check database first to avoid unnecessary scraping
    page_id = page_id_for_url(str(req.url))
    page = None

    if not req.force_regen:
        page = db.get_page(page_id=page_id)
        if page and _cache_is_fresh(page):
            # Add page_id back to the dict since MongoDB stores it as _id
            page["page_id"] = page_id
            print(f"Using cached page: {page_id}")
        else:
            page = None

    # Scrape only if page not found in database or force_regen is True
    if page is None:
        page = scrape_url(str(req.url), db, session_id=req.session_id)
        print(f"Scraped new page: {page_id}")

    title = (page["meta"] or {}).get("title")
    source_hash = page["source_text_hash"]
    lang = req.language

    important_links = pick_important_links(page["links"])

    # Check cache (single simplification per language/hash)
    sid = simplification_id_for(
        url=page["url"],
        mode="intelligent",  # New unified mode
        language=lang,
        source_text_hash=source_hash,
    )

    output = None
    model_used = get_openai_model()

    if not req.force_regen:
        cached = db.find_simplification(
            url=page["url"],
            mode="intelligent",
            language=lang,
            source_text_hash=source_hash,
        )
        if cached and cached.get("output"):
            output = cached["output"]
            model_used = (cached.get("llm") or {}).get("model", model_used)
            print(f"Using cached simplification: {sid}")

    # Generate new simplification if not cached
    if output is None:
        output, model_used = generate_simplification(
            title=title,
            source_text=page["source_text"],
            links=important_links,
            language=lang,
            max_retries=1,
        )

        # Save to database
        db.save_simplification(
            simplification_id=sid,
            url=page["url"],
            page_id=page["page_id"],
            source_text_hash=source_hash,
            mode="intelligent",
            language=lang,
            output=output,
            model=model_used,
            session_id=req.session_id,
        )
        print(f"Generated new simplification: {sid}")

    return SimplifyResponse(
        ok=True,
        url=page["url"],
        page_id=page["page_id"],
        source_text_hash=source_hash,
        language=req.language,
        model=model_used,
        outputs={"intelligent": output},  # Single output with new schema
        simplification_ids={"intelligent": sid},
    )


def _cache_is_fresh(page: dict[str, Any]) -> bool:
    try:
        ttl_seconds = max(0, int(os.getenv("PAGE_CACHE_TTL_SECONDS", "3600")))
    except ValueError:
        ttl_seconds = 3600
    if ttl_seconds == 0:
        return False

    updated_at = page.get("updated_at")
    if isinstance(updated_at, str):
        try:
            updated_at = datetime.fromisoformat(updated_at.replace("Z", "+00:00"))
        except ValueError:
            return False
    if not isinstance(updated_at, datetime):
        return False
    if updated_at.tzinfo is None:
        updated_at = updated_at.replace(tzinfo=timezone.utc)
    return 0 <= (datetime.now(timezone.utc) - updated_at).total_seconds() <= ttl_seconds


@router.post(
    "/text-completion",
    response_model=TextCompletionResponse,
    dependencies=[Depends(enforce_api_access)],
)
def text_completion(body: TextCompletionRequest):
    """
    Text completion endpoint for ClearWeb.

    Supports two formats:
    1. **Simple text**: `{"text": "your prompt", "temperature": 0.7}`
    2. **Chat messages**: `{"messages": [{"role": "user", "content": "..."}, ...], "temperature": 0.7}`
    """
    messages = (
        [message.model_dump() for message in body.messages]
        if body.messages is not None
        else [{"role": "user", "content": body.text or ""}]
    )
    response_text, model_used = call_openai_chat(
        messages=messages, temperature=body.temperature
    )
    return TextCompletionResponse(model=model_used, response=response_text)


@router.post(
    "/image-caption",
    response_model=ImageCaptionResponse,
    dependencies=[Depends(enforce_api_access)],
)
def image_caption(req: ImageCaptionRequest):
    """Generate a short accessible caption for an HTTP(S) image."""
    hint = (req.alt_text or "").strip()
    prompt = (
        "Describe this image for a blind or low-vision reader. "
        "Use one or two factual sentences. Do not guess hidden context. "
        + language_instruction(req.language)
    )
    if hint:
        prompt += f" The webpage's existing text hint is: {hint}"
    caption, model_used = call_openai_image_caption(
        image_url=str(req.image_url), prompt=prompt
    )
    return ImageCaptionResponse(model=model_used, caption=caption)
