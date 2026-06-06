import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { MinioService } from '../../integrations/minio/minio.service';
import { LlmGatewayService } from '../../integrations/llm/llm-gateway.service';

/** 逐份理解笔记的半结构化结构（汇总到 RequirementUnderstanding 前的单份维度） */
export interface ParseSummary {
  status: 'parsed' | 'skipped' | 'error';
  /** 处理方式：text 直读（图片/二进制走 skipped） */
  mode?: 'text';
  summary?: string;
  features?: string[];
  pages?: string[];
  roles?: string[];
  entities?: string[];
  notes?: string;
  /** skipped/error 时的原因 */
  reason?: string;
  /** LLM 未返回合法 JSON 时的原始文本兜底 */
  raw?: string;
}

const TEXT_MIME_PREFIX = 'text/';
const TEXT_EXTS = new Set(['txt', 'md', 'markdown', 'csv', 'json', 'log', 'yaml', 'yml']);
const MAX_TEXT_CHARS = 12_000;

const UNDERSTAND_SYSTEM =
  '你是产品资料理解助手。阅读用户提供的一份专业资料，提取与产品相关的信息。' +
  '只输出一个 JSON 对象，不要任何解释或 markdown 代码块，字段：' +
  '{"summary":"一句话概述","features":["功能名"],"pages":["页面/界面名"],' +
  '"roles":["用户角色"],"entities":["数据实体"],"notes":"补充要点"}。' +
  '无法判断的字段给空数组或空字符串。';

/**
 * 逐份理解（P15-2 第 3 步）：对单个 AssetFile 用 LLM 网关产出半结构化理解笔记。
 *
 * - 文本类直读字节 → text-primary。
 * - 图片类标记 skipped（交由独立视觉模型处理）；pdf/docx/zip/.rp 等二进制标记 skipped（待专用解析器），不引入解析库。
 * - 结果写 AssetFile.parseSummary + parsedAt，供后续汇总成 RequirementUnderstanding。
 * - 走 LlmGateway 统一出口：AI_MODE=local 时自动域内、外呼被阻断（§1.1 数据不出域）。
 */
@Injectable()
export class ImportParseService {
  private readonly logger = new Logger(ImportParseService.name);

  constructor(
    private prisma: PrismaService,
    private minio: MinioService,
    private llm: LlmGatewayService,
  ) {}

  /** 理解单份资料，落 parseSummary + parsedAt */
  async parseAsset(assetId: string): Promise<ParseSummary> {
    const asset = await this.prisma.assetFile.findUnique({ where: { id: assetId } });
    if (!asset) throw new NotFoundException('资产文件不存在');

    let summary: ParseSummary;
    try {
      summary = await this.understand(asset);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      this.logger.error(`逐份理解失败 asset=${assetId}: ${reason}`);
      summary = { status: 'error', reason };
    }

    await this.prisma.assetFile.update({
      where: { id: assetId },
      data: { parseSummary: summary as never, parsedAt: new Date() },
    });
    return summary;
  }

  private async understand(asset: {
    storageKey: string;
    mimeType: string | null;
    fileName: string;
  }): Promise<ParseSummary> {
    const kind = this.classify(asset.mimeType, asset.fileName);

    if (kind === 'image') {
      return {
        status: 'skipped',
        reason: `图片资料（${asset.fileName}）交由独立视觉模型处理`,
      };
    }
    if (kind === 'skip') {
      return {
        status: 'skipped',
        reason: `二进制格式（${asset.mimeType ?? asset.fileName}）暂未支持，待专用解析器`,
      };
    }

    const buffer = await this.minio.downloadFile(asset.storageKey);
    const text = buffer.toString('utf8').slice(0, MAX_TEXT_CHARS);
    const raw = await this.llm.chat(
      'text-primary',
      { system: UNDERSTAND_SYSTEM, user: `资料文件名：${asset.fileName}\n内容：\n${text}` },
      { temperature: 0.2 },
    );

    return this.toSummary(raw);
  }

  /** 解析 LLM 返回的 JSON；非法则原文兜底 */
  private toSummary(raw: string): ParseSummary {
    const json = this.extractJson(raw);
    if (!json) return { status: 'parsed', mode: 'text', raw: raw.slice(0, 2000) };
    return {
      status: 'parsed',
      mode: 'text',
      summary: typeof json.summary === 'string' ? json.summary : undefined,
      features: this.strArray(json.features),
      pages: this.strArray(json.pages),
      roles: this.strArray(json.roles),
      entities: this.strArray(json.entities),
      notes: typeof json.notes === 'string' ? json.notes : undefined,
    };
  }

  private classify(mime: string | null, fileName: string): 'text' | 'image' | 'skip' {
    const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
    if ((mime && mime.startsWith('image/')) || ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) {
      return 'image';
    }
    if ((mime && mime.startsWith(TEXT_MIME_PREFIX)) || TEXT_EXTS.has(ext)) {
      return 'text';
    }
    return 'skip';
  }

  private extractJson(raw: string): Record<string, unknown> | null {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private strArray(v: unknown): string[] | undefined {
    if (!Array.isArray(v)) return undefined;
    const arr = v.filter((x): x is string => typeof x === 'string');
    return arr.length ? arr : undefined;
  }
}
