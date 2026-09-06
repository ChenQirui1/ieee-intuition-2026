"""Verify multimodal requests and failure handling without spending API quota."""

import httpx
import pytest
from fastapi import HTTPException

from utils import openai_client


def test_caption_uses_vision_model_even_with_legacy_text_override(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setenv("OPENAI_MODEL", "gpt-3.5-turbo")
    monkeypatch.delenv("OPENAI_VISION_MODEL", raising=False)
    calls = []

    def post(url, **kwargs):
        calls.append(kwargs["json"])
        return httpx.Response(
            200,
            request=httpx.Request("POST", url),
            json={
                "choices": [
                    {"message": {"content": "A red bicycle."}, "finish_reason": "stop"}
                ]
            },
        )

    monkeypatch.setattr(openai_client.httpx, "post", post)
    caption, model = openai_client.call_openai_image_caption(
        image_url="https://example.com/bike.png", prompt="Describe briefly."
    )
    assert caption == "A red bicycle."
    assert model == openai_client.DEFAULT_MODEL
    assert (
        calls[0]["messages"][0]["content"][1]["image_url"]["url"]
        == "https://example.com/bike.png"
    )
    assert calls[0]["reasoning_effort"] == "none"
    assert "temperature" not in calls[0]


@pytest.mark.parametrize(
    "response_body",
    [
        {},
        {"choices": []},
        {"choices": [{"message": {"content": ""}}]},
        {"choices": [{"message": {"content": "partial"}, "finish_reason": "length"}]},
    ],
)
def test_incomplete_provider_output_is_not_a_success(monkeypatch, response_body):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setattr(
        openai_client.httpx,
        "post",
        lambda url, **kwargs: httpx.Response(
            200, request=httpx.Request("POST", url), json=response_body
        ),
    )
    with pytest.raises(HTTPException) as error:
        openai_client.call_openai_chat(messages=[{"role": "user", "content": "hi"}])
    assert error.value.status_code == 502
