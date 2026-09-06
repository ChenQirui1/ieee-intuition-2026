"""Access policy, body bounds, and cache expiry regressions."""

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from api import routes
from main import app


@pytest.fixture
def local_client(monkeypatch):
    monkeypatch.setattr(routes, "call_openai_chat", lambda **kwargs: ("ok", "test"))
    return TestClient(app, client=("127.0.0.1", 50001))


def test_remote_client_cannot_use_unconfigured_api():
    client = TestClient(app, client=("203.0.113.10", 50000))
    assert client.post("/text-completion", json={"text": "hello"}).status_code == 503
    assert client.get("/healthz").status_code == 200


def test_rate_limit_and_expiry(local_client, monkeypatch):
    monkeypatch.setenv("API_RATE_LIMIT_PER_MINUTE", "1")
    assert (
        local_client.post("/text-completion", json={"text": "hello"}).status_code == 200
    )
    response = local_client.post("/text-completion", json={"text": "hello"})
    assert response.status_code == 429
    assert response.headers["retry-after"] == "60"
    from api.security import _request_times

    for bucket in _request_times.values():
        bucket[0] -= 61
    assert (
        local_client.post("/text-completion", json={"text": "hello"}).status_code == 200
    )


def test_webpage_origin_cannot_spend_local_api_quota(local_client):
    assert (
        local_client.post(
            "/text-completion",
            json={"text": "hello"},
            headers={"Origin": "https://attacker.example"},
        ).status_code
        == 403
    )
    assert (
        local_client.post(
            "/text-completion",
            content='{"text":"hello"}',
            headers={"Content-Type": "text/plain"},
        ).status_code
        == 415
    )
    assert (
        local_client.post(
            "/text-completion",
            json={"text": "hello"},
            headers={"Origin": "chrome-extension://" + "a" * 32},
        ).status_code
        == 200
    )


@pytest.mark.parametrize(
    "body",
    [
        {"text": " "},
        {"text": "x" * 12001},
        {"text": "hello", "messages": [{"role": "user", "content": "hi"}]},
        {"messages": [{"role": "user", "content": " "}]},
        {"messages": [{"role": "user", "content": "x" * 9000}] * 2},
    ],
)
def test_invalid_prompts_are_rejected(local_client, body):
    assert local_client.post("/text-completion", json=body).status_code == 422


def test_body_limit_applies_before_json_decoding(local_client):
    assert (
        local_client.post(
            "/text-completion",
            content=b"x" * 96001,
            headers={"Content-Type": "application/json"},
        ).status_code
        == 413
    )


def test_cache_expiry(monkeypatch):
    monkeypatch.setenv("PAGE_CACHE_TTL_SECONDS", "60")
    now = datetime.now(timezone.utc)
    assert routes._cache_is_fresh({"updated_at": now.isoformat()})
    assert not routes._cache_is_fresh({"updated_at": now - timedelta(seconds=61)})
    assert not routes._cache_is_fresh({"updated_at": now + timedelta(hours=1)})
    assert not routes._cache_is_fresh({"updated_at": "invalid"})
    monkeypatch.setenv("PAGE_CACHE_TTL_SECONDS", "0")
    assert not routes._cache_is_fresh({"updated_at": now})
