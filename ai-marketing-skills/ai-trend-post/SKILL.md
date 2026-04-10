---
name: ai-trend-post
description: Generate a daily ~1000-character social media post on trending AI technology news, with 5 hashtags and a DALL-E 3 image. Scheduled via cron at 3pm daily.
---

# AI Trend Post

Generates a daily social media post about the most interesting AI story trending that day. Fetches live news, writes a punchy ~1000-character post with 5 hashtags, and creates a matching image.

## When to Use

- User wants a daily AI news post on social media
- User wants automated AI content at a fixed time each day
- User needs a post + image combo ready to publish

## Quick Start

```bash
# 1. Install dependencies
pip install -r requirements.txt
pip install openai  # optional, for DALL-E 3 images

# 2. Set API keys
cp .env.example .env
# Edit .env and fill in ANTHROPIC_API_KEY (+ OPENAI_API_KEY for images)

# 3. Test a dry run
source .env && python daily_ai_post.py --dry-run

# 4. Install 3pm daily cron job
bash setup-cron.sh
```

## Output

Each run produces two files in `./output/` (or `$POST_OUTPUT_DIR`):

| File | Contents |
|------|----------|
| `YYYY-MM-DD-ai-post.txt` | The post text, ready to copy-paste |
| `YYYY-MM-DD-ai-post.json` | Metadata: headline sources, char count, image prompt, timestamp |
| `YYYY-MM-DD-ai-post.png` | Generated image (if OPENAI_API_KEY is set) |

## Post Format

- ~1000 characters (950–1050 target)
- Covers the top trending AI story or theme of the day
- Includes one specific fact, stat, or development
- Ends with exactly 5 hashtags (always starts with `#AI`)
- No corporate speak, no filler

## News Sources

The script pulls from multiple sources in priority order:

1. **Tavily** (if `TAVILY_API_KEY` is set) — live AI news search
2. **RSS feeds** (free, no key required) — TechCrunch AI, VentureBeat AI, The Verge, HuggingFace Blog

## Scheduling

The cron job runs at `0 15 * * *` (3:00 PM system time).

To use a specific timezone, set your system timezone or prefix the cron command with `TZ=America/New_York`.

```bash
# View current cron jobs
crontab -l

# Remove the cron job
bash setup-cron.sh --remove
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Claude API key |
| `OPENAI_API_KEY` | No | OpenAI key for DALL-E 3 images |
| `TAVILY_API_KEY` | No | Tavily key for live news search |
| `POST_OUTPUT_DIR` | No | Output directory (default: `./output`) |

## CLI Flags

```
--dry-run     Print post to terminal, do not save files
--no-image    Skip image generation (faster, no OpenAI key needed)
--date        Override the date label, e.g. --date 2025-06-01
```
