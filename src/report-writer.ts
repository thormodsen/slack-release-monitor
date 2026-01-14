import { writeFile } from 'node:fs/promises';
import type { Release } from './release-extractor.js';

const DEFAULT_FILENAME = 'releases.html';

export class ReportWriter {
  private filepath: string;
  private workspace: string;
  private channelId: string;

  constructor(workspace: string, channelId: string, filepath: string = DEFAULT_FILENAME) {
    this.filepath = filepath;
    this.workspace = workspace;
    this.channelId = channelId;
  }

  async writeReleases(releases: Release[]): Promise<void> {
    if (releases.length === 0) {
      return;
    }

    const content = this.formatHtml(releases);
    await writeFile(this.filepath, content, 'utf-8');
  }

  private buildSlackUrl(messageId: string): string {
    const timestamp = messageId.replace('.', '');
    return `https://${this.workspace}.slack.com/archives/${this.channelId}/p${timestamp}`;
  }

  private formatHtml(releases: Release[]): string {
    // Group releases by date
    const releasesByDate = new Map<string, Release[]>();
    for (const release of releases) {
      const date = release.date;
      if (!releasesByDate.has(date)) {
        releasesByDate.set(date, []);
      }
      releasesByDate.get(date)!.push(release);
    }

    // Format date for display (e.g., "December 5, 2025")
    const formatDisplayDate = (dateStr: string): string => {
      const date = new Date(dateStr + 'T00:00:00');
      return date.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      });
    };

    // Extract platform info from title
    const extractPlatforms = (title: string): string[] => {
      const platforms: string[] = [];
      if (/iOS|ios|iPhone|iPad/i.test(title)) platforms.push('iOS');
      if (/Android|android/i.test(title)) platforms.push('Android');
      if (/Web|web|WebApp/i.test(title)) platforms.push('Web');
      return platforms;
    };

    // Determine feature type from title/description
    const getFeatureType = (title: string, description: string): string => {
      const text = (title + ' ' + description).toLowerCase();
      if (/new|feature|added|introduced/i.test(text) && !/fix|bug|improvement/i.test(text)) {
        return 'New Feature';
      }
      if (/improvement|enhanced|improved|better/i.test(text)) {
        return 'Improvement';
      }
      if (/fix|bug|issue|resolved|fixed/i.test(text)) {
        return 'Bug Fix';
      }
      return 'Update';
    };

    const sections = Array.from(releasesByDate.entries())
      .sort(([dateA], [dateB]) => dateB.localeCompare(dateA))
      .map(([date, dateReleases]) => {
        const displayDate = formatDisplayDate(date);
        const items = dateReleases
          .map((r) => {
            const url = this.buildSlackUrl(r.sourceMessageId);
            const platforms = extractPlatforms(r.title);
            const featureType = getFeatureType(r.title, r.description);
            const platformTag = platforms.length > 0 ? platforms.join(' · ') : null;

            const whyThisMattersSection = r.whyThisMatters
              ? `        <div class="highlight-section">
          <span class="highlight-label">WHY THIS MATTERS</span>
          <p class="highlight-content">${this.escapeHtml(r.whyThisMatters)}</p>
        </div>`
              : '';

            const impactSection = r.impact
              ? `        <div class="highlight-section">
          <span class="highlight-label">IMPACT</span>
          <p class="highlight-content">${this.escapeHtml(r.impact)}</p>
        </div>`
              : '';

            return `      <div class="release-card">
        <div class="card-header">
          <h3 class="card-title">
            <a href="${url}" target="_blank" class="title-link">
              ${this.escapeHtml(r.title)}
              <svg class="external-icon" width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M11 3H9.5V1.5H12.5V4.5H11V3Z" fill="currentColor"/>
                <path d="M3 3H7V4.5H4.5V9.5H9.5V7H11V11H3V3Z" fill="currentColor"/>
              </svg>
            </a>
          </h3>
          <div class="card-tags">
            <span class="tag tag-type">${this.escapeHtml(featureType)}</span>
            ${platformTag ? `<span class="tag tag-platform">${this.escapeHtml(platformTag)}</span>` : ''}
          </div>
        </div>
        <p class="card-description">${this.escapeHtml(r.description)}</p>
${whyThisMattersSection}
${impactSection}
      </div>`;
          })
          .join('\n\n');

        return `    <div class="date-section">
      <div class="date-badge">
        <span class="date-dot"></span>
        <span class="date-text">${displayDate}</span>
      </div>
      <div class="releases-container">
${items}
      </div>
    </div>`;
      })
      .join('\n\n');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Releases</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif;
      background-color: #2442F9;
      min-height: 100vh;
      padding: 2rem 1rem;
      line-height: 1.6;
    }

    .main-container {
      max-width: 900px;
      margin: 0 auto;
      background-color: #ffffff;
      border-radius: 12px;
      box-shadow: 0 4px 24px rgba(0, 0, 0, 0.1);
      padding: 2rem;
      position: relative;
    }

    .date-section {
      margin-bottom: 2rem;
    }

    .date-section:last-child {
      margin-bottom: 0;
    }

    .date-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      background-color: #2A2A2A;
      color: #ffffff;
      padding: 0.5rem 1rem;
      border-radius: 8px;
      font-weight: 600;
      font-size: 0.9rem;
      margin-bottom: 1.5rem;
      position: relative;
      z-index: 1;
    }

    .date-dot {
      width: 8px;
      height: 8px;
      background-color: #CCFF00;
      border-radius: 50%;
      display: inline-block;
    }

    .date-text {
      color: #ffffff;
    }

    .releases-container {
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }

    .release-card {
      background-color: #ffffff;
      border-radius: 12px;
      padding: 1.5rem;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
      transition: box-shadow 0.2s ease;
    }

    .release-card:hover {
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
    }

    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 1rem;
      gap: 1rem;
      flex-wrap: wrap;
    }

    .card-title {
      flex: 1;
      min-width: 200px;
    }

    .title-link {
      color: #2442F9;
      text-decoration: none;
      font-size: 1.25rem;
      font-weight: 600;
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      transition: opacity 0.2s ease;
    }

    .title-link:hover {
      opacity: 0.8;
    }

    .external-icon {
      color: #2442F9;
      flex-shrink: 0;
    }

    .card-tags {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
      align-items: center;
    }

    .tag {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      border-radius: 6px;
      font-size: 0.75rem;
      font-weight: 500;
      background-color: #E0E0E0;
      color: #2A2A2A;
      white-space: nowrap;
    }

    .tag-type {
      background-color: #E0E0E0;
    }

    .tag-platform {
      background-color: #E0E0E0;
    }

    .card-description {
      color: #2A2A2A;
      font-size: 0.95rem;
      line-height: 1.6;
      margin-top: 0.5rem;
    }

    .highlight-section {
      margin-top: 1rem;
    }

    .highlight-label {
      display: inline-block;
      font-weight: 700;
      font-size: 0.75rem;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: #2A2A2A;
      background-color: #CCFF00;
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      margin-bottom: 0.5rem;
    }

    .highlight-content {
      color: #2A2A2A;
      font-size: 0.95rem;
      line-height: 1.6;
      margin: 0;
    }

    @media (max-width: 768px) {
      body {
        padding: 1rem 0.5rem;
      }

      .main-container {
        padding: 1.5rem;
        border-radius: 8px;
      }

      .card-header {
        flex-direction: column;
        align-items: flex-start;
      }

      .card-title {
        width: 100%;
      }

      .title-link {
        font-size: 1.1rem;
      }
    }
  </style>
</head>
<body>
  <div class="main-container">
${sections}
  </div>
</body>
</html>`;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
