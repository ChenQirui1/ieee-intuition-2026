"""Firebase initialization and Firestore operations."""

from __future__ import annotations

import os
import hashlib
from typing import Any, Dict, Optional, Tuple

import firebase_admin
from firebase_admin import credentials
from firebase_admin import firestore as fb_firestore


def get_firestore() -> fb_firestore.Client:
    """
    Initializes Firebase Admin (once) and returns a Firestore client.
    Requires GOOGLE_APPLICATION_CREDENTIALS to point to your service-account JSON.
    """
    if not firebase_admin._apps:
        cred_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
        if not cred_path:
            raise RuntimeError(
                "GOOGLE_APPLICATION_CREDENTIALS is not set. "
                "Set it to the full path of your Firebase service account JSON."
            )
        firebase_admin.initialize_app(credentials.Certificate(cred_path))
    return fb_firestore.client()


# Initialize Firestore client (import db from this module)
db = get_firestore()


# ---------------- Small helpers (optional but useful) ----------------

def sha256_hex(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


# ---------------- Firestore save functions for your hackathon ----------------

def save_scrape(
    *,
    url: str,
    meta: Any,
    blocks: Any,
    links: Any,
    images: Any,
    collection: str = "audits",
    session_id: Optional[str] = None,
) -> str:
    """
    Save a scrape result to Firestore. Returns the created doc id.

    - meta/blocks/links/images can be dicts, lists, or Pydantic models.
    - Uses SERVER_TIMESTAMP for created_at.
    """
    def dump(x: Any) -> Any:
        return x.model_dump() if hasattr(x, "model_dump") else x

    doc: Dict[str, Any] = {
        "url": url,
        "created_at": fb_firestore.SERVER_TIMESTAMP,
        "session_id": session_id,
        "meta": dump(meta),
        "blocks": [dump(b) for b in (blocks or [])],
        "links": [dump(l) for l in (links or [])],
        "images": [dump(i) for i in (images or [])],
        "ok": True,
    }

    ref = db.collection(collection).document()
    ref.set(doc)
    return ref.id


def save_simplification(
    *,
    page_id: str,
    url: str,
    source_text_hash: str,
    simplified_text: str,
    mode: str = "easy_read",
    target_reading_level: str = "easy",
    model: str = "unknown",
    collection: str = "simplifications",
    session_id: Optional[str] = None,
    extra_output: Optional[Dict[str, Any]] = None,
) -> str:
    """
    Save an OpenAI simplification run to Firestore. Returns the created doc id.
    """
    doc: Dict[str, Any] = {
        "page_id": page_id,
        "url": url,
        "source_text_hash": source_text_hash,
        "created_at": fb_firestore.SERVER_TIMESTAMP,
        "session_id": session_id,
        "request": {
            "mode": mode,
            "target_reading_level": target_reading_level,
        },
        "llm": {
            "provider": "openai",
            "model": model,
        },
        "output": {
            "simplified_text": simplified_text,
            **(extra_output or {}),
        },
        "status": "success",
        "error": None,
    }

    ref = db.collection(collection).document()
    ref.set(doc)
    return ref.id
