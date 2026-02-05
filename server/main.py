"""Main FastAPI application for scraper + 3-mode simplifier + contextual chat (language-aware, validated)."""

from __future__ import annotations

import json
import os
import re
from typing import Any, Dict, List, Tuple, Optional

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from models import (
    ChatRequest,
    ChatResponse,
    ScrapRequest,
    ScrapResponse,
    SimplifyRequest,
    SimplifyResponse,
)
from scraper import (
    assert_public_hostname,
    extract_blocks_in_order,
    extract_links_and_images,
    extract_meta,
    fetch_and_parse_html,
    remove_non_content,
    select_root,
)
from firebase_store import (
    db,
    get_page,
    get_simplification,
    page_id_for_url,
    save_page,
    save_simplification,
    sha256_hex,
)


app = FastAPI(title="Scraper + Accessibility Simplifier API")

# Extension-friendly CORS (Authorization header allowed)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:3000",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "http://localhost:5173",
    ],
    allow_origin_regex=r"^chrome-extension://.*$",
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ----------------- OpenAI (OLD endpoint) helpers -----------------

OPENAI_URL = "https://api.openai.com/v1/chat/completions"
DEFAULT_MODEL = "gpt-3.5-turbo-0125"


def get_openai_key() -> str:
    key = (os.getenv("OPENAI_API_KEY") or "").strip()
    if not key:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY is not set in the environment.")
    return key


def get_openai_model() -> str:
    return os.getenv("OPENAI_MODEL", DEFAULT_MODEL)


def call_openai_chat(*, messages: List[Dict[str, str]], temperature: float = 0.2) -> Tuple[str, str]:
    api_key = get_openai_key()
    model = get_openai_model()

    payload = {"model": model, "messages": messages, "temperature": temperature}
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

    try:
        resp = httpx.post(OPENAI_URL, json=payload, headers=headers, timeout=60.0)
        resp.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=exc.response.status_code, detail=exc.response.text) from exc
    except Exception:
        raise HTTPException(status_code=502, detail="OpenAI request failed")

    data = resp.json()
    content = ""
    if data.get("choices"):
        content = data["choices"][0].get("message", {}).get("content", "") or ""
    return content, data.get("model", model)


def parse_json_loose(text: str) -> Dict[str, Any]:
    """
    Tries hard to parse JSON even if the model includes extra text.
    """
    text = text.strip()
    try:
        return json.loads(text)
    except Exception:
        pass

    m = re.search(r"\{.*\}", text, re.DOTALL)
    if not m:
        raise ValueError("Model did not return JSON.")
    return json.loads(m.group(0))


# ----------------- Language helpers -----------------

LANG_NAME = {
    "en": "English",
    "zh": "Simplified Chinese (简体中文)",
    "ms": "Malay (Bahasa Melayu)",
    "ta": "Tamil (தமிழ்)",
}

MALAY_HINT_WORDS = {
    "ini", "untuk", "dan", "yang", "anda", "boleh", "langkah", "dokumen", "permohonan",
    "sila", "perlu", "semak", "senarai", "panduan", "tujuan", "maklumat", "lebih", "lanjut"
}

COMMON_EN_WORDS = {
    "the", "this", "that", "page", "domain", "used", "use", "for", "only", "not", "and",
    "about", "learn", "more", "example", "documentation", "operations"
}

def language_instruction(lang_code: str) -> str:
    lang = LANG_NAME.get(lang_code, "English")
    # IMPORTANT: we enforce value-language only; keys stay English JSON keys.
    base = (
        f"All human-readable TEXT VALUES must be in {lang}. "
        "DO NOT translate JSON keys. Keep JSON keys exactly as provided. "
        "URLs may remain unchanged. Proper nouns may remain unchanged. "
    )
    if lang_code == "ms":
        base += (
            "Avoid English sentences. Use Malay sentence structure. "
            "If you accidentally produce English, rewrite fully into Malay."
        )
    if lang_code == "zh":
        base += "Use Simplified Chinese characters. If you produce English, rewrite into Chinese."
    if lang_code == "ta":
        base += "Use Tamil script characters. If you produce English, rewrite into Tamil."
    return base


