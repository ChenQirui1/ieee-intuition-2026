"""Language utilities for multilingual support."""

from typing import Any, List
import re


LANG_NAME = {
    "en": "English",
    "zh": "Simplified Chinese (简体中文)",
    "ms": "Malay (Bahasa Melayu)",
    "ta": "Tamil (தமிழ்)",
}

MALAY_HINT_WORDS = {
    "ini",
    "untuk",
    "dan",
    "yang",
    "anda",
    "boleh",
    "langkah",
    "dokumen",
    "permohonan",
    "sila",
    "perlu",
    "semak",
    "senarai",
    "panduan",
    "tujuan",
    "maklumat",
    "lebih",
    "lanjut",
}

COMMON_EN_WORDS = {
    "the",
    "this",
    "that",
    "page",
    "domain",
    "used",
    "use",
    "for",
    "only",
    "not",
    "and",
    "about",
    "learn",
    "more",
    "example",
    "documentation",
    "operations",
}


def language_instruction(lang_code: str) -> str:
    """Generate language instruction for LLM prompts."""
    lang = LANG_NAME.get(lang_code, "English")
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
        base += (
            "Use Tamil script characters. If you produce English, rewrite into Tamil."
        )
    return base


def flatten_text(obj: Any) -> str:
    """Pull all string values from a nested object into one string."""
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
    """Lightweight heuristics to ensure output is in the target language."""
    if lang == "en":
        return True

    txt = flatten_text(obj)

    if lang == "zh":
        return bool(re.search(r"[\u4e00-\u9fff]", txt))

    if lang == "ta":
        return bool(re.search(r"[\u0B80-\u0BFF]", txt))

    if lang == "ms":
        low = re.sub(r"[^a-zA-Z\s]", " ", txt).lower()
        words = [w for w in low.split() if w]
        if not words:
            return False
        malay_hits = sum(1 for w in words if w in MALAY_HINT_WORDS)
        en_hits = sum(1 for w in words if w in COMMON_EN_WORDS)
        return malay_hits >= 2 or (en_hits <= 3 and len(words) >= 8)

    return True
