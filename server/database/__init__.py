"""Database package - provides database abstraction layer."""

from database.interface import DatabaseInterface, page_id_for_url, simplification_id_for
from database.firebase_database import FirebaseDatabase

__all__ = [
    "DatabaseInterface",
    "FirebaseDatabase",
    "page_id_for_url",
    "simplification_id_for",
]
