import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as https from 'node:https';
import * as http from 'node:http';

export interface QwenMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface QwenOptions {
  temperature?: number;
  maxTokens?: number;
  model?: string;
}

/**
 * 通义千问（Qwen）API 客户端
 *
 * 用作国产交叉验证模型，独立于 DeepSeek 评估同一份输出。
 * API 兼容 OpenAI 格式，通过阿里云 DashScope 接入。
 *
 * 配置（.env）：
 *   QWEN_API_KEY=sk-xxxxxxxx         # DashScope API Key
 *   QWEN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
 *   QWEN_MODEL=qwen-max               # 或 qwen-plus / qwen-turbo
 */
@Injectable()
export class QwenClient {
  private readonly logger = new Logger(QwenClient.name);
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private httpAgent: https.Agent;

  constructor(private config: ConfigService) {
    this.apiKey = this.config.get('QWEN_API_KEY', '');
    this.baseUrl = this.config.get('QWEN_BASE_URL', 'https://dashscope.aliyuncs.com/compatible-mode/v1');
    this.model = this.config.get('QWEN_MODEL', 'qwen-plus');
    this.httpAgent = new https.Agent({ keepAlive: false });
  }

  get isConfigured(): boolean {
    return !!this.apiKey;
  }

  /** 是否已配置并且可用 */
  get available(): boolean {
    return !!this.apiKey;
  }

  async chat(messages: QwenMessage[], options?: QwenOptions): Promise<string> {
    if (!this.apiKey) {
      this.logger.warn('QWEN_API_KEY 未配置，返回空响应');
      return '';
    }

    try {
      const result = await this.httpPost(
        `${this.baseUrl}/chat/completions`,
        {
          model: options?.model || this.model,
          messages,
          temperature: options?.temperature ?? 0.3,
          max_tokens: options?.maxTokens ?? 4096,
        },
        60_000,
      );
      return result.choices?.[0]?.message?.content || '';
    } catch (error) {
      this.logger.error('Qwen API call failed', error as any);
      return '';
    }
  }

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
            reject(new Error(`HTTP ${res.statusCode}: ${raw.slice(0, 200)}`));
            return;
          }
          try { resolve(JSON.parse(raw)); } catch { reject(new Error('Invalid JSON response')); }
        });
      });

      req.on('error', (err) => reject(err));
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
      req.write(data);
      req.end();
    });
  }
}
