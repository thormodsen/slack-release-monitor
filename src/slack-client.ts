import { WebClient } from '@slack/web-api';

export interface SlackMessage {
  id: string;
  text: string;
  timestamp: string;
  userId: string;
}

export class SlackClient {
  private client: WebClient;
  private channelId: string;

  constructor(token: string, channelId: string) {
    this.client = new WebClient(token);
    this.channelId = channelId;
  }

  async fetchMessages(oldest?: number, latest?: number): Promise<SlackMessage[]> {
    const messages: SlackMessage[] = [];
    let cursor: string | undefined;

    do {
      const response = await this.client.conversations.history({
        channel: this.channelId,
        cursor,
        limit: 200,
        oldest: oldest ? String(oldest / 1000) : undefined,
        latest: latest ? String(latest / 1000) : undefined,
      });

      if (!response.ok) {
        throw new Error(`Slack API error: ${response.error}`);
      }

      for (const msg of response.messages ?? []) {
        if (msg.ts && msg.text) {
          messages.push({
            id: msg.ts,
            text: msg.text,
            timestamp: msg.ts,
            userId: msg.user ?? '',
          });
        }
      }

      cursor = response.response_metadata?.next_cursor;
    } while (cursor);

    return messages;
  }
}
