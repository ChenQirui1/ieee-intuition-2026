"""
Firebase/Firestore database implementation.

This module implements the DatabaseInterface using Firebase/Firestore.
"""

from __future__ import annotations

import json
import os
from typing import Any, Dict, Optional
from datetime import datetime, timezone

import firebase_admin
from firebase_admin import credentials
from firebase_admin import firestore as fb_firestore

from database.interface import DatabaseInterface, page_id_for_url, simplification_id_for


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
    def __init__(
        self, collection_name: str, doc_id: str, store: Dict[str, Dict[str, Any]]
    ):
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


# ---------------- Firestore utilities ----------------


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _server_timestamp(db) -> Any:
    """Real Firestore uses SERVER_TIMESTAMP; mock uses ISO string."""
    return (
        _now_iso() if isinstance(db, MockFirestore) else fb_firestore.SERVER_TIMESTAMP
    )


def _ensure_firestore_compatible(data: Any) -> Any:
    """
    Recursively convert data to Firestore-compatible format.
    Firestore has strict requirements:
    - No nested Pydantic models
    - Arrays must contain only primitives or simple dicts
    - All values must be JSON-serializable
    """
    if data is None:
        return None

    # Handle Pydantic models
    if hasattr(data, "model_dump"):
        data = data.model_dump(mode="json")

    # Handle dictionaries
    if isinstance(data, dict):
        return {k: _ensure_firestore_compatible(v) for k, v in data.items()}

    # Handle lists/tuples
    if isinstance(data, (list, tuple)):
        return [_ensure_firestore_compatible(item) for item in data]

    # Handle primitives (str, int, float, bool)
    if isinstance(data, (str, int, float, bool)):
        return data

    # Handle datetime objects
    if hasattr(data, "isoformat"):
        return data.isoformat()

    # Fallback: convert to string
    try:
        # Try JSON serialization as a test
        json.dumps(data)
        return data
    except (TypeError, ValueError):
        return str(data)


# ---------------- Firebase Database Implementation ----------------


class FirebaseDatabase(DatabaseInterface):
    """Firebase/Firestore implementation of the database interface."""

    def __init__(self):
        """Initialize Firebase connection."""
        self.db = self._get_firestore()

    def _get_firestore(self):
        """
        Initializes Firebase Admin (once) and returns a Firestore client.

        Supports three methods (in order of priority):
        1. USE_MOCK_FIREBASE=true -> Use mock Firestore (local dev)
        2. FIREBASE_SERVICE_ACCOUNT -> JSON string with credentials (production)
        3. GOOGLE_APPLICATION_CREDENTIALS -> Path to JSON file (local dev)
        """
        if os.getenv("USE_MOCK_FIREBASE", "false").lower() == "true":
            print("[Firebase] Using mock Firestore (in-memory)")
            return MockFirestore()

        if not firebase_admin._apps:
            # Method 1: JSON string from environment variable (production)
            service_account_json = os.getenv("FIREBASE_SERVICE_ACCOUNT")
            if service_account_json:
                try:
                    service_account_dict = json.loads(service_account_json)
                    cred = credentials.Certificate(service_account_dict)
                    firebase_admin.initialize_app(cred)
                    print(
                        "[Firebase] Initialized from FIREBASE_SERVICE_ACCOUNT environment variable"
                    )
                except json.JSONDecodeError as e:
                    raise RuntimeError(
                        f"FIREBASE_SERVICE_ACCOUNT is not valid JSON: {e}"
                    )
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

    def save_page(
        self,
        *,
        page_id: str,
        url: str,
        meta: Dict[str, Any],
        blocks: list,
        links: list,
        images: list,
        source_text: str,
        source_text_hash: str,
        session_id: Optional[str] = None,
    ) -> str:
        """Save a page to Firestore."""
        doc: Dict[str, Any] = {
            "url": url,
            "session_id": session_id,
            "status": "ready",
            "meta": _ensure_firestore_compatible(meta),
            "blocks": _ensure_firestore_compatible(blocks),
            "links": _ensure_firestore_compatible(links),
            "images": _ensure_firestore_compatible(images),
            "source_text": source_text,
            "source_text_hash": source_text_hash,
            "updated_at": _server_timestamp(self.db),
        }

        self.db.collection("pages").document(page_id).set(doc, merge=True)
        return page_id

    def get_page(self, *, page_id: str) -> Optional[Dict[str, Any]]:
        """Retrieve a page from Firestore."""
        snap = self.db.collection("pages").document(page_id).get()
        if not getattr(snap, "exists", False):
            return None
        return snap.to_dict()

    def save_simplification(
        self,
        *,
        simplification_id: str,
        url: str,
        page_id: str,
        source_text_hash: str,
        mode: str,
        language: str,
        output: Dict[str, Any],
        model: str,
        session_id: Optional[str] = None,
    ) -> str:
        """Save a simplification to Firestore."""
        doc: Dict[str, Any] = {
            "url": url,
            "page_id": page_id,
            "source_text_hash": source_text_hash,
            "mode": mode,
            "language": language,
            "session_id": session_id,
            "llm": {"provider": "openai", "model": model},
            "output": _ensure_firestore_compatible(output),
            "status": "success",
            "error": None,
            "updated_at": _server_timestamp(self.db),
        }

        self.db.collection("simplifications").document(simplification_id).set(
            doc, merge=True
        )
        return simplification_id

    def get_simplification(
        self, *, simplification_id: str
    ) -> Optional[Dict[str, Any]]:
        """Retrieve a simplification from Firestore."""
        snap = self.db.collection("simplifications").document(simplification_id).get()
        if not getattr(snap, "exists", False):
            return None
        data = snap.to_dict() or {}
        data["_id"] = simplification_id
        return data

    def find_simplification(
        self,
        *,
        url: str,
        mode: str,
        language: str,
        source_text_hash: str,
    ) -> Optional[Dict[str, Any]]:
        """Find a simplification by URL, mode, language, and source hash."""
        sid = simplification_id_for(
            url=url, mode=mode, language=language, source_text_hash=source_text_hash
        )
        return self.get_simplification(simplification_id=sid)
