"""Services package - business logic layer."""

from services.scraping import scrape_url, blocks_to_text
from services.simplification import (
    pick_important_links,
    generate_mode_output_validated,
    extract_best_context,
)

__all__ = [
    "scrape_url",
    "blocks_to_text",
    "pick_important_links",
    "generate_mode_output_validated",
    "extract_best_context",
]
