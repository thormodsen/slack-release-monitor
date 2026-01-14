import { readFile, writeFile, access } from 'node:fs/promises';
import type { LangfuseClient } from './langfuse-client.js';

interface ParsedRelease {
  date: string;
  title: string;
  description: string;
}


interface OpenRouterConfig {
  model?: string;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  httpReferer?: string;
  xTitle?: string;
}

export class WeeklySummarizer {
  private apiKey: string;
  private releasesPath: string;
  private readonly apiUrl = 'https://openrouter.ai/api/v1/chat/completions';
  private readonly defaultModel = 'anthropic/claude-sonnet-4';
  private readonly defaultMaxTokens = 2048;
  private langfuse: LangfuseClient | null;

  constructor(apiKey: string, releasesPath: string = 'releases.md', langfuse?: LangfuseClient | null) {
    this.apiKey = apiKey;
    this.releasesPath = releasesPath;
    this.langfuse = langfuse ?? null;
  }

  async generateWeeklySummary(): Promise<string> {
    const releases = await this.parseRecentReleases();
    const outputPath = this.getOutputPath();

    if (releases.length === 0) {
      await writeFile(outputPath, this.formatEmptySummary(), 'utf-8');
      return outputPath;
    }

    const summary = await this.summarizeWithClaude(releases);
    await writeFile(outputPath, summary, 'utf-8');

    return outputPath;
  }

  private async parseRecentReleases(): Promise<ParsedRelease[]> {
    const content = await this.readReleasesFile();
    if (!content) {
      return [];
    }

    const releases = this.parseMarkdown(content);
    const sevenDaysAgo = this.getSevenDaysAgo();

    return releases.filter((r) => r.date >= sevenDaysAgo);
  }

  private async readReleasesFile(): Promise<string> {
    try {
      await access(this.releasesPath);
      return await readFile(this.releasesPath, 'utf-8');
    } catch {
      return '';
    }
  }

  private parseMarkdown(content: string): ParsedRelease[] {
    const releases: ParsedRelease[] = [];
    const entryPattern = /^## (\d{4}-\d{2}-\d{2}) - (.+)$/gm;
    const entries = content.split(/(?=^## \d{4}-\d{2}-\d{2})/m).filter(Boolean);

    for (const entry of entries) {
      const match = entryPattern.exec(entry);
      entryPattern.lastIndex = 0;

      if (match) {
        const [, date, title] = match;
        const descriptionStart = entry.indexOf('\n\n');
        const description =
          descriptionStart !== -1
            ? entry.slice(descriptionStart + 2).trim()
            : '';

        releases.push({ date, title, description });
      }
    }

    return releases;
  }

  private getSevenDaysAgo(): string {
    const date = new Date();
    date.setDate(date.getDate() - 7);
    return date.toISOString().split('T')[0];
  }

  private getOutputPath(): string {
    const today = new Date().toISOString().split('T')[0];
    return `weekly-summary-${today}.md`;
  }

  private formatEmptySummary(): string {
    return '# Weekly Summary\n\nNo releases found in the last 7 days.';
  }

  private async summarizeWithClaude(
    releases: ParsedRelease[]
  ): Promise<string> {
    // Fetch prompt and config from Langfuse - fail if Langfuse is enabled but prompt is unavailable
    let prompt: string;
    let config: OpenRouterConfig = {};

    if (this.langfuse?.isEnabled()) {
      const langfuseResult = await this.langfuse.getPromptWithConfig('weekly-summary');
      if (!langfuseResult) {
        throw new Error(
          'Langfuse is enabled but prompt "weekly-summary" was not found. ' +
          'Please create the prompt in Langfuse or disable Langfuse in your configuration.'
        );
      }

      prompt = langfuseResult.prompt;
      
      // Extract config values
      if (langfuseResult.config.model) {
        config.model = String(langfuseResult.config.model);
      }
      if (langfuseResult.config.max_tokens) {
        config.max_tokens = Number(langfuseResult.config.max_tokens);
      }
      if (langfuseResult.config.temperature !== undefined) {
        config.temperature = Number(langfuseResult.config.temperature);
      }
      if (langfuseResult.config.top_p !== undefined) {
        config.top_p = Number(langfuseResult.config.top_p);
      }
      if (langfuseResult.config.httpReferer) {
        config.httpReferer = String(langfuseResult.config.httpReferer);
      }
      if (langfuseResult.config.xTitle) {
        config.xTitle = String(langfuseResult.config.xTitle);
      }
    } else {
      throw new Error(
        'Langfuse is required for weekly summary generation. ' +
        'Please configure Langfuse in your settings or enable it in your configuration.'
      );
    }

    const formattedReleases = releases
      .map((r) => `## ${r.date} - ${r.title}\n\n${r.description}`)
      .join('\n\n');

    const userContent = `${prompt}\n\nReleases from the last 7 days:\n\n${formattedReleases}`;

    // Use config values or defaults (needed for trace)
    const model = config.model || this.defaultModel;
    const maxTokens = config.max_tokens || this.defaultMaxTokens;

    // Create Langfuse trace if enabled
    const trace = this.langfuse?.isEnabled()
      ? this.langfuse.trace('weekly-summary', {
          releaseCount: releases.length,
          model,
        })
      : null;

    const generation = trace
      ? trace.generation({
          name: 'summarize-releases',
          model,
          modelParameters: {
            max_tokens: maxTokens,
            ...(config.temperature !== undefined && { temperature: config.temperature }),
            ...(config.top_p !== undefined && { top_p: config.top_p }),
          },
          input: userContent,
        })
      : null;

    // Build request body with config values
    const requestBody: Record<string, unknown> = {
      model,
      max_tokens: maxTokens,
      messages: [
        {
          role: 'user',
          content: userContent,
        },
      ],
    };

    // Add optional parameters if present in config
    if (config.temperature !== undefined) {
      requestBody.temperature = config.temperature;
    }
    if (config.top_p !== undefined) {
      requestBody.top_p = config.top_p;
    }

    // Build headers
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': config.httpReferer || 'https://github.com/thormodsen/changelog-creator',
      'X-Title': config.xTitle || 'Slack Release Monitor',
    };

    const response = await fetch(this.apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      if (generation) {
        generation.end({
          level: 'ERROR',
          statusMessage: `OpenRouter API error: ${response.status} ${response.statusText}`,
        });
      }
      throw new Error(`OpenRouter API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    const textContent = data.choices?.[0]?.message?.content;

    if (!textContent) {
      if (generation) {
        generation.end({
          level: 'WARNING',
          statusMessage: 'No content in response',
        });
      }
      return this.formatEmptySummary();
    }

    // Log the generation to Langfuse
    if (generation) {
      generation.end({
        output: textContent,
        usage: {
          input: data.usage?.prompt_tokens ?? 0,
          output: data.usage?.completion_tokens ?? 0,
          total: data.usage?.total_tokens ?? 0,
        },
      });
    }

    return `# Weekly Summary\n\n${textContent}`;
  }
}
