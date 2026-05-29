import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { generateFallbackPrd, getFallbackQuestion } from '../common/utils/prd-fallback';

export interface DeepseekMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface DeepseekOptions {
  temperature?: number;
  maxTokens?: number;
  model?: string;
}

@Injectable()
export class DeepseekService {
  private readonly logger = new Logger(DeepseekService.name);
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor(private config: ConfigService) {
    this.apiKey = this.config.get('DEEPSEEK_API_KEY', '');
    this.baseUrl = this.config.get('DEEPSEEK_BASE_URL', 'https://api.deepseek.com/v1');
    this.model = this.config.get('DEEPSEEK_MODEL', 'deepseek-chat');
  }

  async chat(messages: DeepseekMessage[], options?: DeepseekOptions): Promise<string> {
    if (!this.apiKey) {
      this.logger.warn('DEEPSEEK_API_KEY not configured, using fallback response');
      return this.getFallbackResponse(messages);
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 120_000);

      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: options?.model || this.model,
          messages,
          temperature: options?.temperature ?? 0.7,
          max_tokens: options?.maxTokens ?? 2048,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`DeepSeek API error: ${response.status} ${errorText}`);
        return this.getFallbackResponse(messages);
      }

      const data = await response.json();
      return data.choices?.[0]?.message?.content || '';
    } catch (error) {
      this.logger.error('DeepSeek API call failed', error);
      return this.getFallbackResponse(messages);
    }
  }

  /**
   * Fallback when API key is missing or API call fails.
   * Returns format compatible with ProductDiscoveryService.processMessages():
   *   { needMoreInfo, question, summary, prd }
   * (not the old format with `questions` array and `structuredRequirement`)
   */
  private getFallbackResponse(messages: DeepseekMessage[]): string {
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    if (!lastUserMsg) return '请描述你想要的软件功能。';

    const content = lastUserMsg.content.toLowerCase();
    const userCount = messages.filter(m => m.role === 'user').length;

    // Need at least 3 user messages before generating PRD
    if (userCount < 3) {
      const question = getFallbackQuestion(userCount) || '可以再多跟我说说你的想法吗？';
      return JSON.stringify({
        needMoreInfo: true,
        question,
        summary: userCount === 1 ? '开始了解你的需求' : '对你的需求更清晰了',
        prd: null,
      });
    }

    // Generate PRD from keywords
    const prd = generateFallbackPrd(content);

    return JSON.stringify({
      needMoreInfo: false,
      question: null,
      summary: prd.summary,
      prd,
    });
  }
}
