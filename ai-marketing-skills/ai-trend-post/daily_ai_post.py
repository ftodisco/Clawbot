#!/usr/bin/env python3
"""
Daily AI Trend Post Generator

Fetches today's top AI news, generates a ~1000 character social post with
5 hashtags, and creates a matching image. Runs daily at 3pm via cron.

Required env vars:
  ANTHROPIC_API_KEY   — Claude API key for post generation

Optional env vars:
  OPENAI_API_KEY      — OpenAI key for DALL-E 3 image generation
  TAVILY_API_KEY      — Tavily search API key (falls back to RSS if absent)
  POST_OUTPUT_DIR     — Where to save posts (default: ./output)
  POST_TIMEZONE       — Timezone name for logging (default: UTC)

Usage:
  python daily_ai_post.py               # generate post for today
  python daily_ai_post.py --dry-run     # print output without saving files
  python daily_ai_post.py --no-image    # skip image generation
  python daily_ai_post.py --date 2025-06-01  # override date label
"""

import argparse
import json
import os
import sys
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

# ── Config ────────────────────────────────────────────────────────────────────

OUTPUT_DIR = Path(os.environ.get("POST_OUTPUT_DIR", Path(__file__).parent / "output"))

# RSS feeds — no API key required. Mix of general tech + AI-specific.
AI_RSS_FEEDS = [
    "https://techcrunch.com/category/artificial-intelligence/feed/",
    "https://venturebeat.com/ai/feed/",
    "https://www.theverge.com/rss/index.xml",
    "https://feeds.feedburner.com/AIWeekly",
    "https://huggingface.co/blog/feed.xml",
]

AI_KEYWORDS = {
    "ai", "llm", "gpt", "chatgpt", "gemini", "claude", "openai", "anthropic",
    "machine learning", "deep learning", "neural", "artificial intelligence",
    "model", "agent", "automation", "midjourney", "stable diffusion",
    "transformer", "inference", "fine-tuning", "multimodal",
}

MODEL_ID = "claude-sonnet-4-6"
IMAGE_MODEL = "dall-e-3"


# ── News fetching ─────────────────────────────────────────────────────────────

def _is_ai_relevant(text: str) -> bool:
    lower = text.lower()
    return any(kw in lower for kw in AI_KEYWORDS)


def _parse_rss_items(xml_bytes: bytes) -> list[dict]:
    """Parse RSS or Atom feed bytes into a list of headline dicts."""
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError:
        return []

    ns = {"atom": "http://www.w3.org/2005/Atom"}

    # Try RSS first, then Atom
    items = root.findall(".//item") or root.findall(".//atom:entry", ns)
    results = []
    for item in items:
        title = (
            item.findtext("title")
            or item.findtext("atom:title", namespaces=ns)
            or ""
        ).strip()
        summary = (
            item.findtext("description")
            or item.findtext("atom:summary", namespaces=ns)
            or ""
        ).strip()
        # Strip basic HTML tags from summary
        import re
        summary = re.sub(r"<[^>]+>", " ", summary)
        summary = re.sub(r"\s+", " ", summary).strip()

        if title and _is_ai_relevant(title + " " + summary):
            results.append({"title": title, "summary": summary[:250]})
    return results


def fetch_rss_news(max_items: int = 12) -> list[dict]:
    """Fetch AI headlines from RSS feeds. Returns up to max_items items."""
    all_items: list[dict] = []
    for url in AI_RSS_FEEDS:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "ai-trend-post/1.0"})
            with urllib.request.urlopen(req, timeout=6) as resp:
                raw = resp.read()
            all_items.extend(_parse_rss_items(raw))
        except Exception:
            continue
        if len(all_items) >= max_items:
            break
    # Deduplicate by title prefix
    seen: set[str] = set()
    unique = []
    for item in all_items:
        key = item["title"][:60].lower()
        if key not in seen:
            seen.add(key)
            unique.append(item)
    return unique[:max_items]


