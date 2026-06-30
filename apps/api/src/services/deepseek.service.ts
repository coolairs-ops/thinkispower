import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as http from 'node:http';
import * as https from 'node:https';
import * as tls from 'node:tls';
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
  private proxyUrl: string;

  constructor(private config: ConfigService) {
    this.apiKey = this.config.get('DEEPSEEK_API_KEY', '');
    this.baseUrl = this.config.get('DEEPSEEK_BASE_URL', 'https://api.deepseek.com/v1');
    this.model = this.config.get('DEEPSEEK_MODEL', 'deepseek-chat');
    // keepAlive: false — DeepSeek CDN idle timeout (~30s) 比自迭代轮间间隔短，
    // keepAlive 池子里过期连接被复用会导致 ECONNRESET/socket hang up。
    // 每次新建连接虽然多一次 TLS 握手，但可靠性远高于复用死连接。
    this.httpAgent = new https.Agent({ keepAlive: false });
    this.proxyUrl = this.resolveProxyUrl();
    if (this.proxyUrl) {
      this.logger.log(`DeepSeek proxy enabled: ${sanitizeProxyUrl(this.proxyUrl)}`);
    }
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
    const urlObj = new URL(url);
    if (this.proxyUrl && urlObj.protocol === 'https:') {
      return this.httpPostViaProxy(urlObj, body, timeoutMs);
    }

    return new Promise((resolve, reject) => {
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
   * 通过 HTTP/HTTPS 代理访问 HTTPS API。
   * Node 的 http/https 不会自动读取系统代理；这里显式走 CONNECT 隧道，避免后端直连公网被 Windows/网络策略拦截。
   */
  private httpPostViaProxy(urlObj: URL, body: unknown, timeoutMs: number): Promise<any> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        reject(err);
      };
      const done = (value: any) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };

      let proxy: URL;
      try {
        proxy = new URL(this.proxyUrl);
      } catch {
        fail(new Error(`Invalid proxy URL: ${sanitizeProxyUrl(this.proxyUrl)}`));
        return;
      }

      if (!['http:', 'https:'].includes(proxy.protocol)) {
        fail(new Error(`Unsupported proxy protocol: ${proxy.protocol}. Use http:// or https://`));
        return;
      }

      const targetPort = Number(urlObj.port || 443);
      const proxyPort = Number(proxy.port || (proxy.protocol === 'https:' ? 443 : 80));
      const proxyAuth = proxy.username
        ? `Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString('base64')}`
        : undefined;
      const connectHeaders: Record<string, string> = {
        Host: `${urlObj.hostname}:${targetPort}`,
      };
      if (proxyAuth) connectHeaders['Proxy-Authorization'] = proxyAuth;

      const connectOptions: http.RequestOptions = {
        hostname: proxy.hostname,
        port: proxyPort,
        method: 'CONNECT',
        path: `${urlObj.hostname}:${targetPort}`,
        headers: connectHeaders,
        timeout: timeoutMs,
      };
      const proxyModule = proxy.protocol === 'https:' ? https : http;
      const connectReq = proxyModule.request(connectOptions);

      connectReq.on('connect', (res, socket, head) => {
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          socket.destroy();
          fail(new Error(`Proxy CONNECT failed: HTTP ${res.statusCode}`));
          return;
        }
        if (head?.length) socket.unshift(head);

        const tlsSocket = tls.connect({ socket, servername: urlObj.hostname });
        const chunks: Buffer[] = [];

        tlsSocket.setTimeout(timeoutMs, () => {
          tlsSocket.destroy();
          fail(new Error('Request timeout'));
        });
        tlsSocket.once('error', (err) => fail(err));
        tlsSocket.once('secureConnect', () => {
          const data = JSON.stringify(body);
          const path = `${urlObj.pathname}${urlObj.search}`;
          const requestText = [
            `POST ${path} HTTP/1.1`,
            `Host: ${urlObj.host}`,
            'Content-Type: application/json',
            `Authorization: Bearer ${this.apiKey}`,
            `Content-Length: ${Buffer.byteLength(data)}`,
            'Connection: close',
            '',
            data,
          ].join('\r\n');
          tlsSocket.write(requestText);
        });
        tlsSocket.on('data', (chunk: Buffer) => chunks.push(chunk));
        tlsSocket.on('end', () => {
          try {
            const parsed = parseHttpResponse(Buffer.concat(chunks));
            if (parsed.statusCode < 200 || parsed.statusCode >= 300) {
              this.logger.error(`DeepSeek API error: ${parsed.statusCode} ${parsed.body.slice(0, 200)}`);
              fail(new Error(`HTTP ${parsed.statusCode}`));
              return;
            }
            done(JSON.parse(parsed.body));
          } catch (e) {
            fail(e instanceof Error ? e : new Error(String(e)));
          }
        });
      });

      connectReq.on('timeout', () => {
        connectReq.destroy();
        fail(new Error('Proxy CONNECT timeout'));
      });
      connectReq.on('error', (err) => fail(err));
      connectReq.end();
    });
  }

  private resolveProxyUrl(): string {
    const base = this.baseUrl ? new URL(this.baseUrl) : null;
    const noProxy = this.firstConfig('NO_PROXY', 'no_proxy');
    if (base && shouldBypassProxy(base.hostname, noProxy)) return '';
    return this.firstConfig('LLM_PROXY_URL', 'HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy');
  }

  private firstConfig(...keys: string[]): string {
    for (const key of keys) {
      const value = this.config.get<string>(key) || process.env[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return '';
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

function sanitizeProxyUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.username || url.password) {
      url.username = '***';
      url.password = '***';
    }
    return url.toString();
  } catch {
    return value.replace(/\/\/([^:@/]+):([^@/]+)@/u, '//***:***@');
  }
}

