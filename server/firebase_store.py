"""Firebase initialization + Firestore operations for pages + simplifications (language-aware)."""

from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple

import firebase_admin
from firebase_admin import credentials
from firebase_admin import firestore as fb_firestore


# ---------------- Mock Firestore (local dev only) ----------------

class MockDocSnap:
    def __init__(self, doc_id: str, data: Optional[Dict[str, Any]]):
        self.id = doc_id
        self._data = data

    @property
    def exists(self) -> bool:
        return self._data is not None

    def to_dict(self) -> Optional[Dict[str, Any]]:
        return self._data


class MockDocument:
    def __init__(self, collection_name: str, doc_id: str, store: Dict[str, Dict[str, Any]]):
        self.collection_name = collection_name
        self.id = doc_id
        self.store = store

    def set(self, data: Dict[str, Any], merge: bool = False):
        col = self.store.setdefault(self.collection_name, {})
        if merge and self.id in col and isinstance(col[self.id], dict):
            merged = dict(col[self.id])
            merged.update(data)
            col[self.id] = merged
        else:
            col[self.id] = data

    def get(self) -> MockDocSnap:
        col = self.store.setdefault(self.collection_name, {})
        return MockDocSnap(self.id, col.get(self.id))


class MockCollection:
    def __init__(self, name: str, store: Dict[str, Dict[str, Any]]):
        self.name = name
        self.store = store

    def document(self, doc_id: str):
        return MockDocument(self.name, doc_id, self.store)


class MockFirestore:
    def __init__(self):
        self.store: Dict[str, Dict[str, Any]] = {}

    def collection(self, name: str) -> MockCollection:
        return MockCollection(name, self.store)


# ---------------- Firestore init ----------------

def get_firestore():
    """
    Initializes Firebase Admin (once) and returns a Firestore client.

    Supports three methods (in order of priority):
    1. USE_MOCK_FIREBASE=true -> Use mock Firestore (local dev)
    2. FIREBASE_SERVICE_ACCOUNT -> JSON string with credentials (production)
    3. GOOGLE_APPLICATION_CREDENTIALS -> Path to JSON file (local dev)
    """
    if os.getenv("USE_MOCK_FIREBASE", "false").lower() == "true":
        return MockFirestore()

    if not firebase_admin._apps:
        # Method 1: JSON string from environment variable (production)
        service_account_json = os.getenv("FIREBASE_SERVICE_ACCOUNT")
        if service_account_json:
            try:
                service_account_dict = json.loads(service_account_json)
                cred = credentials.Certificate(service_account_dict)
                firebase_admin.initialize_app(cred)
                print("[Firebase] Initialized from FIREBASE_SERVICE_ACCOUNT environment variable")
            except json.JSONDecodeError as e:
                raise RuntimeError(f"FIREBASE_SERVICE_ACCOUNT is not valid JSON: {e}")
        else:
            # Method 2: File path from environment variable (local dev)
            cred_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
            if not cred_path:
                raise RuntimeError(
                    "Firebase credentials not found. Set one of:\n"
                    "  - FIREBASE_SERVICE_ACCOUNT (JSON string, for production)\n"
                    "  - GOOGLE_APPLICATION_CREDENTIALS (file path, for local dev)\n"
                    "  - USE_MOCK_FIREBASE=true (for local dev without Firebase)"
                )
            firebase_admin.initialize_app(credentials.Certificate(cred_path))
            print(f"[Firebase] Initialized from file: {cred_path}")

    return fb_firestore.client()


db = get_firestore()


# ---------------- Utilities ----------------

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def server_timestamp() -> Any:
    """Real Firestore uses SERVER_TIMESTAMP; mock uses ISO string."""
    return _now_iso() if isinstance(db, MockFirestore) else fb_firestore.SERVER_TIMESTAMP


def sha256_hex(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def dump(x: Any) -> Any:
    return x.model_dump() if hasattr(x, "model_dump") else x


# ---------------- Deterministic IDs ----------------

def page_id_for_url(url: str) -> str:
    return sha256_hex(url)


def simplification_id_for(*, url: str, mode: str, language: str, source_text_hash: str) -> str:
    return sha256_hex(f"{url}|{mode}|{language}|{source_text_hash}")


# ---------------- Pages ----------------

def get_or_create_page(
    *,
    url: str,
    session_id: Optional[str] = None,
    collection: str = "pages",
) -> Tuple[str, Optional[Dict[str, Any]]]:
    """
    Returns deterministic page_id for url.
    If doc missing, creates a placeholder doc and returns it.
    """
    page_id = page_id_for_url(url)
    ref = db.collection(collection).document(page_id)
    snap = ref.get()

    if getattr(snap, "exists", False):
        return page_id, snap.to_dict()

    placeholder: Dict[str, Any] = {
        "url": url,
        "session_id": session_id,
        "status": "placeholder",
        "created_at": server_timestamp(),
        "updated_at": server_timestamp(),
    }
    ref.set(placeholder, merge=True)
    return page_id, placeholder


def save_page(
    *,
    url: str,
    meta: Any,
    blocks: Any,
    links: Any,
    images: Any,
    source_text: str,
    source_text_hash: str,
    session_id: Optional[str] = None,
    collection: str = "pages",
) -> str:
    page_id = page_id_for_url(url)

    doc: Dict[str, Any] = {
        "url": url,
        "session_id": session_id,
        "status": "ready",
        "meta": dump(meta),
        "blocks": [dump(b) for b in (blocks or [])],
        "links": [dump(l) for l in (links or [])],
        "images": [dump(i) for i in (images or [])],
        "source_text": source_text,
        "source_text_hash": source_text_hash,
        "updated_at": server_timestamp(),
    }

    db.collection(collection).document(page_id).set(doc, merge=True)
    return page_id


def get_page(*, page_id: str, collection: str = "pages") -> Optional[Dict[str, Any]]:
    snap = db.collection(collection).document(page_id).get()
    if not getattr(snap, "exists", False):
        return None
    return snap.to_dict()


# ---------------- Simplifications (cached per mode+language+hash) ----------------

def get_simplification(
    *,
    url: str,
    mode: str,
    language: str,
    source_text_hash: str,
    collection: str = "simplifications",
) -> Optional[Dict[str, Any]]:
    sid = simplification_id_for(url=url, mode=mode, language=language, source_text_hash=source_text_hash)
    snap = db.collection(collection).document(sid).get()
    if not getattr(snap, "exists", False):
        return None
    data = snap.to_dict() or {}
    data["_id"] = sid
    return data


def save_simplification(
    *,
    url: str,
    page_id: str,
    source_text_hash: str,
    mode: str,
    language: str,
    output: Dict[str, Any],
    model: str,
    session_id: Optional[str] = None,
    collection: str = "simplifications",
) -> str:
    sid = simplification_id_for(url=url, mode=mode, language=language, source_text_hash=source_text_hash)

    doc: Dict[str, Any] = {
        "url": url,
        "page_id": page_id,
        "source_text_hash": source_text_hash,
        "mode": mode,
        "language": language,
        "session_id": session_id,
        "llm": {"provider": "openai", "model": model},
        "output": output,
        "status": "success",
        "error": None,
        "updated_at": server_timestamp(),
    }

    db.collection(collection).document(sid).set(doc, merge=True)
    return sid
