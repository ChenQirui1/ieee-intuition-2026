"""
MongoDB database implementation.

This module implements the DatabaseInterface using MongoDB.
"""

from __future__ import annotations

import os
from typing import Any, Dict, Optional
from datetime import datetime, timezone

from pymongo import MongoClient
from pymongo.errors import ConnectionFailure

from database.interface import DatabaseInterface, page_id_for_url, simplification_id_for


class MongoDatabase(DatabaseInterface):
    """MongoDB implementation of the database interface."""

    def __init__(self, connection_string: Optional[str] = None):
        """
        Initialize MongoDB connection.

        Args:
            connection_string: MongoDB connection string. If not provided,
                             reads from MONGODB_URL environment variable.
        """
        self.connection_string = connection_string or os.getenv("MONGODB_URL")

        if not self.connection_string:
            raise RuntimeError(
                "MongoDB connection string not found. Set MONGODB_URL environment variable "
                "or pass connection_string parameter."
            )

        # Initialize MongoDB client
        self.client = MongoClient(self.connection_string)

        # Test connection
        try:
            self.client.admin.command('ping')
            print("[MongoDB] Connected successfully")
        except ConnectionFailure as e:
            raise RuntimeError(f"Failed to connect to MongoDB: {e}")

        # Get database (extract from connection string or use default)
        db_name = self._extract_db_name() or "clearweb"
        self.db = self.client[db_name]

        # Collections
        self.pages = self.db["pages"]
        self.simplifications = self.db["simplifications"]

        # Create indexes for better performance
        self._create_indexes()

        print(f"[MongoDB] Using database: {db_name}")

    def _extract_db_name(self) -> Optional[str]:
        """Extract database name from connection string."""
        try:
            # MongoDB connection string format: mongodb://.../<dbname>?...
            if "/" in self.connection_string:
                parts = self.connection_string.split("/")
                if len(parts) > 3:
                    db_part = parts[-1].split("?")[0]
                    if db_part:
                        return db_part
        except Exception:
            pass
        return None

    def _create_indexes(self):
        """Create indexes for better query performance."""
        # Index on URL for pages
        self.pages.create_index("url")

        # Compound index for simplifications lookup
        self.simplifications.create_index([
            ("url", 1),
            ("mode", 1),
            ("language", 1),
            ("source_text_hash", 1)
        ])

    def _now_iso(self) -> str:
        """Get current timestamp in ISO format."""
        return datetime.now(timezone.utc).isoformat()

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
        """Save a page to MongoDB."""
        doc: Dict[str, Any] = {
            "_id": page_id,  # Use page_id as MongoDB _id
            "url": url,
            "session_id": session_id,
            "status": "ready",
            "meta": meta,
            "blocks": blocks,
            "links": links,
            "images": images,
            "source_text": source_text,
            "source_text_hash": source_text_hash,
            "updated_at": self._now_iso(),
        }

        # Upsert (insert or update)
        self.pages.replace_one(
            {"_id": page_id},
            doc,
            upsert=True
        )

        return page_id

    def get_page(self, *, page_id: str) -> Optional[Dict[str, Any]]:
        """Retrieve a page from MongoDB."""
        doc = self.pages.find_one({"_id": page_id})
        if not doc:
            return None

        # Remove MongoDB's _id from the returned dict (we use page_id)
        doc.pop("_id", None)
        return doc

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
        """Save a simplification to MongoDB."""
        doc: Dict[str, Any] = {
            "_id": simplification_id,  # Use simplification_id as MongoDB _id
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
            "updated_at": self._now_iso(),
        }

        # Upsert (insert or update)
        self.simplifications.replace_one(
            {"_id": simplification_id},
            doc,
            upsert=True
        )

        return simplification_id

    def get_simplification(
        self, *, simplification_id: str
    ) -> Optional[Dict[str, Any]]:
        """Retrieve a simplification from MongoDB."""
        doc = self.simplifications.find_one({"_id": simplification_id})
        if not doc:
            return None

        # Add _id as a field for compatibility
        doc["_id"] = simplification_id
        return doc

    def find_simplification(
        self,
        *,
        url: str,
        mode: str,
        language: str,
        source_text_hash: str,
    ) -> Optional[Dict[str, Any]]:
        """Find a simplification by URL, mode, language, and source hash."""
        # Generate the deterministic ID
        sid = simplification_id_for(
            url=url, mode=mode, language=language, source_text_hash=source_text_hash
        )
        return self.get_simplification(simplification_id=sid)

    def close(self):
        """Close MongoDB connection."""
        if self.client:
            self.client.close()
            print("[MongoDB] Connection closed")
