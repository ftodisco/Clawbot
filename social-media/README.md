# Express Valet Services — Social Media Post Generator

Automated daily social media posts for **Express Valet Services** (expressvaleteservices.com) — premium dry cleaning, laundry pickup & delivery.

## What it does

- Generates **2 posts per day** (Instagram + Facebook)
- Each post focuses on a **different service** (rotates daily)
- Posts are **~700 characters** with **4 targeted hashtags**
- Produces a **DALL·E image prompt** (or auto-generates an image if OpenAI key is set)
- Optional **Claude AI** mode to generate fresh, unique copy each day

## Services Covered

| # | Service | Status |
|---|---------|--------|
| 1 | Dry Cleaning | Active |
| 2 | Laundry Pickup & Delivery | Active — 10 lb minimum |
| 3 | Stain Removal | Active |
| 4 | Comforter & Bedding Cleaning | Active |
| 5 | Curtain & Drape Cleaning | Active |
| 6 | Custom Alterations | Pending — tailor consultation |

**Business rules built into every post:**
- Flat **$100** fee covers pickup & delivery for any service
- **Daytime** pickup & delivery only
- **5-day** turnaround (no rush/same-day service)
- Laundry pickup requires a **10 lb minimum**

## Setup

```bash
cd social-media
npm install
cp .env.example .env
# Edit .env and add your API keys
```

## Usage

```bash
# Preview today's posts (no API calls, no files saved)
npm run preview

# Generate today's posts and save to ./output/<date>/
npm run generate

# Generate posts for a specific service (e.g., service id 3)
node generate.js --service 3

# Start the automatic daily scheduler (9 AM + 5 PM)
npm run schedule
```

## Output

Each run creates a folder `output/YYYY-MM-DD/` containing:

- `posts.json` — Instagram caption, Facebook caption, image prompt
- `*.png` — AI-generated image (requires OpenAI key)

## Configuration (`.env`)

| Variable | Description | Default |
|----------|-------------|---------|
| `ANTHROPIC_API_KEY` | Claude API key for AI post generation | — |
| `OPENAI_API_KEY` | OpenAI key for DALL·E image generation | — |
| `USE_AI_GENERATION` | Use Claude to write fresh copy | `false` |
| `OUTPUT_DIR` | Where to save generated files | `./output` |
| `MORNING_POST_TIME` | Cron expression for morning post | `0 9 * * *` |
| `EVENING_POST_TIME` | Cron expression for evening post | `0 17 * * *` |

## Pre-written Post Content

All 7 service posts (Instagram + Facebook versions) are pre-written in [`posts-content.json`](./posts-content.json). You can edit them at any time — no code changes needed.