function shouldBypassProxy(hostname: string, noProxy?: string): boolean {
  if (!noProxy?.trim()) return false;
  const host = hostname.toLowerCase();
  return noProxy
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .some((rule) => {
      if (rule === '*') return true;
      if (rule.startsWith('.')) return host.endsWith(rule);
      return host === rule || host.endsWith(`.${rule}`);
    });
}

function parseHttpResponse(buffer: Buffer): { statusCode: number; body: string } {
  const sep = buffer.indexOf('\r\n\r\n');
  if (sep < 0) throw new Error('Invalid HTTP response');
  const headerText = buffer.subarray(0, sep).toString('latin1');
  const [statusLine, ...headerLines] = headerText.split('\r\n');
  const statusCode = Number(statusLine.match(/^HTTP\/\d(?:\.\d)?\s+(\d{3})/)?.[1]);
  if (!Number.isFinite(statusCode)) throw new Error('Invalid HTTP status');

  const headers = new Map<string, string>();
  for (const line of headerLines) {
    const idx = line.indexOf(':');
    if (idx > 0) headers.set(line.slice(0, idx).trim().toLowerCase(), line.slice(idx + 1).trim().toLowerCase());
  }

  const bodyBuffer = buffer.subarray(sep + 4);
  const decoded = headers.get('transfer-encoding')?.includes('chunked') ? decodeChunkedBody(bodyBuffer) : bodyBuffer;
  return { statusCode, body: decoded.toString('utf8') };
}

function decodeChunkedBody(buffer: Buffer): Buffer {
  const chunks: Buffer[] = [];
  let offset = 0;
  while (offset < buffer.length) {
    const lineEnd = buffer.indexOf('\r\n', offset);
    if (lineEnd < 0) break;
    const sizeText = buffer.subarray(offset, lineEnd).toString('ascii').split(';', 1)[0].trim();
    const size = Number.parseInt(sizeText, 16);
    if (!Number.isFinite(size)) throw new Error('Invalid chunked response');
    offset = lineEnd + 2;
    if (size === 0) break;
    chunks.push(buffer.subarray(offset, offset + size));
    offset += size + 2;
  }
  return Buffer.concat(chunks);
}
