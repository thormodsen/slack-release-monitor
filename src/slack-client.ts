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
  threadReplies?: SlackMessage[];
}

export class SlackClient {
  private client: WebClient;
  private channelId: string;
  private verbose: boolean;
  private botInfoCache: Map<string, { name?: string }> = new Map();

  constructor(token: string, channelId: string, verbose: boolean = false) {
    this.client = new WebClient(token);
    this.channelId = channelId;
    this.verbose = verbose;
  }

  private async getBotInfo(botId: string): Promise<{ name?: string } | null> {
    if (this.botInfoCache.has(botId)) {
      return this.botInfoCache.get(botId)!;
    }

    try {
      const response = await this.client.bots.info({ bot: botId });
      if (response.ok && response.bot) {
        const botInfo = {
          name: response.bot.name,
        };
        this.botInfoCache.set(botId, botInfo);
        return botInfo;
      }
    } catch (error) {
      // If bot info lookup fails, cache null to avoid repeated lookups
      this.botInfoCache.set(botId, {});
    }
    return null;
  }

  private async fetchThreadReplies(channelId: string, threadTs: string): Promise<SlackMessage[]> {
    const replies: SlackMessage[] = [];
    let cursor: string | undefined;

    do {
      try {
        const response = await this.client.conversations.replies({
          channel: channelId,
          ts: threadTs,
          cursor,
          limit: 100,
        });

        if (!response.ok) {
          if (this.verbose) {
            console.error(`[DEBUG] Failed to fetch thread replies for ${threadTs}: ${response.error}`);
          }
          break;
        }

        for (const msg of response.messages ?? []) {
          // Skip the parent message (it has the same ts as thread_ts)
          if (msg.ts === threadTs) {
            continue;
          }

          if (msg.ts && msg.text) {
            replies.push({
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
      } catch (error) {
        if (this.verbose) {
          console.error(`[DEBUG] Error fetching thread replies for ${threadTs}:`, error);
        }
        break;
      }
    } while (cursor);

    return replies;
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
          
          // Get bot name if bot_id is present
          let botName = '';
          if (botId) {
            const botInfo = await this.getBotInfo(botId);
            botName = botInfo?.name?.toLowerCase() || '';
          }
          
          // Known Automated Release Notes bot ID
          const isKnownAutomatedReleaseNotesBot = botId === 'B085LB91R52';
          
          // Check if message should be filtered
          const bitriseChecks = {
            username: username.includes('bitrise'),
            text: text.includes('bitrise'),
            appId: appId.includes('bitrise'),
            botId: botId.includes('bitrise'),
            botName: botName.includes('bitrise'),
          };
          const isBitrise = bitriseChecks.username || bitriseChecks.text || bitriseChecks.appId || bitriseChecks.botId || bitriseChecks.botName;
          
          const automatedReleaseNotesChecks = {
            usernameExact: username.includes('automated release notes'),
            usernameHyphen: username.includes('automated-release-notes'),
            text: text.includes('automated release notes'),
            appId: appId.includes('automated-release-notes'),
            botId: botId.includes('automated-release-notes'),
            botName: botName.includes('automated release notes') || botName.includes('automated-release-notes'),
            knownBotId: isKnownAutomatedReleaseNotesBot,
          };
          const isAutomatedReleaseNotes = automatedReleaseNotesChecks.usernameExact ||
                                         automatedReleaseNotesChecks.usernameHyphen ||
                                         automatedReleaseNotesChecks.text ||
                                         automatedReleaseNotesChecks.appId ||
                                         automatedReleaseNotesChecks.botId ||
                                         automatedReleaseNotesChecks.botName ||
                                         automatedReleaseNotesChecks.knownBotId;
          
          if (isBitrise || isAutomatedReleaseNotes) {
            // Only log filtered messages in verbose mode
            if (this.verbose) {
              console.error(`[FILTERED] Message ${msg.ts}:`);
              console.error(`  username: "${msg.username || '(none)'}"`);
              console.error(`  app_id: "${appId || '(none)'}"`);
              console.error(`  bot_id: "${botId || '(none)'}"`);
              console.error(`  bot_name: "${botName || '(none)'}"`);
              console.error(`  text (first 100 chars): "${msg.text.substring(0, 100)}"`);
              if (isBitrise) {
                console.error(`  Bitrise checks:`, bitriseChecks, `-> FILTERED (Bitrise)`);
              }
              if (isAutomatedReleaseNotes) {
                console.error(`  Automated Release Notes checks:`, automatedReleaseNotesChecks, `-> FILTERED (Automated Release Notes)`);
              }
            }
            continue;
          }

          // Fetch thread replies if this message has a thread
          let threadReplies: SlackMessage[] | undefined;
          if (msg.reply_count && msg.reply_count > 0) {
            if (this.verbose) {
              console.error(`[DEBUG] Fetching ${msg.reply_count} thread replies for message ${msg.ts}`);
            }
            threadReplies = await this.fetchThreadReplies(this.channelId, msg.ts);
            if (this.verbose && threadReplies.length > 0) {
              console.error(`[DEBUG] Fetched ${threadReplies.length} thread replies for message ${msg.ts}`);
            }
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
            threadReplies,
          });
        }
      }

      cursor = response.response_metadata?.next_cursor;
    } while (cursor);

    return messages;
  }
}
