"""Test and utility endpoints."""

from typing import Any, Dict

import httpx
from fastapi import APIRouter, HTTPException

from utils.openai_client import get_openai_key, get_openai_model, call_openai_chat, OPENAI_URL


router = APIRouter()


def _get_db():
    """Get database instance."""
    from main import db
    return db


@router.get("/firestore-test")
def firestore_test():
    """Test endpoint - only works with Firebase database."""
    db = _get_db()
    if hasattr(db, 'db'):
        ref = db.db.collection("audits").document("test-doc")
        ref.set({"hello": "world"})
        return {"ok": True, "id": "test-doc"}
    else:
        return {"ok": False, "message": "Not using Firebase database"}


@router.get("/openai-test")
def openai_test():
    """Test OpenAI API connection."""
    payload = {
        "model": get_openai_model(),
        "messages": [{"role": "user", "content": "ping"}],
    }
    headers = {
        "Authorization": f"Bearer {get_openai_key()}",
        "Content-Type": "application/json",
    }
    resp = httpx.post(OPENAI_URL, json=payload, headers=headers, timeout=20.0)
    resp.raise_for_status()
    data = resp.json()
    text_out = data["choices"][0]["message"]["content"] if data.get("choices") else ""
    return {
        "ok": True,
        "model": data.get("model", get_openai_model()),
        "text": text_out,
    }


@router.post("/text-completion")
def text_completion(body: Dict[str, Any]):
    """
    Text completion endpoint for ClearWeb.
    Supports two formats:
    1. Simple: {"text": "your prompt", "temperature": 0.7}
    2. Chat: {"messages": [{"role": "user", "content": "..."}, ...], "temperature": 0.7}
    """
    temperature = body.get("temperature", 0.7)

    if "messages" in body:
        messages = body.get("messages", [])
        if not messages:
            raise HTTPException(
                status_code=400, detail="'messages' array cannot be empty"
            )

        for msg in messages:
            if not isinstance(msg, dict) or "role" not in msg or "content" not in msg:
                raise HTTPException(
                    status_code=400,
                    detail="Each message must have 'role' and 'content'",
                )

        response_text, model_used = call_openai_chat(
            messages=messages, temperature=temperature
        )

    elif "text" in body:
        text = body.get("text", "").strip()
        if not text:
            raise HTTPException(status_code=400, detail="'text' field is required")

        messages = [{"role": "user", "content": text}]
        response_text, model_used = call_openai_chat(
            messages=messages, temperature=temperature
        )

    else:
        raise HTTPException(
            status_code=400, detail="Either 'text' or 'messages' field is required"
        )

    return {"ok": True, "model": model_used, "response": response_text}
