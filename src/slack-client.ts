import { WebClient } from '@slack/web-api';

export interface SlackMessage {
  id: string;
  text: string;
  timestamp: string;
  userId: string;
  username?: string;
  appId?: string;
  botId?: string;
  subtype?: string;
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
          // Filter out messages from bitrise or automated release notes
          const text = msg.text.toLowerCase();
          const username = msg.username?.toLowerCase() || '';
          const appId = msg.app_id || '';
          const botId = msg.bot_id || '';
          
          // Check if message should be filtered
          const isBitrise = username.includes('bitrise') || 
                           text.includes('bitrise') ||
                           appId.includes('bitrise') ||
                           botId.includes('bitrise');
          
          const isAutomatedReleaseNotes = username.includes('automated release notes') ||
                                         username.includes('automated-release-notes') ||
                                         text.includes('automated release notes') ||
                                         appId.includes('automated-release-notes') ||
                                         botId.includes('automated-release-notes');
          
          if (isBitrise || isAutomatedReleaseNotes) {
            continue;
          }

          messages.push({
            id: msg.ts,
            text: msg.text,
            timestamp: msg.ts,
            userId: msg.user ?? '',
            username: msg.username,
            appId: msg.app_id,
            botId: msg.bot_id,
            subtype: msg.subtype,
          });
        }
      }

      cursor = response.response_metadata?.next_cursor;
    } while (cursor);

    return messages;
  }
}
