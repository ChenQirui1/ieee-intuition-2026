"""OpenAI API client utilities."""

import json
import os
import re
from typing import Any

import httpx
from fastapi import HTTPException

OPENAI_URL = "https://api.openai.com/v1/chat/completions"
DEFAULT_MODEL = "gpt-5.6-luna"


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
    return (os.getenv("OPENAI_MODEL") or DEFAULT_MODEL).strip()


def _call_completion(
    *, model: str, messages: list[dict[str, Any]], temperature: float, max_tokens: int
) -> tuple[str, str]:
    payload: dict[str, Any] = {
        "model": model,
        "messages": messages,
        (
            "max_tokens" if model.startswith("gpt-3.5") else "max_completion_tokens"
        ): max_tokens,
    }
    # Luna supports image input and non-reasoning completions. Avoid sampling
    # options on reasoning models; keep them for existing GPT-3.5/4 overrides.
    if model.startswith("gpt-5.6"):
        payload["reasoning_effort"] = "none"
    elif not model.startswith(("gpt-5", "gpt-6", "o1", "o3", "o4")):
        payload["temperature"] = temperature
    headers = {
        "Authorization": f"Bearer {get_openai_key()}",
        "Content-Type": "application/json",
    }
    try:
        resp = httpx.post(OPENAI_URL, json=payload, headers=headers, timeout=60.0)
        resp.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"OpenAI returned HTTP {exc.response.status_code}. Check the server model, API key, and quota.",
        ) from exc
    except httpx.TimeoutException as exc:
        raise HTTPException(status_code=504, detail="OpenAI request timed out") from exc
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail="OpenAI request failed") from exc
    try:
        data = resp.json()
        content = data["choices"][0]["message"]["content"]
        if not isinstance(content, str) or not content.strip():
            raise ValueError("Empty completion")
        if data["choices"][0].get("finish_reason") == "length":
            raise ValueError("Truncated completion")
        return content.strip(), data.get("model", model)
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        raise HTTPException(
            status_code=502,
            detail="OpenAI returned an incomplete response. Please try again.",
        ) from exc


def call_openai_chat(
    *, messages: list[dict[str, str]], temperature: float = 0.2
) -> tuple[str, str]:
    """Call OpenAI chat completion API. Returns (content, model_used)."""
    return _call_completion(
        model=get_openai_model(),
        messages=messages,
        temperature=temperature,
        max_tokens=4096,
    )


def call_openai_image_caption(*, image_url: str, prompt: str) -> tuple[str, str]:
    """Ask the configured vision-capable model for an accessible image caption."""
    model = (os.getenv("OPENAI_VISION_MODEL") or DEFAULT_MODEL).strip()
    return _call_completion(
        model=model,
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": image_url}},
                ],
            }
        ],
        temperature=0.2,
        max_tokens=4096,
    )


def parse_json_loose(text: str) -> dict[str, Any]:
    """Parse JSON even if the model includes extra text."""
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    m = re.search(r"\{.*\}", text, re.DOTALL)
    if not m:
        raise ValueError("Model did not return JSON.")
    return json.loads(m.group(0))
