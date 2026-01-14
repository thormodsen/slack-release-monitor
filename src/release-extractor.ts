import type { SlackMessage } from './slack-client.js';
import type { LangfuseClient } from './langfuse-client.js';

export interface Release {
  date: string;
  title: string;
  description: string;
  sourceMessageId: string;
  whyThisMatters?: string;
  impact?: string;
}


interface OpenRouterConfig {
  model?: string;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  // OpenRouter-specific headers
  httpReferer?: string;
  xTitle?: string;
}

export class ReleaseExtractor {
  private apiKey: string;
  private readonly apiUrl = 'https://openrouter.ai/api/v1/chat/completions';
  private readonly defaultModel = 'anthropic/claude-sonnet-4';
  private readonly defaultMaxTokens = 4096;
  private langfuse: LangfuseClient | null;
  private verbose: boolean;

  constructor(apiKey: string, langfuse?: LangfuseClient | null, verbose: boolean = false) {
    this.apiKey = apiKey;
    this.langfuse = langfuse ?? null;
    this.verbose = verbose;
  }

  async extractReleases(messages: SlackMessage[]): Promise<Release[]> {
    if (messages.length === 0) {
      return [];
    }

    // Fetch prompt and config from Langfuse - fail if Langfuse is enabled but prompt is unavailable
    let prompt: string;
    let promptSource: string;
    let config: OpenRouterConfig = {};

    if (this.langfuse?.isEnabled()) {
      const langfuseResult = await this.langfuse.getPromptWithConfig('release-extraction');
      if (!langfuseResult) {
        throw new Error(
          'Langfuse is enabled but prompt "release-extraction" was not found. ' +
          'Please create the prompt in Langfuse or disable Langfuse in your configuration.'
        );
      }

      prompt = langfuseResult.prompt;
      promptSource = 'Langfuse';
      
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

      if (this.verbose) {
        console.error(`[DEBUG] Using prompt from Langfuse (length: ${prompt.length} chars)`);
        if (Object.keys(config).length > 0) {
          console.error(`[DEBUG] Using config from Langfuse:`, config);
        }
      }
    } else {
      throw new Error(
        'Langfuse is required for release extraction. ' +
        'Please configure Langfuse in your settings or enable it in your configuration.'
      );
    }

    const formattedMessages = messages
      .map((m) => {
        const date = new Date(parseFloat(m.timestamp) * 1000).toISOString().split('T')[0];
        let messageText = `[${m.id}] [${date}] ${m.text}`;
        
        // Add thread replies if present
        if (m.threadReplies && m.threadReplies.length > 0) {
          const threadText = m.threadReplies
            .map((reply) => {
              const replyDate = new Date(parseFloat(reply.timestamp) * 1000).toISOString().split('T')[0];
              const replyAuthor = reply.username || `user-${reply.userId.substring(0, 8)}`;
              return `  └─ [${reply.id}] [${replyDate}] @${replyAuthor}: ${reply.text}`;
            })
            .join('\n');
          messageText += `\n  [Thread replies (${m.threadReplies.length}):]\n${threadText}`;
        }
        
        return messageText;
      })
      .join('\n\n');

    const userContent = `${prompt}\n\nMessages to analyze:\n\n${formattedMessages}`;

    // Use config values or defaults (needed for trace)
    const model = config.model || this.defaultModel;
    const maxTokens = config.max_tokens || this.defaultMaxTokens;

    // Create Langfuse trace if enabled
    const trace = this.langfuse?.isEnabled()
      ? this.langfuse.trace('release-extraction', {
          messageCount: messages.length,
          model,
        })
      : null;

    const generation = trace
      ? trace.generation({
          name: 'extract-releases',
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
      if (this.verbose) {
        console.error(`[DEBUG] No content in LLM response`);
      }
      if (generation) {
        generation.end({
          level: 'WARNING',
          statusMessage: 'No content in response',
        });
      }
      return [];
    }

    if (this.verbose) {
      console.error(`[DEBUG] LLM response (first 500 chars): ${textContent.substring(0, 500)}`);
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

    // Try to extract JSON from markdown code blocks if present
    let jsonText = textContent.trim();
    
    // Remove markdown code block markers (```json or ```)
    if (jsonText.startsWith('```')) {
      const lines = jsonText.split('\n');
      // Remove first line (```json or ```)
      lines.shift();
      // Remove last line if it's just ```
      if (lines.length > 0 && lines[lines.length - 1].trim() === '```') {
        lines.pop();
      }
      jsonText = lines.join('\n').trim();
    }

    try {
      const releases = JSON.parse(jsonText) as Release[];
      const result = Array.isArray(releases) ? releases : [];
      
      if (this.verbose) {
        console.error(`[DEBUG] Parsed ${result.length} releases from JSON response`);
        if (result.length === 0 && jsonText !== '[]') {
          console.error(`[DEBUG] WARNING: Response was not empty array but parsed to 0 releases. Full response: ${textContent.substring(0, 200)}...`);
        }
      }
      
      // Update trace with result metadata
      if (trace) {
        trace.update({
          metadata: {
            releaseCount: result.length,
            promptSource,
            model,
            maxTokens,
          },
        });
      }

      return result;
    } catch (parseError) {
      if (this.verbose) {
        console.error(`[DEBUG] Failed to parse JSON response:`, parseError);
        console.error(`[DEBUG] Response text (first 500 chars): ${textContent.substring(0, 500)}`);
        console.error(`[DEBUG] Attempted to parse (after code block removal): ${jsonText.substring(0, 200)}`);
      }
      
      // Check if response looks like markdown instead of JSON
      const isMarkdown = textContent.trim().startsWith('#') || 
                         textContent.trim().startsWith('```') || 
                         textContent.includes('###') ||
                         textContent.includes('##');
      
      if (isMarkdown) {
        const errorMessage = `Langfuse prompt "release-extraction" returned markdown instead of JSON.\n` +
          `The prompt must instruct the LLM to return ONLY a JSON array with no markdown formatting.\n` +
          `Expected format: [{"date":"2024-01-15","title":"v2.1.0 Release","description":"...","sourceMessageId":"..."}]\n` +
          `Please update your Langfuse prompt to explicitly request JSON output only.\n` +
          `See release-extraction-prompt.md for the correct prompt format.`;
        
        console.error(`\n[ERROR] ${errorMessage}`);
        
        if (generation) {
          generation.end({
            level: 'ERROR',
            statusMessage: `Response is markdown, not JSON. Prompt needs to be updated.`,
          });
        }
        
        throw new Error(errorMessage);
      }
      
      if (generation) {
        generation.end({
          level: 'ERROR',
          statusMessage: `Failed to parse JSON response: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
        });
      }
      
      throw new Error(
        `Failed to parse JSON response from LLM: ${parseError instanceof Error ? parseError.message : String(parseError)}`
      );
    }
  }
}
