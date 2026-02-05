"""Firebase initialization and Firestore operations."""

from __future__ import annotations

import os
import hashlib
from typing import Any, Dict, Optional, Tuple

import firebase_admin
from firebase_admin import credentials
from firebase_admin import firestore as fb_firestore


class MockFirestore:
    """Mock Firestore client for local testing without Firebase credentials."""
    def __init__(self):
        self.data = {}
    
    def collection(self, name):
        return MockCollection(name, self.data)
    
    def transaction(self):
        return None


class MockCollection:
    """Mock Firestore collection."""
    def __init__(self, name, data):
        self.name = name
        self.data = data
        if name not in self.data:
            self.data[name] = {}
    
    def document(self, doc_id=None):
        if doc_id is None:
            import uuid
            doc_id = str(uuid.uuid4())
        return MockDocument(self.name, doc_id, self.data)


class MockDocument:
    """Mock Firestore document."""
    def __init__(self, collection_name, doc_id, data):
        self.collection_name = collection_name
        self.id = doc_id
        self.data = data
    
    def set(self, data):
        if self.collection_name not in self.data:
            self.data[self.collection_name] = {}
        self.data[self.collection_name][self.id] = data
        print(f"[MOCK] Saved to {self.collection_name}/{self.id}: {data}")


def get_firestore() -> fb_firestore.Client:
    """
    Initializes Firebase Admin (once) and returns a Firestore client.
    Requires GOOGLE_APPLICATION_CREDENTIALS to point to your service-account JSON.
    Set USE_MOCK_FIREBASE=true to use mock Firestore for local testing.
    """
    if os.getenv("USE_MOCK_FIREBASE", "false").lower() == "true":
        return MockFirestore()
    
    if not firebase_admin._apps:
        cred_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
        if not cred_path:
            print("WARNING: GOOGLE_APPLICATION_CREDENTIALS not set. Using mock Firestore.")
            return MockFirestore()
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
