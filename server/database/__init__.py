"""Database package - provides database abstraction layer."""

from database.interface import DatabaseInterface, page_id_for_url, simplification_id_for
from database.firebase_database import FirebaseDatabase
from database.mongodb_database import MongoDatabase
from database.config import get_database

__all__ = [
    "DatabaseInterface",
    "FirebaseDatabase",
    "MongoDatabase",
    "get_database",
    "page_id_for_url",
    "simplification_id_for",
]
