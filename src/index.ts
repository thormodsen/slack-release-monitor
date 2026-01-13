#!/usr/bin/env node

import { loadConfig } from './config.js';
import { SlackClient } from './slack-client.js';
import { StateManager } from './state-manager.js';
import { ReleaseExtractor } from './release-extractor.js';
import { ReportWriter } from './report-writer.js';
import { WeeklySummarizer } from './weekly-summarizer.js';

interface CliOptions {
  help: boolean;
  verbose: boolean;
  weeklySummary: boolean;
  days?: number;
  start?: string;
}

function parseArgs(args: string[]): CliOptions {
  const daysIndex = args.indexOf('--days');
  const days = daysIndex !== -1 ? parseInt(args[daysIndex + 1], 10) : undefined;
  const startIndex = args.indexOf('--start');
  const start = startIndex !== -1 ? args[startIndex + 1] : undefined;

  return {
    help: args.includes('--help') || args.includes('-h'),
    verbose: args.includes('--verbose') || args.includes('-v'),
    weeklySummary: args.includes('--weekly-summary'),
    days: days && !isNaN(days) ? days : undefined,
    start,
  };
}

function printHelp(): void {
  console.log(`
slack-release-monitor - Extract release info from Slack and maintain a changelog

USAGE:
  slack-release-monitor [OPTIONS]

OPTIONS:
  --help, -h        Print this help message
  --verbose, -v     Enable debug logging to stderr
  --start DATE      Start date (YYYY-MM-DD). Defaults to now if only --days is set
  --days N          Number of days to fetch (required with --start, or standalone for last N days)
  --weekly-summary  Generate a weekly summary instead of fetching new messages

ENVIRONMENT VARIABLES:
  SLACK_TOKEN       Slack Bot OAuth token (not required for --weekly-summary)
  ANTHROPIC_API_KEY Anthropic API key
  SLACK_CHANNEL_ID  Slack channel ID to monitor (not required for --weekly-summary)

BEHAVIOR:
  Default: Fetches messages from the configured Slack channel, filters out
  already-processed messages, uses Claude to extract release information,
  and appends new releases to releases.md.

  --weekly-summary: Reads releases.md, filters to last 7 days, uses Claude
  to summarize, and writes to weekly-summary-YYYY-MM-DD.md.
`.trim());
}

function log(message: string, verbose: boolean): void {
  if (verbose) {
    console.error(`[DEBUG] ${message}`);
  }
}

function calculateTimeWindow(start?: string, days?: number): { oldest?: number; latest?: number } {
  const msPerDay = 24 * 60 * 60 * 1000;

  if (start && days) {
    const oldest = new Date(start).getTime();
    const latest = oldest + days * msPerDay;
    return { oldest, latest };
  }

  if (days) {
    const oldest = Date.now() - days * msPerDay;
    return { oldest, latest: undefined };
  }

  return { oldest: undefined, latest: undefined };
}

async function runWeeklySummary(options: CliOptions): Promise<void> {
  log('Loading API key...', options.verbose);
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY environment variable is required');
  }

  log('Generating weekly summary...', options.verbose);
  const summarizer = new WeeklySummarizer(apiKey);
  const outputPath = await summarizer.generateWeeklySummary();

  log(`Summary written to ${outputPath}`, options.verbose);
  console.log(`Weekly summary generated: ${outputPath}`);
}

async function run(options: CliOptions): Promise<void> {
  log('Loading configuration...', options.verbose);
  const config = loadConfig();

  log('Initializing Slack client...', options.verbose);
  const slackClient = new SlackClient(config.slackToken, config.slackChannelId);

  log('Loading state...', options.verbose);
  const stateManager = new StateManager();
  await stateManager.load();

  const { oldest, latest } = calculateTimeWindow(options.start, options.days);
  log(`Time window: ${oldest ? new Date(oldest).toISOString() : 'beginning'} to ${latest ? new Date(latest).toISOString() : 'now'}`, options.verbose);

  log('Fetching messages from Slack...', options.verbose);
  const allMessages = await slackClient.fetchMessages(oldest, latest);
  log(`Fetched ${allMessages.length} messages`, options.verbose);

  const unprocessedMessages = stateManager.getUnprocessedMessages(allMessages);
  log(`${unprocessedMessages.length} unprocessed messages`, options.verbose);

  if (unprocessedMessages.length === 0) {
    log('No new messages to process', options.verbose);
    return;
  }

  log('Extracting releases with Claude...', options.verbose);
  const extractor = new ReleaseExtractor(config.anthropicApiKey);
  const releases = await extractor.extractReleases(unprocessedMessages);
  log(`Extracted ${releases.length} releases`, options.verbose);

  if (releases.length > 0) {
    log('Writing releases to markdown...', options.verbose);
    const writer = new ReportWriter();
    await writer.appendReleases(releases);
  }

  log('Updating state...', options.verbose);
  await stateManager.markProcessed(unprocessedMessages.map((m) => m.id));

  log('Done!', options.verbose);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  try {
    if (options.weeklySummary) {
      await runWeeklySummary(options);
    } else {
      await run(options);
    }
    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}

main();
