"""Main FastAPI application - entry point."""

import os

from dotenv import load_dotenv
from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

# API routers imports
from api.routes import router as main_router
from api.security import ALLOWED_ORIGINS, EXTENSION_ORIGIN_PATTERN, enforce_api_access

# Database imports - uses factory pattern to select implementation
from database import get_database

# Load environment variables first
load_dotenv()

# Initialize database (automatically selects based on DATABASE_TYPE env var)
db = get_database()

# Create FastAPI app
app = FastAPI(title="Scraper + Accessibility Backend API")


class RequestSizeLimit:
    """Bound bodies before JSON decoding, including chunked requests."""

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        if scope["type"] != "http" or scope["method"] not in {"POST", "PUT", "PATCH"}:
            return await self.app(scope, receive, send)
        body = bytearray()
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            body.extend(message.get("body", b""))
            if len(body) > 96_000:
                response = JSONResponse(
                    {"detail": "Request body exceeds 96000 bytes"}, status_code=413
                )
                return await response(scope, receive, send)
            if not message.get("more_body", False):
                break
        delivered = False

        async def replay():
            nonlocal delivered
            if delivered:
                return await receive()
            delivered = True
            return {"type": "http.request", "body": bytes(body), "more_body": False}

        await self.app(scope, replay, send)


app.add_middleware(RequestSizeLimit)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(ALLOWED_ORIGINS),
    allow_origin_regex=EXTENSION_ORIGIN_PATTERN,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(main_router)
if os.getenv("ENABLE_TEST_ROUTES", "false").lower() in {"1", "true", "yes"}:
    from api.test_routes import router as test_router

    app.include_router(test_router, dependencies=[Depends(enforce_api_access)])
