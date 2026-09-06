"""Regression tests for ClearWeb's public API contract."""

import os

os.environ.setdefault("DATABASE_TYPE", "mock")

from fastapi.testclient import TestClient

from api import routes
from main import app

client = TestClient(app, client=("127.0.0.1", 50000))


def test_health_check_is_local_and_zero_cost():
    response = client.get("/healthz")

    assert response.status_code == 200
    assert response.json() == {"ok": True}
    assert client.get("/openai-test").status_code == 404


def test_text_completion_validates_request_and_uses_model(monkeypatch):
    monkeypatch.setattr(
        routes,
        "call_openai_chat",
        lambda *, messages, temperature: (messages[-1]["content"], "test-model"),
    )

    invalid = client.post("/text-completion", json={"temperature": 4})
    assert invalid.status_code == 422

    response = client.post(
        "/text-completion",
        json={"text": "Explain this", "temperature": 0.2},
    )
    assert response.status_code == 200
    assert response.json() == {
        "ok": True,
        "model": "test-model",
        "response": "Explain this",
    }


def test_image_caption_route_and_url_validation(monkeypatch):
    monkeypatch.setattr(
        routes,
        "call_openai_image_caption",
        lambda *, image_url, prompt: (f"Caption for {image_url}", "vision-test"),
    )

    invalid = client.post(
        "/image-caption",
        json={"image_url": "ftp://example.com/image.png", "language": "en"},
    )
    assert invalid.status_code == 422

    response = client.post(
        "/image-caption",
        json={"image_url": "https://example.com/image.png", "language": "en"},
    )
    assert response.status_code == 200
    assert response.json()["caption"].startswith("Caption for https://example.com")


def test_api_key_is_enforced_when_configured(monkeypatch):
    monkeypatch.setenv("API_ACCESS_KEY", "unit-test-key")
    monkeypatch.setattr(
        routes,
        "call_openai_chat",
        lambda *, messages, temperature: ("ok", "test-model"),
    )

    assert client.post("/text-completion", json={"text": "hello"}).status_code == 401
    response = client.post(
        "/text-completion",
        json={"text": "hello"},
        headers={"X-ClearWeb-Key": "unit-test-key"},
    )
    assert response.status_code == 200
