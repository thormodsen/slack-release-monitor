import Anthropic from '@anthropic-ai/sdk';
import type { SlackMessage } from './slack-client.js';

export interface Release {
  date: string;
  title: string;
  description: string;
  sourceMessageId: string;
}

const EXTRACTION_PROMPT = `You are analyzing Slack messages to extract release information.

Identify any messages that mention:
- Software releases or version updates
- Deployments to production or staging
- Shipped features or functionality
- Hotfixes or bug fixes that were deployed

For each release found, extract:
- date: The date in YYYY-MM-DD format (derive from message timestamp or mentioned date)
- title: A brief title for the release
- description: A summary of what was released/changed
- sourceMessageId: The ID of the message containing this release

Respond with a JSON array. If no releases are found, respond with an empty array [].

Example output:
[{"date":"2024-01-15","title":"v2.1.0 Release","description":"Added user authentication and fixed login bug","sourceMessageId":"1705312800.000100"}]

Only output valid JSON, nothing else.`;

export class ReleaseExtractor {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async extractReleases(messages: SlackMessage[]): Promise<Release[]> {
    if (messages.length === 0) {
      return [];
    }

    const formattedMessages = messages
      .map((m) => `[${m.id}] ${m.text}`)
      .join('\n\n');

    const response = await this.client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: `${EXTRACTION_PROMPT}\n\nMessages to analyze:\n\n${formattedMessages}`,
        },
      ],
    });

    const textContent = response.content.find((block) => block.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      return [];
    }

    try {
      const releases = JSON.parse(textContent.text) as Release[];
      return Array.isArray(releases) ? releases : [];
    } catch {
      return [];
    }
  }
}
