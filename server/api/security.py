"""Authentication and lightweight abuse protection for API endpoints."""

from __future__ import annotations

import hmac
import os
import re
import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request

_LOCAL_CLIENTS = {"127.0.0.1", "::1"}
ALLOWED_ORIGINS = {
    "http://127.0.0.1:3000",
    "http://localhost:3000",
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "http://127.0.0.1:8000",
    "http://localhost:8000",
}
EXTENSION_ORIGIN_PATTERN = r"^chrome-extension://[a-p]{32}$"
_request_times: dict[str, deque[float]] = defaultdict(deque)
_rate_lock = threading.Lock()


def _is_truthy(value: str | None) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes", "on"}


def _provided_api_key(request: Request) -> str:
    header_key = (request.headers.get("x-clearweb-key") or "").strip()
    if header_key:
        return header_key
    authorization = request.headers.get("authorization") or ""
    scheme, _, token = authorization.partition(" ")
    return token.strip() if scheme.lower() == "bearer" else ""


def _check_rate_limit(request: Request) -> None:
    try:
        limit = max(1, int(os.getenv("API_RATE_LIMIT_PER_MINUTE", "30")))
    except ValueError:
        limit = 30

    client = request.client.host if request.client else "unknown"
    key = f"{client}:{request.url.path}"
    now = time.monotonic()
    cutoff = now - 60
    with _rate_lock:
        for stale_key in list(_request_times):
            if not _request_times[stale_key] or _request_times[stale_key][-1] < cutoff:
                del _request_times[stale_key]
        bucket = _request_times[key]
        while bucket and bucket[0] < cutoff:
            bucket.popleft()
        if len(bucket) >= limit:
            raise HTTPException(
                status_code=429,
                detail="Too many requests. Try again in one minute.",
                headers={"Retry-After": "60"},
            )
        bucket.append(now)


def enforce_api_access(request: Request) -> None:
    """Require a configured key for remote clients, then apply a rate limit."""
    expected_key = (os.getenv("API_ACCESS_KEY") or "").strip()
    client = request.client.host if request.client else "unknown"

    origin = request.headers.get("origin")
    if (
        origin
        and origin not in ALLOWED_ORIGINS
        and not re.fullmatch(EXTENSION_ORIGIN_PATTERN, origin)
    ):
        raise HTTPException(status_code=403, detail="Browser origin is not allowed")
    if (
        request.method == "POST"
        and request.headers.get("content-type", "").split(";")[0].strip().lower()
        != "application/json"
    ):
        raise HTTPException(
            status_code=415, detail="Content-Type must be application/json"
        )

    if expected_key:
        provided_key = _provided_api_key(request)
        if not provided_key or not hmac.compare_digest(provided_key, expected_key):
            raise HTTPException(
                status_code=401, detail="Invalid or missing API access key"
            )
    elif client not in _LOCAL_CLIENTS and not _is_truthy(
        os.getenv("ALLOW_UNAUTHENTICATED_API")
    ):
        raise HTTPException(
            status_code=503,
            detail="Remote API access is disabled until API_ACCESS_KEY is configured",
        )

    _check_rate_limit(request)
