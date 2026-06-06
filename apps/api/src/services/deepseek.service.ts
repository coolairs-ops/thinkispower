import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as http from 'node:http';
import * as https from 'node:https';
import { generateFallbackPrd, getFallbackQuestion } from '../common/utils/prd-fallback';

export interface DeepseekMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface DeepseekOptions {
  temperature?: number;
  maxTokens?: number;
  model?: string;
  jsonOnly?: boolean;
}

@Injectable()
export class DeepseekService {
  private readonly logger = new Logger(DeepseekService.name);
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private httpAgent: https.Agent;

  constructor(private config: ConfigService) {
    this.apiKey = this.config.get('DEEPSEEK_API_KEY', '');
    this.baseUrl = this.config.get('DEEPSEEK_BASE_URL', 'https://api.deepseek.com/v1');
    this.model = this.config.get('DEEPSEEK_MODEL', 'deepseek-chat');
    // keepAlive: false — DeepSeek CDN idle timeout (~30s) 比自迭代轮间间隔短，
    // keepAlive 池子里过期连接被复用会导致 ECONNRESET/socket hang up。
    // 每次新建连接虽然多一次 TLS 握手，但可靠性远高于复用死连接。
    this.httpAgent = new https.Agent({ keepAlive: false });
  }

  async chat(messages: DeepseekMessage[], options?: DeepseekOptions & { timeoutMs?: number }): Promise<string> {
    if (!this.apiKey) {
      this.logger.warn('DEEPSEEK_API_KEY not configured, using fallback response');
      return this.getFallbackResponse(messages);
    }

    const timeoutMs = options?.timeoutMs ?? 60_000;

    try {
      const result = await this.httpPost(
        `${this.baseUrl}/chat/completions`,
        {
          model: options?.model || this.model,
          messages,
          temperature: options?.temperature ?? 0.7,
          max_tokens: options?.maxTokens ?? 2048,
          ...(options?.jsonOnly ? { response_format: { type: 'json_object' } } : {}),
        },
        timeoutMs,
      );
      return result.choices?.[0]?.message?.content || '';
    } catch (error) {
      this.logger.error('DeepSeek API call failed', error as any);
      return this.getFallbackResponse(messages);
    }
  }

  /**
   * 带自愈重试的 chat 调用。
   * 第1次失败 → 原Prompt重试(temperature+0.1)
   * 第2次失败 → 强化Prompt(加失败原因)
   * 第3次失败 → 返回 null (调用方降级)
   */
  async chatWithRetry(
    messages: DeepseekMessage[],
    options?: DeepseekOptions & { timeoutMs?: number; expectHtml?: boolean },
  ): Promise<string | null> {
    const expectHtml = options?.expectHtml ?? false;
    let lastResponse = '';
    let lastError = '';

    for (let attempt = 1; attempt <= 3; attempt++) {
      const temp = (options?.temperature ?? 0.3) + (attempt - 1) * 0.1;
      let msgs = messages;

      // 第2次: 强化Prompt
      if (attempt === 2 && lastError) {
        msgs = [...messages, {
          role: 'user' as const,
          content: `上次生成失败: ${lastError}。请重新生成，确保输出完整正确。`,
        }];
      }

      try {
        const response = await this.chat(msgs, { ...options, temperature: temp });
        lastResponse = response;

        // 闸门1: 结构完整性 (仅 HTML 类型调用)
        if (expectHtml) {
          const structCheck = this.validateStructure(response);
          if (!structCheck.valid) {
            lastError = structCheck.reason || '结构不完整';
            this.logger.warn(`闸门1 未通过 (attempt ${attempt}/3): ${lastError}`);
            continue;
          }
        }

        // 闸门2: 内容有效性
        const contentCheck = this.validateContent(response);
        if (!contentCheck.valid) {
          lastError = contentCheck.reason || '内容无效';
          this.logger.warn(`闸门2 未通过 (attempt ${attempt}/3): ${lastError}`);
          continue;
        }

        // 通过所有闸门
        if (attempt > 1) {
          this.logger.log(`自愈成功: 第 ${attempt} 次重试通过`);
        }
        return response;
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        this.logger.warn(`DeepSeek 调用失败 (attempt ${attempt}/3): ${lastError}`);
      }
    }

    this.logger.error(`自愈重试 3 次全部失败: ${lastError}`);
    return null;
  }

  /** 闸门1: 验证 HTML 结构完整性 */
  validateStructure(html: string): { valid: boolean; reason?: string } {
    // LLM 生成 HTML 通常带 ```html 围栏，属正常输出；先剥围栏再校验结构。
    // 否则带围栏的「完整」HTML 会被误判为不合格，导致 HTML 生成永远过不了此闸门（死锁）。
    const stripped = (html || '')
      .replace(/^\s*```[a-z]*\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim();
    if (stripped.length < 200) return { valid: false, reason: `响应过短 (${stripped.length} 字节)` };
    if (stripped.length < 500) return { valid: false, reason: `响应不完整 (${stripped.length} < 500 字节)` };
    // 是 HTML 时才检查标签（在剥围栏后的内容上判断完整性）
    if (/<html/i.test(stripped) || /<body/i.test(stripped) || /<div/i.test(stripped)) {
      if (!/<!DOCTYPE\s+html/i.test(stripped)) return { valid: false, reason: '缺少 DOCTYPE' };
      if (!/<\/html>\s*$/i.test(stripped)) return { valid: false, reason: 'HTML 不完整(未以 </html> 结束)' };
    }
    return { valid: true };
  }

  /** 闸门2: 验证内容有效性(错误文本检测) */
  validateContent(text: string): { valid: boolean; reason?: string } {
    const errorPatterns = [
      { pattern: /抱歉.{0,20}(无法|不能|出错)/i, label: 'AI 错误提示: 抱歉无法完成' },
      { pattern: /I (cannot|can't|am unable)/i, label: 'AI 错误提示: I cannot' },
      // 仅匹配真正的「超时错误消息」短语；不要用裸词 timeout —
      // 合法 SPA HTML 几乎必然含 setTimeout/clearTimeout，会被误判为错误文本而反复重试。
      { pattern: /(请求超时|Request\s*timeout|响应超时|连接超时)/i, label: '超时错误文本' },
      { pattern: /(遇到错误|发生错误|Error occurred)/i, label: '错误描述文本' },
    ];
    for (const { pattern, label } of errorPatterns) {
      if (pattern.test(text)) {
        return { valid: false, reason: label };
      }
    }
    return { valid: true };
  }

  /**
   * Use node:http instead of fetch() to avoid AbortController hanging issues.
   */
  private httpPost(url: string, body: unknown, timeoutMs: number): Promise<any> {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url);
      const mod = urlObj.protocol === 'https:' ? https : http;
      const data = JSON.stringify(body);

      const options: http.RequestOptions = {
        hostname: urlObj.hostname,
        port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Length': Buffer.byteLength(data),
          'Connection': 'close',
        },
        timeout: timeoutMs,
        agent: this.httpAgent,
      };

      const req = mod.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString();
          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            this.logger.error(`DeepSeek API error: ${res.statusCode} ${raw.slice(0, 200)}`);
            reject(new Error(`HTTP ${res.statusCode}`));
            return;
          }
          try {
            resolve(JSON.parse(raw));
          } catch {
            reject(new Error('Invalid JSON response'));
          }
        });
      });

      req.on('error', (err) => reject(err));
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });

      req.write(data);
      req.end();
    });
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
