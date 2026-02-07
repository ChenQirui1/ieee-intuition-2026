"""Simplification service - handles intelligent content simplification."""

import json
from typing import Any, Dict, List, Optional, Tuple

from utils.openai_client import call_openai_chat, parse_json_loose, get_openai_model
from utils.language import language_instruction, language_ok


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


def create_simplification_prompt(
    *,
    title: Optional[str],
    source_text: str,
    links: List[Dict[str, str]],
    language: str,
) -> List[Dict[str, str]]:
    """Generate prompt for intelligent simplification with optional checklist."""
    system = (
        "You are an accessibility assistant that simplifies complex web content. "
        "Analyze the content and decide if it's procedural (forms, applications, step-by-step guides). "
        "Return ONLY valid JSON. No markdown. No extra text. "
        "Use short sentences and plain language. "
        + language_instruction(language)
    )

    ctx = {
        "title": title or "",
        "source_text": source_text,
        "links": links,
    }

    schema = {
        "summary": {
            "about": "Brief overview of what this page is about",
            "key_points": ["Main points in simple language"],
            "important_links": [{"label": "Link text", "url": "URL"}],
            "warnings": ["Important warnings or cautions"],
            "glossary": [{"term": "Technical term", "simple": "Simple explanation"}]
        },
        "checklist": {
            "_note": "Include this ONLY if content is procedural (forms, applications, how-to guides). Set to null otherwise.",
            "has_checklist": "boolean - true if procedural, false if not",
            "goal": "What the user is trying to accomplish",
            "requirements": [{"item": "Requirement name", "details": "Details", "required": True}],
            "documents": [{"item": "Document name", "details": "Why needed"}],
            "steps": [
                {
                    "step": 1,
                    "title": "Step title",
                    "what_to_do": "Clear instructions",
                    "where_to_click": "Where to find it",
                    "url": "Direct link or null",
                    "tips": ["Helpful tips"]
                }
            ],
            "common_mistakes": ["Things to avoid"]
        }
    }

    user = (
        "ANALYZE THIS CONTENT:\n"
        f"{json.dumps(ctx, ensure_ascii=False)}\n\n"
        "OUTPUT SCHEMA:\n"
        f"{json.dumps(schema, ensure_ascii=False)}\n\n"
        "INSTRUCTIONS:\n"
        "1. ALWAYS include 'summary' section with all fields\n"
        "2. Determine if content is PROCEDURAL:\n"
        "   - Forms, applications, registrations → YES\n"
        "   - Step-by-step guides, tutorials → YES\n"
        "   - General information, articles → NO\n"
        "3. If PROCEDURAL: include 'checklist' with has_checklist=true and all fields\n"
        "4. If NOT PROCEDURAL: set 'checklist' to null OR has_checklist=false\n"
        "5. Keep language simple and clear\n"
        "6. Return ONLY the JSON object\n\n"
        + language_instruction(language)
    )

    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]


def validate_simplification(obj: Dict[str, Any]) -> Tuple[bool, str]:
    """Validate the new unified simplification schema."""
    # Check summary section (required)
    if "summary" not in obj:
        return False, "Missing required 'summary' section"

    summary = obj["summary"]
    if not isinstance(summary, dict):
        return False, "'summary' must be an object"

    required_summary_fields = ["about", "key_points", "important_links", "warnings", "glossary"]
    for field in required_summary_fields:
        if field not in summary:
            return False, f"summary missing required field: {field}"

    # Validate summary field types
    if not isinstance(summary.get("key_points"), list):
        return False, "summary.key_points must be a list"
    if not isinstance(summary.get("important_links"), list):
        return False, "summary.important_links must be a list"
    if not isinstance(summary.get("warnings"), list):
        return False, "summary.warnings must be a list"
    if not isinstance(summary.get("glossary"), list):
        return False, "summary.glossary must be a list"

    # Check checklist section (optional)
    if "checklist" in obj and obj["checklist"] is not None:
        checklist = obj["checklist"]
        if not isinstance(checklist, dict):
            return False, "'checklist' must be an object or null"

        # If checklist exists, validate has_checklist field
        if "has_checklist" in checklist:
            if checklist["has_checklist"] is True:
                # If has_checklist is true, validate required fields
                required_checklist_fields = ["goal", "requirements", "documents", "steps", "common_mistakes"]
                for field in required_checklist_fields:
                    if field not in checklist:
                        return False, f"checklist missing required field: {field}"

                # Validate checklist field types
                if not isinstance(checklist.get("steps"), list):
                    return False, "checklist.steps must be a list"
                if not isinstance(checklist.get("requirements"), list):
                    return False, "checklist.requirements must be a list"

    return True, "ok"


def generate_simplification(
    *,
    title: Optional[str],
    source_text: str,
    links: List[Dict[str, str]],
    language: str,
    max_retries: int = 1,
) -> Tuple[Dict[str, Any], str]:
    """Generate intelligent simplification with optional checklist."""
    messages = create_simplification_prompt(
        title=title, source_text=source_text, links=links, language=language
    )

    last_raw = ""
    last_reason = ""

    for attempt in range(max_retries + 1):
        raw, model_used = call_openai_chat(messages=messages, temperature=0.2)
        last_raw = raw

        # Parse JSON
        try:
            obj = parse_json_loose(raw)
        except Exception as e:
            last_reason = f"Invalid JSON: {e}"
            obj = {}

        # Validate schema
        ok_schema, reason_schema = validate_simplification(obj)

        # Validate language
        ok_lang = language_ok(language, obj)
        if not ok_lang:
            reason_lang = f"Wrong language for '{language}'"
        else:
            reason_lang = "ok"

        if ok_schema and ok_lang:
            return obj, model_used

        last_reason = f"{reason_schema}; {reason_lang}"

        # Retry with correction
        if attempt < max_retries:
            messages = messages + [
                {"role": "assistant", "content": raw},
                {
                    "role": "user",
                    "content": (
                        "Your previous output was INVALID.\n"
                        f"Problems: {last_reason}\n\n"
                        "Fix it now and return ONLY the corrected JSON object.\n"
                        "Remember: summary is REQUIRED, checklist is OPTIONAL.\n"
                        + language_instruction(language)
                    ),
                },
            ]

    # Fallback
    fallback = {
        "summary": {
            "about": "Error processing content",
            "key_points": ["Unable to simplify content"],
            "important_links": [],
            "warnings": ["Processing error occurred"],
            "glossary": []
        },
        "checklist": None,
        "error": last_reason,
        "raw": last_raw
    }
    return fallback, get_openai_model()


def extract_best_context(
    *,
    source_text: str,
    simpl_output: Any,
    language: str,
    section_id: Optional[str],
    section_text: Optional[str],
) -> Dict[str, Any]:
    """Extract the best context for chat based on section focus."""
    ctx: Dict[str, Any] = {"language": language}

    if section_text and section_text.strip():
        ctx["focus"] = "section_text"
        ctx["section_text"] = section_text.strip()[:4000]
        if section_id:
            ctx["section_id"] = section_id
        return ctx

    # Use simplified content if available
    if isinstance(simpl_output, dict):
        ctx["focus"] = "simplified"
        ctx["simplified"] = simpl_output
        ctx["source_text"] = source_text[:8000]
        return ctx

    ctx["focus"] = "page_fallback"
    ctx["source_text"] = source_text[:8000]
    return ctx
