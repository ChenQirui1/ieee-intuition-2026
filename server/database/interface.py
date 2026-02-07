"""
Database abstraction layer for ClearWeb backend.

This module defines the interface that any database implementation must follow.
You can implement this interface for different databases (Firebase, PostgreSQL, MongoDB, etc.)
"""

from abc import ABC, abstractmethod
from typing import Any, Dict, Optional
from datetime import datetime


class DatabaseInterface(ABC):
    """Abstract base class for database operations."""

    @abstractmethod
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
        """
        Save a scraped page to the database.

        Returns: page_id
        """
        pass

    @abstractmethod
    def get_page(self, *, page_id: str) -> Optional[Dict[str, Any]]:
        """
        Retrieve a page by its ID.

        Returns: Page data dict or None if not found
        """
        pass

    @abstractmethod
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
        """
        Save a simplification result to the database.

        Returns: simplification_id
        """
        pass

    @abstractmethod
    def get_simplification(
        self,
        *,
        simplification_id: str,
    ) -> Optional[Dict[str, Any]]:
        """
        Retrieve a simplification by its ID.

        Returns: Simplification data dict or None if not found
        """
        pass

    @abstractmethod
    def find_simplification(
        self,
        *,
        url: str,
        mode: str,
        language: str,
        source_text_hash: str,
    ) -> Optional[Dict[str, Any]]:
        """
        Find a simplification by URL, mode, language, and source hash.
        Used for caching - returns existing simplification if found.

        Returns: Simplification data dict or None if not found
        """
        pass


def page_id_for_url(url: str) -> str:
    """Generate deterministic page ID from URL."""
    import hashlib
    return hashlib.sha256(url.encode("utf-8")).hexdigest()


def simplification_id_for(
    *, url: str, mode: str, language: str, source_text_hash: str
) -> str:
    """Generate deterministic simplification ID."""
    import hashlib
    key = f"{url}|{mode}|{language}|{source_text_hash}"
    return hashlib.sha256(key.encode("utf-8")).hexdigest()
