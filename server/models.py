"""Pydantic models for the scraper + simplifier API."""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import AnyUrl, BaseModel, Field


# ----------------- Scraper models -----------------

class PageMeta(BaseModel):
    """Metadata extracted from a page."""
    title: Optional[str] = None
    description: Optional[str] = None
    canonical: Optional[str] = None
    lang: Optional[str] = None


class LinkItem(BaseModel):
    """A link found on the page."""
    href: str
    text: str
    is_internal: bool


class ImageItem(BaseModel):
    """An image found on the page."""
    src: str
    alt: str = ""


class ContentBlock(BaseModel):
    """A block of content (heading, paragraph, list, table, etc.)."""
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


# ----------------- Simplify (3 modes) -----------------

Mode = Literal["easy_read", "checklist", "step_by_step", "all"]


class SimplifyRequest(BaseModel):
    url: AnyUrl
    mode: Mode = "all"
    session_id: Optional[str] = None
    force_regen: bool = False


class SimplifyResponse(BaseModel):
    ok: bool = True
    url: str
    page_id: str
    source_text_hash: str
    model: str
    outputs: Dict[str, Any]  # keys: easy_read, checklist, step_by_step
    simplification_ids: Dict[str, str]  # mode -> simplification doc id


# ----------------- Contextual chatbot -----------------

class ChatMessage(BaseModel):
    role: Literal["user", "assistant", "system"]
    content: str


class ChatRequest(BaseModel):
    """
    Contextual chat request.

    For true section-level context:
    - pass `section_text` from the overlay card the user clicked
      (best UX + shortest prompt + most accurate).
    """
    url: Optional[AnyUrl] = None
    page_id: Optional[str] = None

    mode: Literal["easy_read", "checklist", "step_by_step"] = "easy_read"
    simplification_id: Optional[str] = None

    # NEW (Section-level context)
    section_id: Optional[str] = Field(None, description="Optional section identifier in your UI")
    section_text: Optional[str] = Field(None, description="The exact text the user is asking about")

    message: str = Field(..., min_length=1)
    history: List[ChatMessage] = []
    session_id: Optional[str] = None


class ChatResponse(BaseModel):
    ok: bool = True
    model: str
    answer: str
    page_id: Optional[str] = None
    simplification_id: Optional[str] = None
