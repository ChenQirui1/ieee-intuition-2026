"""Firebase initialization and Firestore operations."""

from __future__ import annotations

import os
import hashlib
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import firebase_admin
from firebase_admin import credentials
from firebase_admin import firestore as fb_firestore


# ---------------- Mock Firestore (dev only) ----------------

class MockFirestore:
    """Mock Firestore client for local testing without Firebase credentials."""

    def __init__(self):
        self.data: Dict[str, Dict[str, Dict[str, Any]]] = {}

    def collection(self, name: str):
        return MockCollection(name, self.data)


class MockCollection:
    def __init__(self, name: str, data: Dict[str, Dict[str, Dict[str, Any]]]):
        self.name = name
        self.data = data
        self.data.setdefault(name, {})

    def document(self, doc_id: Optional[str] = None):
        if doc_id is None:
            import uuid
            doc_id = str(uuid.uuid4())
        return MockDocument(self.name, doc_id, self.data)

    def add(self, doc: Dict[str, Any]):
        ref = self.document()
        ref.set(doc)
        return ref, ref.id


class MockDocument:
    def __init__(self, collection_name: str, doc_id: str, data: Dict[str, Dict[str, Dict[str, Any]]]):
        self.collection_name = collection_name
        self.id = doc_id
        self.data = data
        self.data.setdefault(collection_name, {})

    def set(self, doc: Dict[str, Any], merge: bool = False):
        col = self.data[self.collection_name]
        if merge and self.id in col and isinstance(col[self.id], dict):
            merged = dict(col[self.id])
            merged.update(doc)
            col[self.id] = merged
        else:
            col[self.id] = doc
        print(f"[MOCK] Saved to {self.collection_name}/{self.id}")

    def get(self) -> Optional[Dict[str, Any]]:
        return self.data.get(self.collection_name, {}).get(self.id)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def server_timestamp(db_obj) -> Any:
    """Use Firestore SERVER_TIMESTAMP for real DB; ISO timestamp for mock."""
    return _now_iso() if isinstance(db_obj, MockFirestore) else fb_firestore.SERVER_TIMESTAMP


# ---------------- Firestore init ----------------

def get_firestore():
    """
    Initializes Firebase Admin (once) and returns a Firestore client.

    - Requires GOOGLE_APPLICATION_CREDENTIALS (service account JSON path).
    - For local-only dev without Firebase, set USE_MOCK_FIREBASE=true.

    NOTE: Do NOT silently fall back to mock unless explicitly requested.
    """
    if os.getenv("USE_MOCK_FIREBASE", "false").lower() == "true":
        return MockFirestore()

    if not firebase_admin._apps:
        cred_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
        if not cred_path:
            raise RuntimeError(
                "GOOGLE_APPLICATION_CREDENTIALS is not set. "
                "Set it to the full path of your Firebase service account JSON, "
                "or set USE_MOCK_FIREBASE=true for local mock."
            )
        firebase_admin.initialize_app(credentials.Certificate(cred_path))

    return fb_firestore.client()


db = get_firestore()


# ---------------- Helpers ----------------

def sha256_hex(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def _dump(x: Any) -> Any:
    return x.model_dump() if hasattr(x, "model_dump") else x


def _trim_list(items: Any, max_items: int = 200, max_total_chars: int = 80_000):
    """Prevent Firestore 1MB doc limit from exploding on large pages."""
    out = []
    total = 0
    for x in (items or [])[:max_items]:
        item = _dump(x)
        s = str(item)
        if total + len(s) > max_total_chars:
            break
        out.append(item)
        total += len(s)
    return out


# ---------------- Save / Fetch ----------------

def save_scrape(
    *,
    url: str,
    meta: Any,
    blocks: Any,
    links: Any,
    images: Any,
    collection: str = "pages",
    session_id: Optional[str] = None,
) -> str:
    """Save a scrape result to Firestore. Returns created doc id."""

    doc: Dict[str, Any] = {
        "url": url,
        "created_at": server_timestamp(db),
        "session_id": session_id,
        "meta": _dump(meta),
        "blocks": _trim_list(blocks, max_items=200, max_total_chars=90_000),
        "links": _trim_list(links, max_items=300, max_total_chars=30_000),
        "images": _trim_list(images, max_items=200, max_total_chars=30_000),
        "ok": True,
    }

    ref = db.collection(collection).document()
    ref.set(doc)
    return ref.id


def get_document(collection: str, doc_id: str) -> Optional[Dict[str, Any]]:
    """Fetch a document dict by id. Works for both real and mock Firestore."""
    if isinstance(db, MockFirestore):
        return db.collection(collection).document(doc_id).get()

    snap = db.collection(collection).document(doc_id).get()
    if not getattr(snap, "exists", False):
        return None
    return snap.to_dict()


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
    """Save an LLM simplification run to Firestore. Returns created doc id."""

    doc: Dict[str, Any] = {
        "page_id": page_id,
        "url": url,
        "source_text_hash": source_text_hash,
        "created_at": server_timestamp(db),
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


def save_metrics(
    *,
    url: str,
    event: str,
    mode: str,
    clicks: int = 0,
    scrollPx: int = 0,
    questions: int = 0,
    durationMs: int = 0,
    page_id: Optional[str] = None,
    simplification_id: Optional[str] = None,
    session_id: Optional[str] = None,
    collection: str = "metrics",
) -> str:
    doc: Dict[str, Any] = {
        "url": url,
        "page_id": page_id,
        "simplification_id": simplification_id,
        "session_id": session_id,
        "event": event,
        "mode": mode,
        "clicks": int(clicks or 0),
        "scrollPx": int(scrollPx or 0),
        "questions": int(questions or 0),
        "durationMs": int(durationMs or 0),
        "created_at": server_timestamp(db),
    }

    ref = db.collection(collection).document()
    ref.set(doc)
    return ref.id
