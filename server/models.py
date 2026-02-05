"""Pydantic models for the scraper API."""

from __future__ import annotations

from typing import List, Optional

from pydantic import AnyUrl, BaseModel, Field


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
    level: Optional[int] = None  # heading level (1-6)
    depth: Optional[int] = None  # nesting depth for lists
    text: Optional[str] = None  # for heading/paragraph/quote/code
    items: Optional[List[str]] = None  # for list
    headers: Optional[List[str]] = None  # for table
    rows: Optional[List[List[str]]] = None  # for table


# -------- Existing endpoints --------

class AnalyzeRequest(BaseModel):
    """Request model for analyzing a URL (combines scrape + ask in one call)."""

    url: AnyUrl = Field(..., description="URL to scrape and analyze")
    question: Optional[str] = Field(None, description="Optional: Specific question about the content")


class AnalyzeResponse(BaseModel):
    """Response model for URL analysis (scrape + ask combined)."""

    ok: bool = True
    url: str
    title: Optional[str] = None
    description: Optional[str] = None
    blocks_count: int
    summary: str
    question: Optional[str] = None
    model: str


class AccessibleResponse(BaseModel):
    """Response for accessibility-optimized content analysis."""

    ok: bool = True
    url: str
    title: Optional[str] = None
    main_sections: List[str]
    key_facts: List[str]
    readability_level: str
    summary_simple: str
    summary_detailed: str
    estimated_read_time_minutes: int
    has_images: bool
    has_tables: bool
    model: str


# -------- Extension-friendly endpoints --------

class SimplifyRequest(BaseModel):
    """Request for adaptive simplification (extension/web overlay)."""

    url: AnyUrl = Field(..., description="URL to simplify")
    mode: str = Field(
        "easy_read",
        description="Presentation mode: easy_read|checklist|wizard|faq (backend returns all, UI chooses)",
    )
    session_id: Optional[str] = Field(None, description="Optional session identifier (no-auth hackathon)")


class SimplifiedSection(BaseModel):
    id: str
    heading: str
    easy_read: List[str] = []
    key_points: List[str] = []


class WizardStep(BaseModel):
    step: int
    text: str


class GlossaryItem(BaseModel):
    term: str
    definition: str


class SimplifyResponse(BaseModel):
    ok: bool = True
    url: str
    page_id: str
    simplification_id: Optional[str] = None
    mode: str
    title: Optional[str] = None
    tldr: str = ""
    sections: List[SimplifiedSection] = []
    checklist: List[str] = []
    steps: List[WizardStep] = []
    glossary: List[GlossaryItem] = []
    warnings: List[str] = []
    model: str


class ChatRequest(BaseModel):
    url: AnyUrl = Field(..., description="URL context for the question")
    page_id: Optional[str] = Field(None, description="Optional scrape doc id (to avoid rescrape)")
    simplification_id: Optional[str] = Field(None, description="Optional simplification doc id")
    mode: str = Field("easy_read", description="User's current mode (helps tone/format)")
    section_id: Optional[str] = Field(None, description="Optional section identifier the user is asking about")
    question: str = Field(..., min_length=1, description="User question")
    session_id: Optional[str] = Field(None, description="Optional session identifier (no-auth hackathon)")


class ChatResponse(BaseModel):
    ok: bool = True
    answer: str
    model: str


class MetricsRequest(BaseModel):
    url: AnyUrl
    page_id: Optional[str] = None
    simplification_id: Optional[str] = None
    session_id: Optional[str] = None

    event: str = Field(..., description="e.g. simplify_loaded|asked_question|completed_task")
    mode: str = Field("easy_read", description="UI mode at time of event")

    clicks: int = 0
    scrollPx: int = 0
    questions: int = 0
    durationMs: int = 0


class MetricsResponse(BaseModel):
    ok: bool = True
    id: Optional[str] = None
