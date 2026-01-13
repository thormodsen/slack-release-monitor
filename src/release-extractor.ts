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
- date: The date in YYYY-MM-DD format (use the date shown in brackets, e.g. [2025-12-01])
- title: A brief title for the release
- description: A summary of what was released/changed
- sourceMessageId: The ID of the message containing this release

Respond with a JSON array. If no releases are found, respond with an empty array [].

Example output:
[{"date":"2024-01-15","title":"v2.1.0 Release","description":"Added user authentication and fixed login bug","sourceMessageId":"1705312800.000100"}]

Only output valid JSON, nothing else.`;

export class ReleaseExtractor {
  private apiKey: string;
  private readonly apiUrl = 'https://openrouter.ai/api/v1/chat/completions';
  private readonly model = 'anthropic/claude-sonnet-4';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async extractReleases(messages: SlackMessage[]): Promise<Release[]> {
    if (messages.length === 0) {
      return [];
    }

    const formattedMessages = messages
      .map((m) => {
        const date = new Date(parseFloat(m.timestamp) * 1000).toISOString().split('T')[0];
        return `[${m.id}] [${date}] ${m.text}`;
      })
      .join('\n\n');

    const response = await fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/thormodsen/changelog-creator',
        'X-Title': 'Slack Release Monitor',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: `${EXTRACTION_PROMPT}\n\nMessages to analyze:\n\n${formattedMessages}`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`OpenRouter API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    const textContent = data.choices?.[0]?.message?.content;

    if (!textContent) {
      return [];
    }

    try {
      const releases = JSON.parse(textContent) as Release[];
      return Array.isArray(releases) ? releases : [];
    } catch {
      return [];
    }
  }
}
