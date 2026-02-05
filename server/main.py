"""Main FastAPI application for the web scraper."""

from __future__ import annotations

import os
import json

import httpx
from fastapi import FastAPI, HTTPException

from models import AnalyzeRequest, AnalyzeResponse, AccessibleResponse
from scraper import (
    assert_public_hostname,
    extract_meta,
    extract_blocks_in_order,
    extract_links_and_images,
    remove_non_content,
    select_root,
    fetch_and_parse_html,
)
from firebase_store import save_scrape, db


app = FastAPI(title="Scraper API")


def _safe_trim_blocks(blocks, max_blocks: int = 200, max_total_chars: int = 80_000):
    trimmed = []
    total = 0
    for b in blocks[:max_blocks]:
        item = b.model_dump() if hasattr(b, "model_dump") else b
        s = str(item)
        if total + len(s) > max_total_chars:
            break
        trimmed.append(item)
        total += len(s)
    return trimmed


@app.post("/analyze", response_model=AnalyzeResponse)
def analyze(req: AnalyzeRequest):
    """All-in-one endpoint: Scrape a URL and immediately get an AI summary. No manual chaining needed."""
    # Step 1: Scrape the URL
    assert_public_hostname(req.url.host)

    try:
        soup = fetch_and_parse_html(str(req.url))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to fetch/parse HTML: {e}")

    meta = extract_meta(soup, str(req.url))
    remove_non_content(soup)
    root = select_root(soup)
    blocks = extract_blocks_in_order(root)
    links, images = extract_links_and_images(root, str(req.url))

    # Create structured context from scraped data
    trimmed_blocks = _safe_trim_blocks(blocks, max_blocks=50)
    blocks_data = []
    for block in trimmed_blocks:
        if isinstance(block, dict):
            blocks_data.append(block)
        elif hasattr(block, "model_dump"):
            blocks_data.append(block.model_dump())
        else:
            blocks_data.append(block)

    links_data = []
    for link in links[:20]:
        if isinstance(link, dict):
            links_data.append(link)
        elif hasattr(link, "model_dump"):
            links_data.append(link.model_dump())

    images_data = []
    for image in images[:20]:
        if isinstance(image, dict):
            images_data.append(image)
        elif hasattr(image, "model_dump"):
            images_data.append(image.model_dump())

    # Save raw scraped data to Firebase
    try:
        save_scrape(
            url=str(req.url),
            meta=meta,
            blocks=blocks_data,
            links=links_data,
            images=images_data,
            collection="audits",
        )
    except Exception:
        pass  # Gracefully fail if Firebase is unavailable

    # Step 2: Create context for OpenAI analysis
    context = {
        "source": "scraped_url",
        "url": str(req.url),
        "metadata": {
            "title": meta.title,
            "description": meta.description,
            "canonical": meta.canonical,
            "language": meta.lang,
        },
        "content_blocks": blocks_data,
        "links": links_data,
        "images": images_data,
    }

    system_prompt = """You are an expert content analyst and summarizer. 
Your task is to ALWAYS provide a comprehensive, well-structured summary including:
1. Main topics and themes
2. Key information and findings
3. Important details and context
4. Significant conclusions or takeaways
5. Answer any specific question if provided

Be thorough, clear, well-organized, and insightful."""
    
    if req.question:
        user_prompt = f"""Please analyze and provide a comprehensive summary of the following content.
Also provide a specific answer to the user's question.

CONTENT TO ANALYZE:
{json.dumps(context, indent=2)}

USER'S SPECIFIC QUESTION: {req.question}

Provide:
1. A thorough, well-structured summary of all the content
2. A direct answer to the specific question"""
    else:
        user_prompt = f"""Please analyze and provide a comprehensive summary of the following content.

CONTENT TO ANALYZE:
{json.dumps(context, indent=2)}

Create a detailed, well-structured summary covering:
1. Main topics and themes present in the content
2. Key information and important findings
3. Important details and relevant context
4. Significant conclusions and key takeaways"""

    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=500,
            detail="OPENAI_API_KEY is not set in the environment.",
        )

    model = os.getenv("OPENAI_MODEL", "gpt-3.5-turbo")
    url_api = "https://api.openai.com/v1/chat/completions"
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    try:
        resp = httpx.post(url_api, json=payload, headers=headers, timeout=30.0)
        resp.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=exc.response.status_code,
            detail=exc.response.text,
        ) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"OpenAI request failed: {exc}",
        ) from exc

    data = resp.json()
    summary = ""
    if "choices" in data and len(data["choices"]) > 0:
        summary = data["choices"][0].get("message", {}).get("content", "")

    return AnalyzeResponse(
        ok=True,
        url=str(req.url),
        title=meta.title,
        description=meta.description,
        blocks_count=len(blocks),
        summary=summary,
        model=data.get("model", model),
    )


