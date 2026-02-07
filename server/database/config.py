"""Database configuration and factory."""

import os
from typing import Literal

from database.interface import DatabaseInterface
from database.firebase_database import FirebaseDatabase
from database.mongodb_database import MongoDatabase


DatabaseType = Literal["firebase", "mongodb", "mock"]


def get_database(db_type: DatabaseType = None) -> DatabaseInterface:
    """
    Factory function to get the appropriate database implementation.

    Args:
        db_type: Type of database to use. If None, reads from DATABASE_TYPE env var.
                 Options: "firebase", "mongodb", "mock"

    Returns:
        DatabaseInterface implementation

    Environment Variables:
        DATABASE_TYPE: "firebase" | "mongodb" | "mock" (default: "firebase")

        For Firebase:
            - FIREBASE_SERVICE_ACCOUNT: JSON string with credentials (production)
            - GOOGLE_APPLICATION_CREDENTIALS: Path to JSON file (local dev)
            - USE_MOCK_FIREBASE: "true" to use mock (local dev)

        For MongoDB:
            - MONGODB_URL: MongoDB connection string (required)
    """
    if db_type is None:
        db_type = os.getenv("DATABASE_TYPE", "firebase").lower()

    if db_type == "mongodb":
        print("[Database] Using MongoDB")
        return MongoDatabase()

    elif db_type == "firebase":
        print("[Database] Using Firebase")
        return FirebaseDatabase()

    elif db_type == "mock":
        print("[Database] Using Mock Firebase (in-memory)")
        # Use Firebase with mock mode
        os.environ["USE_MOCK_FIREBASE"] = "true"
        return FirebaseDatabase()

    else:
        raise ValueError(
            f"Unknown database type: {db_type}. "
            f"Valid options: 'firebase', 'mongodb', 'mock'"
        )
