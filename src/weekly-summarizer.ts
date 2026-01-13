import { readFile, writeFile, access } from 'node:fs/promises';

interface ParsedRelease {
  date: string;
  title: string;
  description: string;
}

const SUMMARY_PROMPT = `You are summarizing a week of software releases for a team digest.

Given the following releases, create a concise summary that includes:
1. Key Highlights: The most significant releases or changes (2-4 bullet points)
2. Common Themes: Patterns or areas of focus this week
3. Total Release Count: The number of releases

Keep the tone professional but readable. Use markdown formatting.

Only output the summary, nothing else.`;

export class WeeklySummarizer {
  private apiKey: string;
  private releasesPath: string;
  private readonly apiUrl = 'https://openrouter.ai/api/v1/chat/completions';
  private readonly model = 'anthropic/claude-sonnet-4';

  constructor(apiKey: string, releasesPath: string = 'releases.md') {
    this.apiKey = apiKey;
    this.releasesPath = releasesPath;
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
    const formattedReleases = releases
      .map((r) => `## ${r.date} - ${r.title}\n\n${r.description}`)
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
        max_tokens: 2048,
        messages: [
          {
            role: 'user',
            content: `${SUMMARY_PROMPT}\n\nReleases from the last 7 days:\n\n${formattedReleases}`,
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
      return this.formatEmptySummary();
    }

    return `# Weekly Summary\n\n${textContent}`;
  }
}
