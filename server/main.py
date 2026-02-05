"""Main FastAPI application for the web scraper + accessibility overlay endpoints."""

from __future__ import annotations

import json
import os
import re
import time
from typing import Any, Dict, List, Optional, Tuple

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from models import (
    AnalyzeRequest,
    AnalyzeResponse,
    AccessibleResponse,
    SimplifyRequest,
    SimplifyResponse,
    SimplifiedSection,
    WizardStep,
    GlossaryItem,
    ChatRequest,
    ChatResponse,
    MetricsRequest,
    MetricsResponse,
)
from scraper import (
    assert_public_hostname,
    extract_meta,
    extract_blocks_in_order,
    extract_links_and_images,
    remove_non_content,
    select_root,
    fetch_and_parse_html,
)
from firebase_store import (
    db,
    save_scrape,
    save_simplification,
    save_metrics,
    sha256_hex,
    get_document,
)


app = FastAPI(title="Scraper API")

# Hackathon/dev: allow the extension + localhost UIs to call your API.
# Tighten this for production.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------- Utilities ----------------

OPENAI_URL = "https://api.openai.com/v1/chat/completions"  # keep your existing endpoint
DEFAULT_MODEL = "gpt-3.5-turbo"  # keep your existing default


def _safe_trim_blocks(blocks: List[Any], max_blocks: int = 200, max_total_chars: int = 80_000):
    """Prevent massive pages from exceeding Firestore doc limits."""
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


def _dump_list(objs: List[Any], limit: int) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for x in (objs or [])[:limit]:
        if isinstance(x, dict):
            out.append(x)
        elif hasattr(x, "model_dump"):
            out.append(x.model_dump())
    return out


def _blocks_to_plain_text(blocks_data: List[Dict[str, Any]], max_chars: int = 12_000) -> str:
    parts: List[str] = []
    for b in blocks_data:
        t = b.get("type")
        if t in ("heading", "paragraph", "quote", "code") and b.get("text"):
            parts.append(str(b["text"]))
        elif t == "list" and b.get("items"):
            parts.extend([f"- {i}" for i in b.get("items", []) if i])
        elif t == "table":
            headers = b.get("headers") or []
            rows = b.get("rows") or []
            if headers:
                parts.append(" | ".join(headers))
            for r in rows[:5]:
                parts.append(" | ".join([str(c) for c in r]))
        if sum(len(p) for p in parts) >= max_chars:
            break
    text = "\n".join(parts)
    return text[:max_chars]


def _openai_chat(messages: List[Dict[str, str]], *, model: Optional[str] = None, timeout: float = 35.0) -> Tuple[str, str]:
    """Call OpenAI Chat Completions and return (content, resolved_model)."""
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY is not set in the environment.")

    chosen_model = os.getenv("OPENAI_MODEL", model or DEFAULT_MODEL)

    payload = {
        "model": chosen_model,
        "messages": messages,
        "temperature": 0.2,
    }
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

    try:
        resp = httpx.post(OPENAI_URL, json=payload, headers=headers, timeout=timeout)
        resp.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=exc.response.status_code, detail=exc.response.text) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"OpenAI request failed: {exc}") from exc

    data = resp.json()
    content = ""
    if "choices" in data and data["choices"]:
        content = data["choices"][0].get("message", {}).get("content", "") or ""
    return content, data.get("model", chosen_model)


_JSON_RE = re.compile(r"\{.*\}", re.DOTALL)


def _parse_json_best_effort(text: str) -> Dict[str, Any]:
    """Best-effort parse: try full json, else extract first {...}."""
    try:
        return json.loads(text)
    except Exception:
        m = _JSON_RE.search(text)
        if not m:
            raise ValueError("No JSON object found in model output")
        return json.loads(m.group(0))


def _scrape(url: str):
    """Scrape and return (meta, blocks, links, images) + jsonable versions."""
    parsed_host = httpx.URL(url).host
    if not parsed_host:
        raise HTTPException(status_code=400, detail="Invalid URL")
    assert_public_hostname(parsed_host)

    try:
        soup = fetch_and_parse_html(url)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to fetch/parse HTML: {e}")

    meta = extract_meta(soup, url)

    remove_non_content(soup)
    root = select_root(soup)

    blocks = extract_blocks_in_order(root)
    links, images = extract_links_and_images(root, url)

    blocks_data = []
    for block in _safe_trim_blocks(blocks, max_blocks=80, max_total_chars=90_000):
        if isinstance(block, dict):
            blocks_data.append(block)
        elif hasattr(block, "model_dump"):
            blocks_data.append(block.model_dump())
        else:
            blocks_data.append(block)

    links_data = _dump_list(links, limit=30)
    images_data = _dump_list(images, limit=20)

    return meta, blocks, links, images, blocks_data, links_data, images_data


