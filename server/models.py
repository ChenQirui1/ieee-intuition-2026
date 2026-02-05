"""Pydantic models for the scraper API."""

from typing import List, Optional

from pydantic import AnyUrl, BaseModel, Field


class ScrapRequest(BaseModel):
    """Request model for scraping a URL."""
    url: AnyUrl = Field(..., description="http(s) URL to scrape")


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


class ScrapResponse(BaseModel):
    """Response model for scraping a URL."""
    ok: bool = True
    url: str
    meta: PageMeta
    blocks: List[ContentBlock]
    links: List[LinkItem] = []
    images: List[ImageItem] = []
