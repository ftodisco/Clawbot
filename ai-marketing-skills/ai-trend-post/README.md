# AI Trend Post

Generates a daily ~1000-character social media post about trending AI technology, with 5 hashtags and a matching image. Runs automatically at 3pm every day via cron.

## How It Works

```
3:00 PM daily
     │
     ▼
┌─────────────────┐
│  Fetch AI News  │  RSS feeds or Tavily API
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Generate Post  │  Claude — ~1000 chars + 5 hashtags
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Generate Image │  DALL-E 3 (optional)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Save Output   │  .txt + .json + .png → ./output/
└─────────────────┘
```

## Setup

### 1. Install dependencies

```bash
pip install anthropic
pip install openai      # optional — for DALL-E 3 images
```

### 2. Configure API keys

```bash
cp .env.example .env
# Edit .env:
#   ANTHROPIC_API_KEY=sk-ant-...   (required)
#   OPENAI_API_KEY=sk-...          (optional, for images)
#   TAVILY_API_KEY=tvly-...        (optional, for live news)
```

### 3. Test it

```bash
source .env && python daily_ai_post.py --dry-run
```

### 4. Schedule at 3pm daily

```bash
bash setup-cron.sh
```

That's it. Every day at 3pm the script runs, fetches today's top AI news, writes a post, generates an image, and saves everything to `./output/`.

## Output Files

```
output/
  2025-06-10-ai-post.txt     ← post text, ready to publish
  2025-06-10-ai-post.json    ← metadata + sources
  2025-06-10-ai-post.png     ← generated image
```

## Managing the Cron Job

```bash
# View the scheduled job
crontab -l

# Remove it
bash setup-cron.sh --remove

# Change to a different time — edit crontab directly
crontab -e
# Change "0 15" to your preferred hour (24h format)
# e.g. "0 9" = 9am, "0 18" = 6pm
```

## Logs

```bash
tail -f output/cron.log
```
