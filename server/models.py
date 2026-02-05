"""Pydantic models for the scraper API."""

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
    level: Optional[int] = None          # heading level (1-6)
    depth: Optional[int] = None          # nesting depth for lists
    text: Optional[str] = None           # for heading/paragraph/quote/code
    items: Optional[List[str]] = None    # for list
    headers: Optional[List[str]] = None  # for table
    rows: Optional[List[List[str]]] = None  # for table


class AnalyzeRequest(BaseModel):
    """Request model for analyzing a URL (combines scrap + ask in one call)."""
    url: AnyUrl = Field(..., description="URL to scrape and analyze")
    question: Optional[str] = Field(None, description="Optional: Specific question about the content")


class AnalyzeResponse(BaseModel):
    """Response model for URL analysis (scrap + ask combined)."""
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
    main_sections: List[str]  # Top-level headings
    key_facts: List[str]  # Extracted key points
    readability_level: str  # easy, moderate, complex
    summary_simple: str  # Simplified 8th-grade reading level
    summary_detailed: str  # Full summary
    estimated_read_time_minutes: int
    has_images: bool
    has_tables: bool
    model: str
