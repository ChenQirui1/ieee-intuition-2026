"""API routes for scraping, simplification, and chat endpoints."""

import json
from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException

from models.models import (
    ChatRequest,
    ChatResponse,
    ScrapRequest,
    ScrapResponse,
    SimplifyRequest,
    SimplifyResponse,
)
from database.interface import page_id_for_url, simplification_id_for
from services.scraping import scrape_url
from services.simplification import (
    pick_important_links,
    generate_mode_output_validated,
    extract_best_context,
)
from utils.openai_client import call_openai_chat, get_openai_model
from utils.language import language_instruction


router = APIRouter()


def _get_db():
    """Get database instance (imported at module level to avoid circular imports)."""
    from main import db
    return db


@router.post("/scrap", response_model=ScrapResponse)
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


@router.post("/simplify", response_model=SimplifyResponse)
def simplify(req: SimplifyRequest):
    """Simplify a webpage into accessible formats."""
    db = _get_db()
    page = scrape_url(str(req.url), db, session_id=req.session_id)
    print("Scraped page:", page["page_id"], page["url"])

    title = (page["meta"] or {}).get("title")
    source_hash = page["source_text_hash"]
    lang = req.language

    important_links = pick_important_links(page["links"])

    wanted_modes = ["easy_read", "checklist", "step_by_step"]
    if req.mode != "all":
        wanted_modes = [req.mode]

    outputs: Dict[str, Any] = {}
    simpl_ids: Dict[str, str] = {}
    model_used_any = get_openai_model()

    for mode in wanted_modes:
        if not req.force_regen:
            cached = db.find_simplification(
                url=page["url"],
                mode=mode,
                language=lang,
                source_text_hash=source_hash,
            )
            if cached and cached.get("output"):
                outputs[mode] = cached["output"]
                simpl_ids[mode] = cached.get("_id", "")
                model_used_any = (cached.get("llm") or {}).get("model", model_used_any)
                continue

        out, model_used = generate_mode_output_validated(
            mode=mode,
            title=title,
            source_text=page["source_text"],
            links=important_links,
            language=lang,
            max_retries=1,
        )
        model_used_any = model_used

        sid = simplification_id_for(
            url=page["url"],
            mode=mode,
            language=lang,
            source_text_hash=source_hash,
        )
        db.save_simplification(
            simplification_id=sid,
            url=page["url"],
            page_id=page["page_id"],
            source_text_hash=source_hash,
            mode=mode,
            language=lang,
            output=out,
            model=model_used,
            session_id=req.session_id,
        )
        outputs[mode] = out
        simpl_ids[mode] = sid

    for m in ["easy_read", "checklist", "step_by_step"]:
        outputs.setdefault(m, None)
        simpl_ids.setdefault(m, "")

    return SimplifyResponse(
        ok=True,
        url=page["url"],
        page_id=page["page_id"],
        source_text_hash=source_hash,
        language=req.language,
        model=model_used_any,
        outputs=outputs,
        simplification_ids=simpl_ids,
    )


@router.post("/chat", response_model=ChatResponse)
def chat(req: ChatRequest):
    """Chat with context about a simplified page."""
    db = _get_db()

    if req.url:
        page_id = page_id_for_url(str(req.url))
        url_str = str(req.url)
    elif req.page_id:
        page_id = req.page_id
        url_str = ""
    else:
        raise HTTPException(status_code=400, detail="Provide url or page_id.")

    page = db.get_page(page_id=page_id)
    if not page:
        if not req.url:
            raise HTTPException(
                status_code=404, detail="Page not found. Provide url to scrape."
            )
        page_bundle = scrape_url(str(req.url), db, session_id=req.session_id)
        page = db.get_page(page_id=page_bundle["page_id"]) or page_bundle

    source_text = page.get("source_text", "")
    title = (page.get("meta") or {}).get("title")
    source_hash = page.get("source_text_hash", "")
    page_url = page.get("url") or url_str
    lang = req.language

    simpl_output = None
    simpl_id = req.simplification_id

    if simpl_id:
        simpl_data = db.get_simplification(simplification_id=simpl_id)
        if simpl_data:
            simpl_output = simpl_data.get("output")
    else:
        cached = db.find_simplification(
            url=page_url, mode=req.mode, language=lang, source_text_hash=source_hash
        )
        if cached:
            simpl_output = cached.get("output")
            simpl_id = cached.get("_id")

    if simpl_output is None and page_url:
        important_links = pick_important_links(page.get("links", []))
        out, model_used = generate_mode_output_validated(
            mode=req.mode,
            title=title,
            source_text=source_text,
            links=important_links,
            language=lang,
            max_retries=1,
        )
        sid = simplification_id_for(
            url=page_url,
            mode=req.mode,
            language=lang,
            source_text_hash=source_hash,
        )
        db.save_simplification(
            simplification_id=sid,
            url=page_url,
            page_id=page_id,
            source_text_hash=source_hash,
            mode=req.mode,
            language=lang,
            output=out,
            model=model_used,
            session_id=req.session_id,
        )
        simpl_output = out
        simpl_id = sid

    best_ctx = extract_best_context(
        source_text=source_text,
        simpl_output=simpl_output,
        mode=req.mode,
        language=lang,
        section_id=req.section_id,
        section_text=req.section_text,
    )

    system = (
        "You are a helpful accessibility assistant embedded in a browser extension. "
        "Answer using only the provided context. "
        "Use very simple language. Short sentences. "
        + language_instruction(lang)
        + " If asked for steps, respond as numbered steps. "
        "If asked for a checklist, respond as bullet points. "
        "If not sure, say so and suggest what to look for on the page."
    )

    context = {"title": title, "url": page_url, "context": best_ctx}

    messages: List[Dict[str, str]] = [{"role": "system", "content": system}]
    for m in req.history[-6:]:
        messages.append({"role": m.role, "content": m.content})

    messages.append(
        {
            "role": "user",
            "content": json.dumps(
                {"question": req.message, "context": context}, ensure_ascii=False
            ),
        }
    )

    answer, model_used = call_openai_chat(messages=messages, temperature=0.2)

    return ChatResponse(
        ok=True,
        model=model_used,
        answer=answer,
        page_id=page_id,
        simplification_id=simpl_id,
    )
