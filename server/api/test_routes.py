"""Test and utility endpoints."""

import httpx
from fastapi import APIRouter, Depends

from api.security import enforce_api_access
from database.firebase_database import FirebaseDatabase
from utils.openai_client import (
    OPENAI_URL,
    get_openai_key,
    get_openai_model,
)

router = APIRouter(dependencies=[Depends(enforce_api_access)])


def _get_db():
    """Get database instance."""
    from main import db

    return db


@router.get("/firestore-test")
def firestore_test():
    """Test endpoint - only works with Firebase database."""
    db = _get_db()
    if isinstance(db, FirebaseDatabase):
        ref = db.db.collection("audits").document("test-doc")
        ref.set({"hello": "world"})
        return {"ok": True, "id": "test-doc"}
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
