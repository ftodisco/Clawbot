#!/usr/bin/env bash
# setup-cron.sh — Schedule daily AI post at 3:00 PM
#
# Usage:
#   bash setup-cron.sh           # install cron job (3pm system time)
#   bash setup-cron.sh --remove  # remove the cron job
#
# The cron job sources ~/.ai-trend-post.env for API keys.
# Create that file once with your keys — see instructions below.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYTHON="$(command -v python3)"
MARKER="# ai-trend-post daily"
ENV_FILE="$HOME/.ai-trend-post.env"
LOG_FILE="$SCRIPT_DIR/output/cron.log"
CRON_ENTRY="0 15 * * * . \"$ENV_FILE\" && cd \"$SCRIPT_DIR\" && $PYTHON daily_ai_post.py >> \"$LOG_FILE\" 2>&1 $MARKER"

mkdir -p "$SCRIPT_DIR/output"

# ── Remove mode ───────────────────────────────────────────────────────────────
if [[ "${1:-}" == "--remove" ]]; then
    if crontab -l 2>/dev/null | grep -qF "$MARKER"; then
        crontab -l 2>/dev/null | grep -vF "$MARKER" | crontab -
        echo "Cron job removed."
    else
        echo "No ai-trend-post cron job found."
    fi
    exit 0
fi

# ── Install mode ──────────────────────────────────────────────────────────────
if crontab -l 2>/dev/null | grep -qF "$MARKER"; then
    echo "Cron job already installed. Run with --remove to uninstall first."
    exit 0
fi

# Create env file if it doesn't exist
if [[ ! -f "$ENV_FILE" ]]; then
    cat > "$ENV_FILE" <<'EOF'
# AI Trend Post — API keys
# This file is sourced by cron. Keep it private (chmod 600).

export ANTHROPIC_API_KEY="your_anthropic_key_here"
export OPENAI_API_KEY="your_openai_key_here"       # optional — for DALL-E 3 images
export TAVILY_API_KEY="your_tavily_key_here"        # optional — for live news search

# Optional overrides
# export POST_OUTPUT_DIR="/path/to/output"
# export POST_TIMEZONE="America/New_York"
EOF
    chmod 600 "$ENV_FILE"
    echo "Created $ENV_FILE"
    echo "  -> Edit it and fill in your API keys before the first run."
    echo ""
fi

# Add cron job
(crontab -l 2>/dev/null; echo "$CRON_ENTRY") | crontab -

echo "Cron job installed: daily AI post at 3:00 PM (system time)"
echo ""
echo "Schedule:   0 15 * * *"
echo "Script:     $SCRIPT_DIR/daily_ai_post.py"
echo "Logs:       $LOG_FILE"
echo "Env file:   $ENV_FILE"
echo ""
echo "To test immediately:"
echo "  . \"$ENV_FILE\" && cd \"$SCRIPT_DIR\" && python3 daily_ai_post.py --dry-run"
echo ""
echo "To remove:"
echo "  bash $SCRIPT_DIR/setup-cron.sh --remove"
