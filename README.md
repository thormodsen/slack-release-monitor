# slack-release-monitor

CLI tool that monitors a Slack channel for release announcements, uses OpenRouter (Claude) to extract structured release info, and maintains a markdown changelog.

## Setup

```bash
npm install
npm run build
```

Copy `.env.example` to `.env` and fill in:
- `SLACK_TOKEN` - Bot token with `channels:history`, `channels:read` scopes
- `OPENROUTER_API_KEY` - Your OpenRouter API key (get one at https://openrouter.ai)
- `SLACK_WORKSPACE` - Your Slack workspace name (e.g., "myworkspace" for myworkspace.slack.com)
- `SLACK_CHANNEL_ID` - Channel to monitor

## Usage

```bash
# Process last 7 days
node dist/index.js --days 7

# Process specific date range
node dist/index.js --start 2025-12-01 --days 7

# Generate weekly summary from existing releases.md
node dist/index.js --weekly-summary

# Debug mode
node dist/index.js --days 7 --verbose
```

## How it works

1. Fetches messages from the configured Slack channel
2. Filters out already-processed messages (tracked in `.release-monitor-state.json`)
3. Sends messages to OpenRouter (Claude) to extract release/deployment info
4. Appends extracted releases to `releases.html`
5. Updates state file to avoid reprocessing

## Output

- `releases.html` - Running log of extracted releases (HTML format)
- `weekly-summary-YYYY-MM-DD.md` - Generated weekly digests (reads from `releases.md` if present)