def flatten_text(obj: Any) -> str:
    """
    Pull all string values from a nested object into one string (for language heuristics).
    """
    parts: List[str] = []

    def walk(x: Any):
        if x is None:
            return
        if isinstance(x, str):
            parts.append(x)
            return
        if isinstance(x, (int, float, bool)):
            return
        if isinstance(x, list):
            for it in x:
                walk(it)
            return
        if isinstance(x, dict):
            for v in x.values():
                walk(v)

    walk(obj)
    return " ".join(parts)


def language_ok(lang: str, obj: Any) -> bool:
    """
    Lightweight heuristics to ensure output is plausibly in the target language.
    """
    if lang == "en":
        return True

    txt = flatten_text(obj)

    if lang == "zh":
        # Any CJK character
        return bool(re.search(r"[\u4e00-\u9fff]", txt))

    if lang == "ta":
        # Tamil Unicode block
        return bool(re.search(r"[\u0B80-\u0BFF]", txt))

    if lang == "ms":
        low = re.sub(r"[^a-zA-Z\s]", " ", txt).lower()
        words = [w for w in low.split() if w]
        if not words:
            return False
        malay_hits = sum(1 for w in words if w in MALAY_HINT_WORDS)
        en_hits = sum(1 for w in words if w in COMMON_EN_WORDS)

        # Require at least some Malay markers OR very low English markers
        return malay_hits >= 2 or (en_hits <= 3 and len(words) >= 8)

    return True


# ----------------- Schema validation + normalization -----------------

def ensure_dict(x: Any) -> Dict[str, Any]:
    return x if isinstance(x, dict) else {}

def validate_easy_read(obj: Dict[str, Any]) -> Tuple[bool, str]:
    req = ["mode", "about", "key_points", "sections", "important_links", "warnings", "glossary"]
    for k in req:
        if k not in obj:
            return False, f"easy_read missing key: {k}"
    if obj.get("mode") != "easy_read":
        return False, "easy_read.mode must be 'easy_read'"
    if not isinstance(obj.get("key_points"), list):
        return False, "easy_read.key_points must be a list"
    if not isinstance(obj.get("sections"), list):
        return False, "easy_read.sections must be a list"
    return True, "ok"

def normalize_checklist(obj: Dict[str, Any]) -> Dict[str, Any]:
    """
    Some models return { 'checklist': { ... } }.
    We unwrap and enforce keys.
    """
    if "checklist" in obj and isinstance(obj["checklist"], dict):
        obj = obj["checklist"]

    # Ensure mode field exists
    obj = dict(obj)
    obj.setdefault("mode", "checklist")

    # Ensure expected arrays exist
    obj.setdefault("goal", "")
    obj.setdefault("requirements", [])
    obj.setdefault("documents", [])
    obj.setdefault("fees", [])
    obj.setdefault("deadlines", [])
    obj.setdefault("actions", [])
    obj.setdefault("common_mistakes", [])
    return obj

def validate_checklist(obj: Dict[str, Any]) -> Tuple[bool, str]:
    req = ["mode", "goal", "requirements", "documents", "fees", "deadlines", "actions", "common_mistakes"]
    for k in req:
        if k not in obj:
            return False, f"checklist missing key: {k}"
    if obj.get("mode") != "checklist":
        return False, "checklist.mode must be 'checklist'"
    if not isinstance(obj.get("requirements"), list):
        return False, "checklist.requirements must be a list"
    return True, "ok"

def validate_step_by_step(obj: Dict[str, Any]) -> Tuple[bool, str]:
    req = ["mode", "goal", "steps", "finish_check"]
    for k in req:
        if k not in obj:
            return False, f"step_by_step missing key: {k}"
    if obj.get("mode") != "step_by_step":
        return False, "step_by_step.mode must be 'step_by_step'"
    if not isinstance(obj.get("steps"), list):
        return False, "step_by_step.steps must be a list"
    # Validate at least one step item structure (if steps exist)
    if obj["steps"]:
        s0 = obj["steps"][0]
        if not isinstance(s0, dict):
            return False, "step_by_step.steps items must be objects"
        for k in ["step", "title", "what_to_do", "where_to_click"]:
            if k not in s0:
                return False, f"step_by_step.steps[0] missing {k}"
    return True, "ok"


