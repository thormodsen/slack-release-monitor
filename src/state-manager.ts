import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { SlackMessage } from './slack-client.js';

const STATE_FILE = '.release-monitor-state.json';

interface State {
  processedIds: string[];
}

export class StateManager {
  private statePath: string;
  private processedIds: Set<string>;

  constructor(cwd: string = process.cwd()) {
    this.statePath = `${cwd}/${STATE_FILE}`;
    this.processedIds = new Set();
  }

  async load(): Promise<void> {
    if (!existsSync(this.statePath)) {
      this.processedIds = new Set();
      return;
    }

    const content = await readFile(this.statePath, 'utf-8');
    const state: State = JSON.parse(content);
    this.processedIds = new Set(state.processedIds);
  }

  getUnprocessedMessages(messages: SlackMessage[]): SlackMessage[] {
    return messages.filter((msg) => !this.processedIds.has(msg.id));
  }

  async markProcessed(ids: string[]): Promise<void> {
    for (const id of ids) {
      this.processedIds.add(id);
    }
    await this.persist();
  }

  private async persist(): Promise<void> {
    const state: State = {
      processedIds: Array.from(this.processedIds),
    };
    await writeFile(this.statePath, JSON.stringify(state, null, 2));
  }
}