# ---------------- Existing endpoints (kept) ----------------

@app.post("/analyze", response_model=AnalyzeResponse)
def analyze(req: AnalyzeRequest):
    """Scrape a URL and immediately get an AI summary."""
    meta, blocks, links, images, blocks_data, links_data, images_data = _scrape(str(req.url))

    try:
        save_scrape(
            url=str(req.url),
            meta=meta,
            blocks=blocks_data,
            links=links_data,
            images=images_data,
            collection="pages",
        )
    except Exception:
        pass

    context = {
        "url": str(req.url),
        "metadata": meta.model_dump() if hasattr(meta, "model_dump") else {},
        "content_blocks": blocks_data[:50],
    }

    system_prompt = (
        "You are an expert content analyst and summarizer. "
        "Write a clear, well-structured summary with key points."
    )

    if req.question:
        user_prompt = (
            "Analyze the content and answer the user's question.\n\n"
            f"CONTENT:\n{json.dumps(context)}\n\n"
            f"QUESTION: {req.question}\n\n"
            "Return:\n1) Summary\n2) Direct answer to the question"
        )
    else:
        user_prompt = (
            "Analyze and summarize the content.\n\n"
            f"CONTENT:\n{json.dumps(context)}\n\n"
            "Return a detailed summary with key points."
        )

    summary, resolved_model = _openai_chat(
        [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]
    )

    return AnalyzeResponse(
        ok=True,
        url=str(req.url),
        title=meta.title,
        description=meta.description,
        blocks_count=len(blocks),
        summary=summary,
        question=req.question,
        model=resolved_model,
    )


def _extract_key_facts(blocks) -> List[str]:
    facts: List[str] = []
    for block in blocks[:60]:
        if isinstance(block, dict):
            block_type = block.get("type", "")
            text = block.get("text", "") or ""
        else:
            block_type = getattr(block, "type", "")
            text = getattr(block, "text", "") or ""

        if block_type in ["paragraph", "quote", "heading"] and text:
            clean = text.strip()
            if 30 <= len(clean) <= 400:
                facts.append(clean)
                if len(facts) >= 5:
                    break
    return facts[:5]


def _extract_sections(blocks) -> List[str]:
    sections: List[str] = []
    for block in blocks:
        if isinstance(block, dict):
            block_type = block.get("type", "")
            text = block.get("text", "") or ""
            level = block.get("level", 0) or 0
        else:
            block_type = getattr(block, "type", "")
            text = getattr(block, "text", "") or ""
            level = getattr(block, "level", 0) or 0

        if block_type == "heading" and level in (1, 2) and text:
            sections.append(text)
    return sections[:6]


def _estimate_read_time(text: str) -> int:
    words = len(text.split())
    return max(1, round(words / 200))


def _assess_readability(blocks) -> str:
    total_blocks = len(blocks)
    complex_count = 0
    for block in blocks:
        t = block.get("type") if isinstance(block, dict) else getattr(block, "type", "")
        if t == "table":
            complex_count += 2
    ratio = complex_count / max(1, total_blocks)
    if ratio > 0.3:
        return "complex"
    if ratio > 0.15:
        return "moderate"
    return "easy"


@app.post("/accessible", response_model=AccessibleResponse)
def accessible(req: AnalyzeRequest):
    """Accessibility-optimized endpoint (kept)."""
    meta, blocks, links, images, blocks_data, links_data, images_data = _scrape(str(req.url))

    main_sections = _extract_sections(blocks)
    key_facts = _extract_key_facts(blocks)
    readability_level = _assess_readability(blocks)

    try:
        save_scrape(
            url=str(req.url),
            meta=meta,
            blocks=blocks_data,
            links=links_data,
            images=images_data,
            collection="pages",
        )
    except Exception:
        pass

    context = {
        "url": str(req.url),
        "metadata": {
            "title": meta.title,
            "description": meta.description,
            "language": meta.lang,
        },
        "key_sections": main_sections,
        "content_blocks": blocks_data[:50],
    }

    system_prompt_simple = (
        "You are an accessibility expert and content simplifier. "
        "Use simple words, short sentences, and clear lists. "
        "Write at 8th-grade reading level or lower."
    )

    system_prompt_detailed = (
        "You are an expert content analyst and summarizer. "
        "Provide a comprehensive summary with key points."
    )

    simple_prompt = (
        "Simplify this content into easy-to-understand language.\n\n"
        f"CONTENT:\n{json.dumps(context)}\n\n"
        "Return a clear, simple summary with bullets."
    )

    detailed_prompt = (
        "Summarize this content comprehensively.\n\n"
        f"CONTENT:\n{json.dumps(context)}\n\n"
        "Return a detailed summary with key points."
    )

    summary_simple, resolved_model = _openai_chat(
        [
            {"role": "system", "content": system_prompt_simple},
            {"role": "user", "content": simple_prompt},
        ]
    )

    summary_detailed, _ = _openai_chat(
        [
            {"role": "system", "content": system_prompt_detailed},
            {"role": "user", "content": detailed_prompt},
        ]
    )

    read_time = _estimate_read_time(summary_simple)

    has_tables = any(
        (b.get("type") == "table") if isinstance(b, dict) else (getattr(b, "type", "") == "table")
        for b in blocks
    )

    return AccessibleResponse(
        ok=True,
        url=str(req.url),
        title=meta.title,
        main_sections=main_sections,
        key_facts=key_facts,
        readability_level=readability_level,
        summary_simple=summary_simple,
        summary_detailed=summary_detailed,
        estimated_read_time_minutes=read_time,
        has_images=len(images) > 0,
        has_tables=has_tables,
        model=resolved_model,
    )