def validate_by_mode(mode: str, obj: Dict[str, Any]) -> Tuple[bool, str, Dict[str, Any]]:
    """
    Returns (ok, reason, normalized_obj)
    """
    obj = ensure_dict(obj)

    if mode == "easy_read":
        obj = dict(obj)
        obj.setdefault("mode", "easy_read")
        ok, reason = validate_easy_read(obj)
        return ok, reason, obj

    if mode == "checklist":
        obj = normalize_checklist(obj)
        ok, reason = validate_checklist(obj)
        return ok, reason, obj

    if mode == "step_by_step":
        obj = dict(obj)
        obj.setdefault("mode", "step_by_step")
        ok, reason = validate_step_by_step(obj)
        return ok, reason, obj

    return False, f"Unknown mode {mode}", obj


# ----------------- Scrape helpers -----------------

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


def blocks_to_text(blocks: List[Dict[str, Any]], max_chars: int = 24_000) -> str:
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


def scrape_url(url: str, session_id: str | None = None) -> Dict[str, Any]:
    from urllib.parse import urlparse
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
    blocks_data = [b.model_dump() if hasattr(b, "model_dump") else b for b in blocks_trim]
    links_data = [l.model_dump() if hasattr(l, "model_dump") else l for l in (links or [])][:40]
    images_data = [i.model_dump() if hasattr(i, "model_dump") else i for i in (images or [])][:20]

    source_text = blocks_to_text(blocks_data)
    source_text_hash = sha256_hex(source_text)

    pid = save_page(
        url=url,
        meta=meta,
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


# ----------------- Mode prompts (STRONGER) -----------------

def pick_important_links(links: List[Dict[str, Any]], max_links: int = 20) -> List[Dict[str, str]]:
    cleaned = []
    for l in links:
        href = (l.get("href") or "").strip()
        text = (l.get("text") or "").strip()
        if not href:
            continue
        if href.startswith("mailto:") or href.startswith("javascript:"):
            continue
        label = text if text else href
        cleaned.append({"label": label[:80], "url": href})
        if len(cleaned) >= max_links:
            break
    return cleaned


def prompt_for_mode(
    mode: str,
    *,
    title: Optional[str],
    source_text: str,
    links: List[Dict[str, str]],
    language: str,
) -> List[Dict[str, str]]:
    """
    IMPORTANT:
    - We do NOT want the model to output 'task', 'output_schema', or 'context'.
    - We want ONLY the JSON object that is an INSTANCE of the schema.
    """
    system = (
        "You are an accessibility assistant. "
        "Rewrite complex webpages into formats that reduce cognitive load. "
        "Return ONLY valid JSON. No markdown. No extra text. "
        "DO NOT include the schema, the task description, or the context in the output. "
        "Output must be a JSON object that MATCHES the schema instance. "
        "Use short sentences and plain language. Prefer bullets and steps. "
        "If jargon appears, define it in a glossary. "
        + language_instruction(language)
    )

    # Shared context chunk:
    ctx = {
        "title": title or "",
        "source_text": source_text,
        "links": links,
    }

    if mode == "easy_read":
        schema = {
            "mode": "easy_read",
            "about": "string",
            "key_points": ["string"],
            "sections": [{"heading": "string", "bullets": ["string"]}],
            "important_links": [{"label": "string", "url": "string"}],
            "warnings": ["string"],
            "glossary": [{"term": "string", "simple": "string"}],
        }

    elif mode == "checklist":
        schema = {
            "mode": "checklist",
            "goal": "string",
            "requirements": [{"item": "string", "details": "string", "required": True}],
            "documents": [{"item": "string", "details": "string"}],
            "fees": [{"item": "string", "amount": "string"}],
            "deadlines": [{"item": "string", "date": "string"}],
            "actions": [{"item": "string", "url": "string"}],
            "common_mistakes": ["string"],
        }

    elif mode == "step_by_step":
        schema = {
            "mode": "step_by_step",
            "goal": "string",
            "steps": [
                {
                    "step": 1,
                    "title": "string",
                    "what_to_do": "string",
                    "where_to_click": "string",
                    "url": None,
                    "tips": ["string"],
                }
            ],
            "finish_check": ["string"],
        }
    else:
        raise ValueError(f"Unknown mode: {mode}")

    user = (
        "CONTEXT (use this to write the output):\n"
        f"{json.dumps(ctx, ensure_ascii=False)}\n\n"
        "OUTPUT SCHEMA (produce an instance of this; do not output the schema itself):\n"
        f"{json.dumps(schema, ensure_ascii=False)}\n\n"
        "REMINDER:\n"
        "- Return ONLY the final JSON object.\n"
        "- Do NOT include any extra keys like task/output_schema/context.\n"
        "- Keep bullets/steps short.\n"
    )

    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]


