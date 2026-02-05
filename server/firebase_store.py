"""Firebase initialization and Firestore operations."""

import os

import firebase_admin
from firebase_admin import credentials, firestore


def get_firestore():
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
    return firestore.client()


# Initialize Firestore client
db = get_firestore()