def fetch_tavily_news(max_items: int = 12) -> list[dict] | None:
    """Search for AI news via Tavily. Returns None if key is not set."""
    api_key = os.environ.get("TAVILY_API_KEY", "")
    if not api_key:
        return None

    payload = json.dumps({
        "api_key": api_key,
        "query": "artificial intelligence technology news trending today",
        "search_depth": "basic",
        "topic": "news",
        "max_results": max_items,
    }).encode()
    req = urllib.request.Request(
        "https://api.tavily.com/search",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
        results = data.get("results", [])
        return [
            {"title": r.get("title", ""), "summary": r.get("content", "")[:250]}
            for r in results
            if r.get("title")
        ]
    except Exception:
        return None


def get_trending_news() -> tuple[list[dict], str]:
    """Return (news_items, source_label). Tavily if available, else RSS."""
    items = fetch_tavily_news()
    if items:
        return items, "tavily"
    items = fetch_rss_news()
    return items, "rss"


# ── Content generation ────────────────────────────────────────────────────────

def generate_post(news_items: list[dict], date_str: str, client) -> str:
    """Generate a ~1000 char social post with 5 hashtags using Claude."""
    headlines_block = "\n".join(
        f"- {item['title']}: {item['summary'][:120]}"
        for item in news_items[:10]
    )

    prompt = f"""Today is {date_str}.

TRENDING AI NEWS:
{headlines_block}

Write a social media post about the most interesting AI story or theme from these headlines.

RULES:
- Total length: EXACTLY between 950 and 1050 characters — this is a hard limit
- Direct, punchy tone — short sentences, no filler
- Include one specific fact, stat, or development from the news
- No corporate speak. No "I'm excited to share." No "game-changing."
- End the post with exactly 5 hashtags on their own line, starting with #AI
- Do not use emojis
- No intro line like "Here's your post:" — return ONLY the post text

IMPORTANT: After writing, count every character. If the count is not between 950-1050, cut or expand until it is. A post that is too long fails."""

    message = client.messages.create(
        model=MODEL_ID,
        max_tokens=600,
        messages=[{"role": "user", "content": prompt}],
    )
    post = message.content[0].text.strip()

    # Auto-trim if over limit — preserve hashtags at the end
    if len(post) > 1050:
        post = _trim_post(post, client)

    return post


def _trim_post(post: str, client) -> str:
    """Ask Claude to shorten the post to fit the 950-1050 char target."""
    prompt = f"""This social media post is {len(post)} characters. Shorten it to between 950 and 1050 characters.

Keep the 5 hashtags at the end unchanged. Cut from the body — remove full sentences, not mid-sentence. Return ONLY the trimmed post.

POST:
{post}"""

    message = client.messages.create(
        model=MODEL_ID,
        max_tokens=600,
        messages=[{"role": "user", "content": prompt}],
    )
    return message.content[0].text.strip()


def generate_image_prompt(post_text: str, client) -> str:
    """Ask Claude to write a DALL-E prompt based on the post."""
    message = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=150,
        messages=[{
            "role": "user",
            "content": (
                "Write a DALL-E 3 image prompt for this social media post about AI.\n\n"
                f"POST:\n{post_text[:600]}\n\n"
                "Requirements:\n"
                "- Clean, photorealistic or polished digital art style\n"
                "- No text or words in the image\n"
                "- Visually striking, suitable for social media\n"
                "- Represents the core theme of the post\n\n"
                "Return ONLY the image prompt. One to two sentences."
            ),
        }],
    )
    return message.content[0].text.strip()