def generate_mode_output_validated(
    *,
    mode: str,
    title: Optional[str],
    source_text: str,
    links: List[Dict[str, str]],
    language: str,
    max_retries: int = 1,
) -> Tuple[Dict[str, Any], str]:
    """
    Generate JSON, parse, validate schema, validate language; retry once if bad.
    """
    messages = prompt_for_mode(mode, title=title, source_text=source_text, links=links, language=language)

    last_raw = ""
    last_reason = ""

    for attempt in range(max_retries + 1):
        raw, model_used = call_openai_chat(messages=messages, temperature=0.2)
        last_raw = raw

        # Parse
        try:
            obj = parse_json_loose(raw)
        except Exception as e:
            last_reason = f"Invalid JSON: {e}"
            obj = {}

        # Normalize + validate schema
        ok_schema, reason_schema, obj_norm = validate_by_mode(mode, ensure_dict(obj))

        # Validate language
        ok_lang = language_ok(language, obj_norm)
        if not ok_lang:
            # if language fails, we treat as invalid
            reason_lang = f"Wrong language for '{language}'"
        else:
            reason_lang = "ok"

        if ok_schema and ok_lang:
            return obj_norm, model_used

        last_reason = f"{reason_schema}; {reason_lang}"

        # Retry: add a corrective instruction including the previous output
        if attempt < max_retries:
            messages = messages + [
                {"role": "assistant", "content": raw},
                {
                    "role": "user",
                    "content": (
                        "Your previous output was INVALID.\n"
                        f"Problems: {last_reason}\n\n"
                        "Fix it now and return ONLY the corrected JSON object.\n"
                        "Do NOT include the schema, task, or context.\n"
                        + language_instruction(language)
                    ),
                },
            ]

    # If still bad after retries, return a safe minimal fallback object
    fallback = {"mode": mode, "raw": last_raw, "error": last_reason}
    return fallback, get_openai_model()


# ----------------- Routes -----------------

@app.post("/scrap", response_model=ScrapResponse)
def scrap(req: ScrapRequest):
    bundle = scrape_url(str(req.url))
    return ScrapResponse(
        ok=True,
        url=bundle["url"],
        meta=bundle["meta"],
        blocks=bundle["blocks"],
        links=bundle["links"],
        images=bundle["images"],
    )


