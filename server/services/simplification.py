"""Simplification service - handles all simplification logic."""

import json
from typing import Any, Dict, List, Optional, Tuple

from utils.openai_client import call_openai_chat, parse_json_loose, get_openai_model
from utils.language import language_instruction, language_ok
from utils.validation import validate_by_mode, ensure_dict


def pick_important_links(
    links: List[Dict[str, Any]], max_links: int = 20
) -> List[Dict[str, str]]:
    """Extract important links from page links."""
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
    """Generate prompt messages for a specific simplification mode."""
    system = (
        "You are an accessibility assistant. "
        "Rewrite complex webpages into formats that reduce cognitive load. "
        "Return ONLY valid JSON. No markdown. No extra text. "
        "DO NOT include the schema, the task description, or the context in the output. "
        "Output must be a JSON object that MATCHES the schema instance. "
        "Use short sentences and plain language. Prefer bullets and steps. "
        "If jargon appears, define it in a glossary. " + language_instruction(language)
    )

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
    """Generate and validate simplification output. Returns (output, model_used)."""
    messages = prompt_for_mode(
        mode, title=title, source_text=source_text, links=links, language=language
    )

    last_raw = ""
    last_reason = ""

    for attempt in range(max_retries + 1):
        raw, model_used = call_openai_chat(messages=messages, temperature=0.2)
        last_raw = raw

        try:
            obj = parse_json_loose(raw)
        except Exception as e:
            last_reason = f"Invalid JSON: {e}"
            obj = {}

        ok_schema, reason_schema, obj_norm = validate_by_mode(mode, ensure_dict(obj))
        ok_lang = language_ok(language, obj_norm)

        if not ok_lang:
            reason_lang = f"Wrong language for '{language}'"
        else:
            reason_lang = "ok"

        if ok_schema and ok_lang:
            return obj_norm, model_used

        last_reason = f"{reason_schema}; {reason_lang}"

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

    fallback = {"mode": mode, "raw": last_raw, "error": last_reason}
    return fallback, get_openai_model()


def extract_best_context(
    *,
    source_text: str,
    simpl_output: Any,
    mode: str,
    language: str,
    section_id: Optional[str],
    section_text: Optional[str],
) -> Dict[str, Any]:
    """Extract the best context for chat based on section focus."""
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
                    ctx["section_bullets"] = (
                        bullets[:12] if isinstance(bullets, list) else bullets
                    )
                    return ctx

    ctx["focus"] = "page_fallback"
    ctx["simplified"] = simpl_output
    ctx["source_text"] = source_text[:8000]
    return ctx
