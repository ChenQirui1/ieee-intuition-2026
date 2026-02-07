"""Schema validation and normalization utilities."""

from typing import Any, Dict, Tuple


def ensure_dict(x: Any) -> Dict[str, Any]:
    """Ensure value is a dictionary."""
    return x if isinstance(x, dict) else {}


def validate_easy_read(obj: Dict[str, Any]) -> Tuple[bool, str]:
    """Validate easy_read mode schema."""
    req = [
        "mode",
        "about",
        "key_points",
        "sections",
        "important_links",
        "warnings",
        "glossary",
    ]
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
    """Normalize checklist schema (unwrap nested structure)."""
    if "checklist" in obj and isinstance(obj["checklist"], dict):
        obj = obj["checklist"]

    obj = dict(obj)
    obj.setdefault("mode", "checklist")
    obj.setdefault("goal", "")
    obj.setdefault("requirements", [])
    obj.setdefault("documents", [])
    obj.setdefault("fees", [])
    obj.setdefault("deadlines", [])
    obj.setdefault("actions", [])
    obj.setdefault("common_mistakes", [])
    return obj


def validate_checklist(obj: Dict[str, Any]) -> Tuple[bool, str]:
    """Validate checklist mode schema."""
    req = [
        "mode",
        "goal",
        "requirements",
        "documents",
        "fees",
        "deadlines",
        "actions",
        "common_mistakes",
    ]
    for k in req:
        if k not in obj:
            return False, f"checklist missing key: {k}"
    if obj.get("mode") != "checklist":
        return False, "checklist.mode must be 'checklist'"
    if not isinstance(obj.get("requirements"), list):
        return False, "checklist.requirements must be a list"
    return True, "ok"


def validate_step_by_step(obj: Dict[str, Any]) -> Tuple[bool, str]:
    """Validate step_by_step mode schema."""
    req = ["mode", "goal", "steps", "finish_check"]
    for k in req:
        if k not in obj:
            return False, f"step_by_step missing key: {k}"
    if obj.get("mode") != "step_by_step":
        return False, "step_by_step.mode must be 'step_by_step'"
    if not isinstance(obj.get("steps"), list):
        return False, "step_by_step.steps must be a list"
    if obj["steps"]:
        s0 = obj["steps"][0]
        if not isinstance(s0, dict):
            return False, "step_by_step.steps items must be objects"
        for k in ["step", "title", "what_to_do", "where_to_click"]:
            if k not in s0:
                return False, f"step_by_step.steps[0] missing {k}"
    return True, "ok"


def validate_by_mode(
    mode: str, obj: Dict[str, Any]
) -> Tuple[bool, str, Dict[str, Any]]:
    """Validate and normalize object by mode. Returns (ok, reason, normalized_obj)."""
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