def generate_image(image_prompt: str, output_path: Path) -> str | None:
    """Generate an image with DALL-E 3 and save it. Returns path or None."""
    try:
        import openai  # type: ignore
    except ImportError:
        print("  openai package not installed — run: pip install openai")
        return None

    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key:
        print("  OPENAI_API_KEY not set — skipping image generation")
        return None

    oa_client = openai.OpenAI(api_key=api_key)
    response = oa_client.images.generate(
        model=IMAGE_MODEL,
        prompt=image_prompt,
        size="1024x1024",
        quality="standard",
        n=1,
    )
    image_url = response.data[0].url
    req = urllib.request.Request(image_url, headers={"User-Agent": "ai-trend-post/1.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        image_data = resp.read()

    output_path.write_bytes(image_data)
    return str(output_path)


# ── Output ────────────────────────────────────────────────────────────────────

def save_outputs(
    date_str: str,
    post_text: str,
    image_path: str | None,
    image_prompt: str | None,
    news_source: str,
    news_items: list[dict],
) -> Path:
    """Persist post text, image, and metadata JSON."""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    post_file = OUTPUT_DIR / f"{date_str}-ai-post.txt"
    post_file.write_text(post_text)

    meta = {
        "date": date_str,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "post_text": post_text,
        "char_count": len(post_text),
        "image_path": image_path,
        "image_prompt": image_prompt,
        "news_source": news_source,
        "headlines_used": [i["title"] for i in news_items[:10]],
    }
    meta_file = OUTPUT_DIR / f"{date_str}-ai-post.json"
    meta_file.write_text(json.dumps(meta, indent=2))

    return post_file


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Generate daily AI trend post")
    parser.add_argument("--dry-run", action="store_true", help="Print output, do not save files")
    parser.add_argument("--no-image", action="store_true", help="Skip image generation")
    parser.add_argument("--date", help="Override date label (YYYY-MM-DD)")
    args = parser.parse_args()

    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        print("ERROR: ANTHROPIC_API_KEY is not set", file=sys.stderr)
        sys.exit(1)

    try:
        import anthropic  # type: ignore
    except ImportError:
        print("ERROR: anthropic package not installed — run: pip install anthropic", file=sys.stderr)
        sys.exit(1)

    client = anthropic.Anthropic(api_key=api_key)
    date_str = args.date or datetime.now().strftime("%Y-%m-%d")

    print(f"[{datetime.now().strftime('%H:%M:%S')}] Generating AI post for {date_str}")

    # 1. Fetch news
    print("  Fetching trending AI news...")
    news_items, news_source = get_trending_news()
    if not news_items:
        print("  No news items found — Claude will use its own knowledge")
        news_items = [{"title": "Latest AI developments", "summary": ""}]
    print(f"  {len(news_items)} items via {news_source}")

    # 2. Generate post
    print("  Generating post...")
    post_text = generate_post(news_items, date_str, client)
    char_count = len(post_text)

    print(f"\n{'─' * 64}")
    print(post_text)
    print(f"{'─' * 64}")
    print(f"Characters: {char_count}")

    if char_count < 900 or char_count > 1100:
        print(f"  WARNING: character count {char_count} is outside 950-1050 target")

    # 3. Generate image
    image_path: str | None = None
    image_prompt: str | None = None

    if not args.no_image:
        print("\n  Generating image prompt...")
        image_prompt = generate_image_prompt(post_text, client)
        print(f"  Prompt: {image_prompt}")

        if not args.dry_run:
            img_file = OUTPUT_DIR / f"{date_str}-ai-post.png"
            print("  Generating image with DALL-E 3...")
            image_path = generate_image(image_prompt, img_file)
            if image_path:
                print(f"  Image saved: {image_path}")

    # 4. Save
    if args.dry_run:
        print("\n[DRY RUN — files not saved]")
    else:
        post_file = save_outputs(date_str, post_text, image_path, image_prompt, news_source, news_items)
        print(f"\nPost saved:  {post_file}")
        print(f"Metadata:    {post_file.with_suffix('.json')}")
        if image_path:
            print(f"Image:       {image_path}")

    print(f"[{datetime.now().strftime('%H:%M:%S')}] Done")


if __name__ == "__main__":
    main()
