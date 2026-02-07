"""API package - FastAPI routes and endpoints."""

from api.routes import router as main_router
from api.test_routes import router as test_router

__all__ = ["main_router", "test_router"]