# ---------------- New endpoints for the extension ----------------

@app.post("/simplify", response_model=SimplifyResponse)
def simplify(req: SimplifyRequest):
    """
    Adaptive simplification endpoint for your browser extension overlay.

    Returns structured JSON (sections/checklist/steps/glossary) so the UI can render different modes.
    """
    t0 = time.time()
    meta, blocks, links, images, blocks_data, links_data, images_data = _scrape(str(req.url))

    # Save the scrape and get page_id for future chat/metrics
    page_id = ""
    try:
        page_id = save_scrape(
            url=str(req.url),
            meta=meta,
            blocks=blocks_data,
            links=links_data,
            images=images_data,
            collection="pages",
            session_id=req.session_id,
        )
    except Exception:
        page_id = sha256_hex(str(req.url))

    source_text = _blocks_to_plain_text(blocks_data, max_chars=12_000)
    source_text_hash = sha256_hex(source_text)

    compact_context = {
        "url": str(req.url),
        "title": meta.title,
        "description": meta.description,
        "language": meta.lang,
        "content": source_text,
    }

    system_prompt = (
        "You are an accessibility expert. "
        "You rewrite complex web pages to reduce cognitive load. "
        "Return ONLY valid JSON. No markdown, no extra text."
    )

    user_prompt = f"""Create an ADAPTIVE simplified representation of the page.
The output MUST be a single JSON object with this schema:

{{
  "title": string|null,
  "tldr": string,
  "sections": [
    {{
      "id": string,
      "heading": string,
      "easy_read": [string, ...],
      "key_points": [string, ...]
    }}
  ],
  "checklist": [string, ...],
  "steps": [{{"step": number, "text": string}}, ...],
  "glossary": [{{"term": string, "definition": string}}, ...],
  "warnings": [string, ...]
}}

Rules:
- Use simple words (8th grade or lower), short sentences.
- Prefer bullets/checklists.
- Steps must be actionable and in order.
- If something is missing, put it in warnings.

PAGE:
{json.dumps(compact_context)}
"""

    raw_json_text, resolved_model = _openai_chat(
        [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        timeout=40.0,
    )

    try:
        out = _parse_json_best_effort(raw_json_text)
    except Exception:
        out = {
            "title": meta.title,
            "tldr": raw_json_text.strip()[:800],
            "sections": [
                {
                    "id": "summary",
                    "heading": "Summary",
                    "easy_read": [raw_json_text.strip()],
                    "key_points": [],
                }
            ],
            "checklist": [],
            "steps": [],
            "glossary": [],
            "warnings": ["Model output was not valid JSON; used fallback."],
        }

    title = out.get("title") or meta.title
    tldr = out.get("tldr") or ""

    sections_in = out.get("sections") or []
    sections: List[SimplifiedSection] = []
    for idx, s in enumerate(sections_in):
        if not isinstance(s, dict):
            continue
        sid = str(s.get("id") or f"sec_{idx}")
        heading = str(s.get("heading") or "Section")
        easy_read = [str(x) for x in (s.get("easy_read") or []) if x]
        key_points = [str(x) for x in (s.get("key_points") or []) if x]
        sections.append(SimplifiedSection(id=sid, heading=heading, easy_read=easy_read, key_points=key_points))

    checklist = [str(x) for x in (out.get("checklist") or []) if x]

    steps_in = out.get("steps") or []
    steps: List[WizardStep] = []
    for i, st in enumerate(steps_in):
        if isinstance(st, dict):
            step_num = int(st.get("step") or (i + 1))
            text = str(st.get("text") or "").strip()
        else:
            step_num = i + 1
            text = str(st).strip()
        if text:
            steps.append(WizardStep(step=step_num, text=text))

    glossary_in = out.get("glossary") or []
    glossary: List[GlossaryItem] = []
    for g in glossary_in:
        if isinstance(g, dict) and g.get("term") and g.get("definition"):
            glossary.append(GlossaryItem(term=str(g["term"]), definition=str(g["definition"])))

    warnings = [str(x) for x in (out.get("warnings") or []) if x]

    # Save simplification (best-effort)
    simplification_id: Optional[str] = None
    try:
        simplified_text_for_storage = "\n".join(
            [tldr] + [p for sec in sections for p in sec.easy_read[:2]]
        ).strip()[:4000]

        simplification_id = save_simplification(
            page_id=page_id,
            url=str(req.url),
            source_text_hash=source_text_hash,
            simplified_text=simplified_text_for_storage,
            mode=req.mode,
            target_reading_level="easy",
            model=resolved_model,
            session_id=req.session_id,
            extra_output={
                "tldr": tldr,
                "sections": [s.model_dump() for s in sections],
                "checklist": checklist,
                "steps": [s.model_dump() for s in steps],
                "glossary": [g.model_dump() for g in glossary],
                "warnings": warnings,
                "timing_ms": int((time.time() - t0) * 1000),
            },
        )
    except Exception:
        pass

    return SimplifyResponse(
        ok=True,
        url=str(req.url),
        page_id=page_id,
        simplification_id=simplification_id,
        mode=req.mode,
        title=title,
        tldr=tldr,
        sections=sections,
        checklist=checklist,
        steps=steps,
        glossary=glossary,
        warnings=warnings,
        model=resolved_model,
    )


@app.post("/chat", response_model=ChatResponse)
def chat(req: ChatRequest):
    """Contextual Q&A for the extension chatbot."""

    page_doc = None
    if req.page_id:
        try:
            page_doc = get_document("pages", req.page_id)
        except Exception:
            page_doc = None

    blocks_data: List[Dict[str, Any]] = []
    meta_title: Optional[str] = None
    meta_desc: Optional[str] = None
    lang: Optional[str] = None

    if page_doc:
        meta = page_doc.get("meta") or {}
        meta_title = meta.get("title")
        meta_desc = meta.get("description")
        lang = meta.get("lang")
        blocks_data = page_doc.get("blocks") or []
    else:
        meta, _blocks, _links, _images, blocks_data, _ld, _id = _scrape(str(req.url))
        meta_title, meta_desc, lang = meta.title, meta.description, meta.lang

    source_text = _blocks_to_plain_text(blocks_data, max_chars=8_000)

    context = {
        "url": str(req.url),
        "title": meta_title,
        "description": meta_desc,
        "language": lang,
        "mode": req.mode,
        "section_id": req.section_id,
        "content": source_text,
    }

    system_prompt = (
        "You are an accessibility assistant helping a user understand a web page. "
        "Use simple words, short sentences, and be direct. "
        "If the user asks for steps or a checklist, format as numbered steps or bullet points."
    )

    user_prompt = (
        f"CONTEXT:\n{json.dumps(context)}\n\n"
        f"USER QUESTION: {req.question}\n\n"
        "Answer in a helpful, easy-to-read way."
    )

    answer, resolved_model = _openai_chat(
        [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        timeout=35.0,
    )

    try:
        save_metrics(
            url=str(req.url),
            page_id=req.page_id,
            simplification_id=req.simplification_id,
            session_id=req.session_id,
            event="asked_question",
            mode=req.mode,
            questions=1,
        )
    except Exception:
        pass

    return ChatResponse(ok=True, answer=answer, model=resolved_model)


@app.post("/metrics", response_model=MetricsResponse)
def metrics(req: MetricsRequest):
    """Store lightweight UX metrics for before/after judging."""
    try:
        mid = save_metrics(
            url=str(req.url),
            page_id=req.page_id,
            simplification_id=req.simplification_id,
            session_id=req.session_id,
            event=req.event,
            mode=req.mode,
            clicks=req.clicks,
            scrollPx=req.scrollPx,
            questions=req.questions,
            durationMs=req.durationMs,
        )
        return MetricsResponse(ok=True, id=mid)
    except Exception:
        return MetricsResponse(ok=True, id=None)


# ---------------- Tests ----------------

@app.get("/firestore-test")
def firestore_test():
    """Quick test route to verify Firestore connectivity."""
    ref = db.collection("audits").document()
    ref.set({"hello": "world"})
    return {"ok": True, "id": ref.id}


@app.get("/openai-test")
def openai_test():
    """Quick test route to verify OpenAI API connectivity."""
    text_out, resolved_model = _openai_chat([{"role": "user", "content": "ping"}], timeout=20.0)
    return {"ok": True, "model": resolved_model, "text": text_out}
