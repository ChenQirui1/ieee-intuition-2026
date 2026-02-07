"""OpenAI API client utilities."""

import json
import os
import re
from typing import Any, Dict, List, Tuple

import httpx
from fastapi import HTTPException


OPENAI_URL = "https://api.openai.com/v1/chat/completions"
DEFAULT_MODEL = "gpt-3.5-turbo-0125"


def get_openai_key() -> str:
    """Get OpenAI API key from environment."""
    key = (os.getenv("OPENAI_API_KEY") or "").strip()
    if not key:
        raise HTTPException(
            status_code=500, detail="OPENAI_API_KEY is not set in the environment."
        )
    return key


def get_openai_model() -> str:
    """Get OpenAI model from environment or use default."""
    return os.getenv("OPENAI_MODEL", DEFAULT_MODEL)


def call_openai_chat(
    *, messages: List[Dict[str, str]], temperature: float = 0.2
) -> Tuple[str, str]:
    """Call OpenAI chat completion API. Returns (content, model_used)."""
    api_key = get_openai_key()
    model = get_openai_model()

    payload = {"model": model, "messages": messages, "temperature": temperature}
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

    try:
        resp = httpx.post(OPENAI_URL, json=payload, headers=headers, timeout=60.0)
        resp.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=exc.response.status_code, detail=exc.response.text
        ) from exc
    except Exception:
        raise HTTPException(status_code=502, detail="OpenAI request failed")

    data = resp.json()
    content = ""
    if data.get("choices"):
        content = data["choices"][0].get("message", {}).get("content", "") or ""
    return content, data.get("model", model)


def parse_json_loose(text: str) -> Dict[str, Any]:
    """Parse JSON even if the model includes extra text."""
    text = text.strip()
    try:
        return json.loads(text)
    except Exception:
        pass

    m = re.search(r"\{.*\}", text, re.DOTALL)
    if not m:
        raise ValueError("Model did not return JSON.")
    return json.loads(m.group(0))
