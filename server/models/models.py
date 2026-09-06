"""Pydantic models for the scraper + simplifier API."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, model_validator

# ----------------- Scraper models -----------------


class PageMeta(BaseModel):
    title: str | None = None
    description: str | None = None
    canonical: str | None = None
    lang: str | None = None


class LinkItem(BaseModel):
    href: str
    text: str
    is_internal: bool


class ImageItem(BaseModel):
    src: str
    alt: str = ""


class ContentBlock(BaseModel):
    type: str  # heading|paragraph|list|table|quote|code|hr
    level: int | None = None
    depth: int | None = None
    text: str | None = None
    items: list[str] | None = None
    headers: list[str] | None = None
    rows: list[list[str]] | None = None


class ScrapRequest(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "examples": [{"url": "https://www.wikipedia.org/wiki/Web_accessibility"}]
        }
    )

    url: HttpUrl = Field(..., description="http(s) URL to scrape")


class ScrapResponse(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {
                    "ok": True,
                    "url": "https://www.wikipedia.org/wiki/Web_accessibility",
                    "meta": {
                        "title": "Web accessibility - Wikipedia",
                        "description": "Web accessibility ensures people with disabilities can use the web",
                        "canonical": "https://en.wikipedia.org/wiki/Web_accessibility",
                        "lang": "en",
                    },
                    "blocks": [
                        {"type": "heading", "level": 1, "text": "Web accessibility"},
                        {
                            "type": "paragraph",
                            "text": "Web accessibility is the inclusive practice of ensuring there are no barriers that prevent interaction with websites by people with disabilities.",
                        },
                    ],
                    "links": [
                        {
                            "href": "https://www.w3.org/WAI/",
                            "text": "Web Accessibility Initiative",
                            "is_internal": False,
                        }
                    ],
                    "images": [
                        {
                            "src": "https://example.com/accessibility-icon.png",
                            "alt": "Accessibility icon",
                        }
                    ],
                }
            ]
        }
    )

    ok: bool = True
    url: str
    meta: PageMeta
    blocks: list[ContentBlock]
    links: list[LinkItem]
    images: list[ImageItem]


# ----------------- Simplify (3 modes + language) -----------------

Mode = Literal["easy_read", "checklist", "step_by_step", "all", "intelligent"]
Language = Literal["en", "zh", "ms", "ta"]  # English, Chinese, Malay, Tamil


class SimplifyRequest(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {
                    "url": "https://www.irs.gov/forms-pubs/about-form-1040",
                    "mode": "all",
                    "language": "en",
                    "session_id": "user-session-123",
                    "force_regen": False,
                },
                {
                    "url": "https://www.cpf.gov.sg/member/faq",
                    "mode": "checklist",
                    "language": "zh",
                    "force_regen": True,
                },
            ]
        }
    )

    url: HttpUrl
    mode: Mode = "all"
    language: Language = "en"
    session_id: str | None = None
    force_regen: bool = False


class SimplifyResponse(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {
                    "ok": True,
                    "url": "https://www.irs.gov/forms-pubs/about-form-1040",
                    "page_id": "page_abc123def456",
                    "source_text_hash": "sha256_hash_here",
                    "language": "en",
                    "model": "gpt-5.6-luna",
                    "outputs": {
                        "intelligent": {
                            "summary": "Form 1040 is the standard U.S. tax return form used to report your income and calculate your taxes.",
                            "key_points": [
                                "Used by individuals to file annual income taxes",
                                "Reports all sources of income including wages, investments, and business income",
                                "Calculates total tax owed or refund due",
                            ],
                            "action_items": [
                                "Gather W-2 forms from all employers",
                                "Collect 1099 forms for other income",
                                "Review deductions and credits you qualify for",
                                "File by April 15th deadline",
                            ],
                        }
                    },
                    "simplification_ids": {"intelligent": "simpl_xyz789abc123"},
                }
            ]
        }
    )

    ok: bool = True
    url: str
    page_id: str
    source_text_hash: str
    language: Language
    model: str
    outputs: dict[str, Any]  # keys: easy_read, checklist, step_by_step
    simplification_ids: dict[str, str]  # mode -> simplification doc id


# ----------------- Contextual chatbot (+ section-level + language) -----------------


class ChatMessage(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    role: Literal["user", "assistant", "system"]
    content: str = Field(min_length=1, max_length=12_000)


class ChatRequest(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {
                    "url": "https://www.irs.gov/forms-pubs/about-form-1040",
                    "mode": "easy_read",
                    "language": "en",
                    "message": "What documents do I need to file my taxes?",
                    "history": [
                        {
                            "role": "user",
                            "content": "Can you explain what Form 1040 is?",
                        },
                        {
                            "role": "assistant",
                            "content": "Form 1040 is the main tax form you use to report your income to the IRS each year.",
                        },
                    ],
                    "session_id": "user-session-123",
                },
                {
                    "page_id": "page_abc123def456",
                    "mode": "checklist",
                    "language": "zh",
                    "section_text": "Filing Requirements",
                    "message": "我需要提交哪些文件？",
                    "history": [],
                },
            ]
        }
    )

    url: HttpUrl | None = None
    page_id: str | None = None

    mode: Literal["easy_read", "checklist", "step_by_step"] = "easy_read"
    language: Language = "en"
    simplification_id: str | None = None

    section_id: str | None = Field(
        None, description="Optional section identifier in your UI"
    )
    section_text: str | None = Field(
        None, description="Exact text user is asking about"
    )

    message: str = Field(..., min_length=1)
    history: list[ChatMessage] = Field(default_factory=list, max_length=12)
    session_id: str | None = None


class ChatResponse(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {
                    "ok": True,
                    "model": "gpt-5.6-luna",
                    "answer": "To file your taxes, you'll need: 1) W-2 forms from your employer, 2) 1099 forms for other income like freelance work or investments, 3) Records of deductible expenses, and 4) Your Social Security number.",
                    "page_id": "page_abc123def456",
                    "simplification_id": "simpl_xyz789abc123",
                }
            ]
        }
    )

    ok: bool = True
    model: str
    answer: str
    page_id: str | None = None
    simplification_id: str | None = None


# ----------------- Simple text completion -----------------


class TextCompletionRequest(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {
                    "text": "Explain quantum computing in simple terms",
                    "temperature": 0.7,
                },
                {"text": "Write a haiku about programming", "temperature": 1.2},
            ]
        }
    )

    text: str | None = Field(
        None,
        min_length=1,
        max_length=12_000,
        description="Text prompt to send to OpenAI",
    )
    messages: list[ChatMessage] | None = Field(None, min_length=1, max_length=12)
    temperature: float = Field(
        0.7, ge=0.0, le=2.0, description="Temperature for response randomness"
    )

    @model_validator(mode="after")
    def validate_prompt_shape(self):
        if (self.text is None) == (self.messages is None):
            raise ValueError("Provide exactly one of 'text' or 'messages'")
        if self.text is not None:
            self.text = self.text.strip()
            if not self.text:
                raise ValueError("'text' cannot be blank")
        if self.messages is not None:
            total_chars = sum(len(message.content) for message in self.messages)
            if total_chars > 16_000:
                raise ValueError("Message content exceeds the 16000 character limit")
        return self


class TextCompletionResponse(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {
                    "ok": True,
                    "model": "gpt-5.6-luna",
                    "response": "Quantum computing uses quantum mechanics principles like superposition and entanglement to process information. Unlike regular computers that use bits (0 or 1), quantum computers use qubits that can be both 0 and 1 simultaneously, allowing them to solve certain problems much faster.",
                }
            ]
        }
    )

    ok: bool = True
    model: str
    response: str


class ImageCaptionRequest(BaseModel):
    image_url: HttpUrl
    alt_text: str | None = Field(None, max_length=1_000)
    language: Language = "en"


class ImageCaptionResponse(BaseModel):
    ok: bool = True
    model: str
    caption: str
