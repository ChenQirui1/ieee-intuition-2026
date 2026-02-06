"""Pydantic models for the scraper + simplifier API."""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import AnyUrl, BaseModel, Field


# ----------------- Scraper models -----------------

class PageMeta(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    canonical: Optional[str] = None
    lang: Optional[str] = None


class LinkItem(BaseModel):
    href: str
    text: str
    is_internal: bool


class ImageItem(BaseModel):
    src: str
    alt: str = ""


class ContentBlock(BaseModel):
    type: str  # heading|paragraph|list|table|quote|code|hr
    level: Optional[int] = None
    depth: Optional[int] = None
    text: Optional[str] = None
    items: Optional[List[str]] = None
    headers: Optional[List[str]] = None
    rows: Optional[List[List[str]]] = None


class ScrapRequest(BaseModel):
    url: AnyUrl = Field(..., description="http(s) URL to scrape")


class ScrapResponse(BaseModel):
    ok: bool = True
    url: str
    meta: PageMeta
    blocks: List[ContentBlock]
    links: List[LinkItem]
    images: List[ImageItem]


# ----------------- Simplify (3 modes + language) -----------------

Mode = Literal["easy_read", "checklist", "step_by_step", "all"]
Language = Literal["en", "zh", "ms", "ta"]  # English, Chinese, Malay, Tamil


class SimplifyRequest(BaseModel):
    url: AnyUrl
    mode: Mode = "all"
    language: Language = "en"
    session_id: Optional[str] = None
    force_regen: bool = False


class SimplifyResponse(BaseModel):
    ok: bool = True
    url: str
    page_id: str
    source_text_hash: str
    language: Language
    model: str
    outputs: Dict[str, Any]                # keys: easy_read, checklist, step_by_step
    simplification_ids: Dict[str, str]     # mode -> simplification doc id


# ----------------- Contextual chatbot (+ section-level + language) -----------------

class ChatMessage(BaseModel):
    role: Literal["user", "assistant", "system"]
    content: str


class ChatRequest(BaseModel):
    url: Optional[AnyUrl] = None
    page_id: Optional[str] = None

    mode: Literal["easy_read", "checklist", "step_by_step"] = "easy_read"
    language: Language = "en"
    simplification_id: Optional[str] = None

    section_id: Optional[str] = Field(None, description="Optional section identifier in your UI")
    section_text: Optional[str] = Field(None, description="Exact text user is asking about")

    message: str = Field(..., min_length=1)
    history: List[ChatMessage] = []
    session_id: Optional[str] = None


class ChatResponse(BaseModel):
    ok: bool = True
    model: str
    answer: str
    page_id: Optional[str] = None
    simplification_id: Optional[str] = None


# ----------------- Simple text completion -----------------

class TextCompletionRequest(BaseModel):
    text: str = Field(..., min_length=1, description="Text prompt to send to OpenAI")
    temperature: float = Field(0.7, ge=0.0, le=2.0, description="Temperature for response randomness")


class TextCompletionResponse(BaseModel):
    ok: bool = True
    model: str
    response: str