def _extract_key_facts(blocks) -> list:
    """Extract key facts (numbers, dates, important statements) from content."""
    facts = []
    for block in blocks[:50]:  # Check first 50 blocks to find enough content
        if isinstance(block, dict):
            text = block.get("text", "")
            block_type = block.get("type", "")
        else:
            text = getattr(block, "text", "")
            block_type = getattr(block, "type", "")
        
        # Accept paragraphs, lists, quotes, and headings
        if block_type in ["paragraph", "list", "quote", "heading"] and text:
            # More lenient criteria for fact length (20-500 chars)
            if len(text) > 20 and len(text) <= 500 and not text.startswith("["):
                clean_text = text.strip()
                if clean_text and len(clean_text) > 20:
                    facts.append(clean_text)
                    if len(facts) >= 5:
                        break
    
    return facts[:5]  # Top 5 key facts


def _extract_sections(blocks) -> list:
    """Extract main section headings for navigation."""
    sections = []
    for block in blocks:
        if isinstance(block, dict):
            block_type = block.get("type", "")
            text = block.get("text", "")
            level = block.get("level", 0)
        else:
            block_type = getattr(block, "type", "")
            text = getattr(block, "text", "")
            level = getattr(block, "level", 0)
        
        # Extract main headings (h1, h2)
        if block_type == "heading" and level in [1, 2] and text:
            sections.append(text)
    
    return sections[:6]  # Top 6 sections


def _estimate_read_time(text: str) -> int:
    """Estimate reading time in minutes (avg 200 words per minute)."""
    words = len(text.split())
    return max(1, round(words / 200))


def _assess_readability(blocks) -> str:
    """Assess content readability level."""
    # Simplified heuristic: count complex structures
    total_blocks = len(blocks)
    
    # Count tables and complex structures
    complex_count = 0
    for block in blocks:
        if isinstance(block, dict):
            if block.get("type") == "table":
                complex_count += 2
        else:
            if getattr(block, "type", "") == "table":
                complex_count += 2
    
    complexity_ratio = complex_count / max(1, total_blocks)
    
    if complexity_ratio > 0.3:
        return "complex"
    elif complexity_ratio > 0.15:
        return "moderate"
    else:
        return "easy"