@app.post("/simplify", response_model=SimplifyResponse)
def simplify(req: SimplifyRequest):
    page = scrape_url(str(req.url), session_id=req.session_id)
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
            cached = get_simplification(
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
            max_retries=1,  # retry once to keep it fast but reliable
        )
        model_used_any = model_used

        sid = save_simplification(
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

    # Always include keys for UI stability
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


def _extract_best_context(
    *,
    source_text: str,
    simpl_output: Any,
    mode: str,
    language: str,
    section_id: Optional[str],
    section_text: Optional[str],
) -> Dict[str, Any]:
    ctx: Dict[str, Any] = {"mode": mode, "language": language}

    if section_text and section_text.strip():
        ctx["focus"] = "section_text"
        ctx["section_text"] = section_text.strip()[:4000]
        if section_id:
            ctx["section_id"] = section_id
        return ctx

    if section_id and isinstance(simpl_output, dict):
        sections = simpl_output.get("sections")
        if isinstance(sections, list):
            for s in sections:
                if not isinstance(s, dict):
                    continue
                heading = str(s.get("heading") or "")
                if heading and heading.strip().lower() == section_id.strip().lower():
                    bullets = s.get("bullets") or []
                    ctx["focus"] = "section_id"
                    ctx["section_id"] = section_id
                    ctx["section_heading"] = heading
                    ctx["section_bullets"] = bullets[:12] if isinstance(bullets, list) else bullets
                    return ctx

    ctx["focus"] = "page_fallback"
    ctx["simplified"] = simpl_output
    ctx["source_text"] = source_text[:8000]
    return ctx


@app.post("/chat", response_model=ChatResponse)
def chat(req: ChatRequest):
    if req.url:
        page_id = page_id_for_url(str(req.url))
        url_str = str(req.url)
    elif req.page_id:
        page_id = req.page_id
        url_str = ""
    else:
        raise HTTPException(status_code=400, detail="Provide url or page_id.")

    page = get_page(page_id=page_id)
    if not page:
        if not req.url:
            raise HTTPException(status_code=404, detail="Page not found. Provide url to scrape.")
        page_bundle = scrape_url(str(req.url), session_id=req.session_id)
        page = get_page(page_id=page_bundle["page_id"]) or page_bundle

    source_text = page.get("source_text", "")
    title = (page.get("meta") or {}).get("title")
    source_hash = page.get("source_text_hash", "")
    page_url = page.get("url") or url_str
    lang = req.language

    # resolve simplification output (language-aware)
    simpl_output = None
    simpl_id = req.simplification_id

    if simpl_id:
        snap = db.collection("simplifications").document(simpl_id).get()
        if getattr(snap, "exists", False):
            simpl_output = (snap.to_dict() or {}).get("output")
    else:
        cached = get_simplification(url=page_url, mode=req.mode, language=lang, source_text_hash=source_hash)
        if cached:
            simpl_output = cached.get("output")
            simpl_id = cached.get("_id")

    # generate on the fly if missing
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
        simpl_id = save_simplification(
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

    best_ctx = _extract_best_context(
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
        + language_instruction(lang) +
        " If asked for steps, respond as numbered steps. "
        "If asked for a checklist, respond as bullet points. "
        "If not sure, say so and suggest what to look for on the page."
    )

    context = {"title": title, "url": page_url, "context": best_ctx}

    messages: List[Dict[str, str]] = [{"role": "system", "content": system}]
    for m in req.history[-6:]:
        messages.append({"role": m.role, "content": m.content})

    messages.append({"role": "user", "content": json.dumps({"question": req.message, "context": context}, ensure_ascii=False)})

    answer, model_used = call_openai_chat(messages=messages, temperature=0.2)

    return ChatResponse(
        ok=True,
        model=model_used,
        answer=answer,
        page_id=page_id,
        simplification_id=simpl_id,
    )


@app.get("/firestore-test")
def firestore_test():
    ref = db.collection("audits").document("test-doc")
    ref.set({"hello": "world"})
    return {"ok": True, "id": "test-doc"}


@app.get("/openai-test")
def openai_test():
    payload = {"model": get_openai_model(), "messages": [{"role": "user", "content": "ping"}]}
    headers = {"Authorization": f"Bearer {get_openai_key()}", "Content-Type": "application/json"}
    resp = httpx.post(OPENAI_URL, json=payload, headers=headers, timeout=20.0)
    resp.raise_for_status()
    data = resp.json()
    text_out = data["choices"][0]["message"]["content"] if data.get("choices") else ""
    return {"ok": True, "model": data.get("model", get_openai_model()), "text": text_out}
