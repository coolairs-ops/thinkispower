import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type LlmProfile = 'text-primary' | 'text-validator' | 'vision';

export type LlmContent =
  | string
  | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: LlmContent;
}

export interface LlmCallOptions {
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

interface ProfileConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
}

/** 域内端点判定：localhost / 回环 / 私有网段(192.168/10/172.16-31) / .local / .internal */
export function isLocalEndpoint(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return (
      h === 'localhost' ||
      h === '127.0.0.1' ||
      h === '::1' ||
      h.startsWith('192.168.') ||
      h.startsWith('10.') ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
      h.endsWith('.local') ||
      h.endsWith('.internal')
    );
  } catch {
    return false;
  }
}

/**
 * 统一 LLM 网关（P0-7）—— 所有 AI 调用的唯一出口。
 *
 * - 三个 profile：text-primary(主文本) / text-validator(交叉验证) / vision(多模态看图)。
 * - AI_MODE=local：私有化模式，强制所有调用走域内端点，硬阻断任何外呼第三方 LLM（数据不出域）。
 * - profile 默认回落到现有 DEEPSEEK_ 与 QWEN_ 环境变量，平滑过渡；后续收口现有 deepseek/qwen 调用。
 */
@Injectable()
export class LlmGatewayService {
  private readonly logger = new Logger(LlmGatewayService.name);
  private readonly mode: 'local' | 'cloud';
  private readonly profiles: Record<LlmProfile, ProfileConfig>;

  constructor(private config: ConfigService) {
    this.mode = config.get('AI_MODE', 'cloud') === 'local' ? 'local' : 'cloud';
    const g = (k: string, d: string) => this.config.get<string>(k, d);
    this.profiles = {
      'text-primary': {
        baseUrl: g('LLM_TEXT_BASE_URL', g('DEEPSEEK_BASE_URL', 'https://api.deepseek.com/v1')),
        model: g('LLM_TEXT_MODEL', g('DEEPSEEK_MODEL', 'deepseek-chat')),
        apiKey: g('LLM_TEXT_API_KEY', g('DEEPSEEK_API_KEY', '')),
      },
      'text-validator': {
        baseUrl: g('LLM_VALIDATOR_BASE_URL', g('QWEN_BASE_URL', 'https://dashscope.aliyuncs.com/compatible-mode/v1')),
        model: g('LLM_VALIDATOR_MODEL', g('QWEN_MODEL', 'qwen-plus')),
        apiKey: g('LLM_VALIDATOR_API_KEY', g('QWEN_API_KEY', '')),
      },
      vision: {
        baseUrl: g('LLM_VISION_BASE_URL', g('QWEN_BASE_URL', 'https://dashscope.aliyuncs.com/compatible-mode/v1')),
        model: g('LLM_VISION_MODEL', 'qwen-vl-plus'),
        apiKey: g('LLM_VISION_API_KEY', g('QWEN_API_KEY', '')),
      },
    };
    if (this.mode === 'local') {
      for (const [name, p] of Object.entries(this.profiles)) {
        if (!isLocalEndpoint(p.baseUrl)) {
          this.logger.error(`AI_MODE=local 但 profile "${name}" 的 baseUrl 非域内: ${p.baseUrl}（应指向域内模型端点）`);
        }
      }
    }
  }

  /** 统一文本/多模态调用入口（OpenAI 兼容 chat/completions） */
  async complete(profile: LlmProfile, messages: LlmMessage[], opts: LlmCallOptions = {}): Promise<string> {
    const p = this.profiles[profile];
    this.guardOutbound(profile, p.baseUrl);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 120_000);
    try {
      const res = await fetch(`${p.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.apiKey}` },
        body: JSON.stringify({
          model: p.model,
          messages,
          temperature: opts.temperature ?? 0.3,
          max_tokens: opts.maxTokens ?? 4096,
        }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`LLM ${profile} HTTP ${res.status}`);
      const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      return data?.choices?.[0]?.message?.content ?? '';
    } finally {
      clearTimeout(timer);
    }
  }

  /** 文本对话语义包装 */
  chat(profile: 'text-primary' | 'text-validator', text: { system?: string; user: string }, opts?: LlmCallOptions): Promise<string> {
    const messages: LlmMessage[] = [];
    if (text.system) messages.push({ role: 'system', content: text.system });
    messages.push({ role: 'user', content: text.user });
    return this.complete(profile, messages, opts);
  }

  /** 多模态(看图)语义包装：文本 prompt + 一组图片(url 或 data:base64) */
  vision(prompt: string, images: string[], opts?: LlmCallOptions): Promise<string> {
    const content: LlmContent = [
      { type: 'text', text: prompt },
      ...images.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
    ];
    return this.complete('vision', [{ role: 'user', content }], opts);
  }

  /** AI_MODE=local 下硬阻断外呼第三方 LLM —— 立身之本①数据不出域的技术兜底 */
  private guardOutbound(profile: LlmProfile, baseUrl: string): void {
    if (this.mode === 'local' && !isLocalEndpoint(baseUrl)) {
      throw new Error(
        `AI_MODE=local 禁止外呼第三方 LLM（profile=${profile}, url=${baseUrl}）。请将 LLM_*_BASE_URL 指向域内模型端点。`,
      );
    }
  }

  get aiMode(): 'local' | 'cloud' {
    return this.mode;
  }

  /** 数据流向审计(§1.1)：列出三个 LLM profile 的出口端点与域内判定 */
  auditEndpoints(): Array<{ profile: LlmProfile; baseUrl: string; model: string; domainResident: boolean }> {
    return (Object.keys(this.profiles) as LlmProfile[]).map((profile) => {
      const p = this.profiles[profile];
      return { profile, baseUrl: p.baseUrl, model: p.model, domainResident: isLocalEndpoint(p.baseUrl) };
    });
  }
}