@app.post("/accessible", response_model=AccessibleResponse)
def accessible(req: AnalyzeRequest):
    """Accessibility-optimized endpoint: Scrape + analyze content for users with impairments.
    Returns: simplified language, readability metrics, key facts, section structure, estimated read time."""
    
    # Step 1: Scrape the URL
    assert_public_hostname(req.url.host)

    try:
        soup = fetch_and_parse_html(str(req.url))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to fetch/parse HTML: {e}")

    meta = extract_meta(soup, str(req.url))
    remove_non_content(soup)
    root = select_root(soup)
    blocks = extract_blocks_in_order(root)
    links, images = extract_links_and_images(root, str(req.url))

    # Extract accessibility-focused data
    main_sections = _extract_sections(blocks)
    key_facts = _extract_key_facts(blocks)
    readability_level = _assess_readability(blocks)

    trimmed_blocks = _safe_trim_blocks(blocks, max_blocks=50)
    blocks_data = []
    for block in trimmed_blocks:
        if isinstance(block, dict):
            blocks_data.append(block)
        elif hasattr(block, "model_dump"):
            blocks_data.append(block.model_dump())
        else:
            blocks_data.append(block)

    links_data = []
    for link in links[:20]:
        if isinstance(link, dict):
            links_data.append(link)
        elif hasattr(link, "model_dump"):
            links_data.append(link.model_dump())

    images_data = []
    for image in images[:20]:
        if isinstance(image, dict):
            images_data.append(image)
        elif hasattr(image, "model_dump"):
            images_data.append(image.model_dump())

    # Save raw scraped data to Firebase
    try:
        save_scrape(
            url=str(req.url),
            meta=meta,
            blocks=blocks_data,
            links=links_data,
            images=images_data,
            collection="audits",
        )
    except Exception:
        pass  # Gracefully fail if Firebase is unavailable

    context = {
        "source": "scraped_url",
        "url": str(req.url),
        "metadata": {
            "title": meta.title,
            "description": meta.description,
            "language": meta.lang,
        },
        "content_blocks": blocks_data,
        "links": links_data,
        "images": images_data,
        "key_sections": main_sections,
    }

    # Step 2: Generate SIMPLIFIED summary for accessibility
    system_prompt_simple = """You are an accessibility expert and content simplifier.
Your task is to create content that's easy to understand for people with cognitive or reading impairments.

RULES:
1. Use simple, common words (8th grade reading level or lower)
2. Write short sentences (10-15 words max)
3. Use lists instead of paragraphs
4. Avoid jargon and technical terms
5. Be clear and direct
6. Use active voice
7. Avoid unnecessary details

Provide a clear, simple summary that anyone can understand."""

    system_prompt_detailed = """You are an expert content analyst and summarizer.
Provide a comprehensive, well-structured summary including:
1. Main topics and themes
2. Key information and findings
3. Important details and context
4. Significant conclusions or takeaways

Be thorough, clear, well-organized, and insightful."""

    simple_prompt = f"""Simplify this content into easy-to-understand language:

CONTENT:
{json.dumps(context, indent=2)}

Create a simple summary that:
- Uses easy words
- Has short sentences
- Has clear structure
- Explains everything
- Avoids confusing terms"""

    detailed_prompt = f"""Analyze and summarize this content comprehensively:

CONTENT:
{json.dumps(context, indent=2)}

Provide a detailed summary covering:
1. Main topics and themes
2. Key information and important findings
3. Important details and context
4. Significant conclusions and takeaways"""

    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=500,
            detail="OPENAI_API_KEY is not set in the environment.",
        )

    model = os.getenv("OPENAI_MODEL", "gpt-3.5-turbo")
    url_api = "https://api.openai.com/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    # Get simplified summary
    payload_simple = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt_simple},
            {"role": "user", "content": simple_prompt},
        ],
    }

    try:
        resp_simple = httpx.post(url_api, json=payload_simple, headers=headers, timeout=30.0)
        resp_simple.raise_for_status()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"OpenAI request failed: {exc}")

    data_simple = resp_simple.json()
    summary_simple = ""
    if "choices" in data_simple and len(data_simple["choices"]) > 0:
        summary_simple = data_simple["choices"][0].get("message", {}).get("content", "")

    # Get detailed summary
    payload_detailed = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt_detailed},
            {"role": "user", "content": detailed_prompt},
        ],
    }

    try:
        resp_detailed = httpx.post(url_api, json=payload_detailed, headers=headers, timeout=30.0)
        resp_detailed.raise_for_status()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"OpenAI request failed: {exc}")

    data_detailed = resp_detailed.json()
    summary_detailed = ""
    if "choices" in data_detailed and len(data_detailed["choices"]) > 0:
        summary_detailed = data_detailed["choices"][0].get("message", {}).get("content", "")

    # Calculate read time from simplified summary
    read_time = _estimate_read_time(summary_simple)

    return AccessibleResponse(
        ok=True,
        url=str(req.url),
        title=meta.title,
        main_sections=main_sections,
        key_facts=key_facts,
        readability_level=readability_level,
        summary_simple=summary_simple,
        summary_detailed=summary_detailed,
        estimated_read_time_minutes=read_time,
        has_images=len(images) > 0,
        has_tables=any(b.get("type") == "table" if isinstance(b, dict) else getattr(b, "type", "") == "table" for b in blocks),
        model=data_simple.get("model", model),
    )


@app.get("/firestore-test")
def firestore_test():
    """Quick test route to verify Firestore connectivity."""
    ref = db.collection("audits").document()
    ref.set({"hello": "world"})
    return {"ok": True, "id": ref.id}


@app.get("/openai-test")
def openai_test():
    """
    Quick test route to verify OpenAI API connectivity.
    Expects OPENAI_API_KEY in environment.
    """
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=500,
            detail="OPENAI_API_KEY is not set in the environment.",
        )

    model = os.getenv("OPENAI_MODEL", "gpt-3.5-turbo")
    url = "https://api.openai.com/v1/chat/completions"
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": "ping"}],
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    try:
        resp = httpx.post(url, json=payload, headers=headers, timeout=20.0)
        resp.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=exc.response.status_code,
            detail=exc.response.text,
        ) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"OpenAI request failed: {exc}",
        ) from exc

    data = resp.json()
    text_out = ""
    if "choices" in data and len(data["choices"]) > 0:
        text_out = data["choices"][0].get("message", {}).get("content", "")

    return {
        "ok": True,
        "model": data.get("model"),
        "text": text_out,
    }
