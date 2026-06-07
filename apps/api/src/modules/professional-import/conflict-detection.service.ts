import { Injectable, Logger } from '@nestjs/common';
import { LlmGatewayService } from '../../integrations/llm/llm-gateway.service';
import { ParseSummary } from './import-parse.service';

export type ConflictKind = 'contradiction' | 'inconsistency' | 'omission';
export type ConflictSeverity = 'high' | 'medium' | 'low';

/** 某份资料对该议题的具体说法 */
export interface ConflictStatement {
  source: string;
  claim: string;
}

/** 跨资料的一处冲突/不一致(P15-7) */
export interface RequirementConflict {
  topic: string;
  kind: ConflictKind;
  severity: ConflictSeverity;
  statements: ConflictStatement[];
  suggestion: string;
}

/** 冲突检测输入：单份资料的结构化理解 + 文件名 */
export interface ConflictDoc {
  fileName: string;
  summary?: string;
  features?: string[];
  pages?: string[];
  roles?: string[];
  entities?: string[];
  notes?: string;
}

const SYSTEM =
  '你是资深需求分析师。下面是同一产品的多份资料各自的结构化理解。请找出它们**之间**的冲突与不一致：\n' +
  '- contradiction：同一事项相互矛盾的说法（如角色权限、流程、取值直接冲突）。\n' +
  '- inconsistency：措辞/范围/粒度不一致，可能指同一事物但说法不齐。\n' +
  '- omission：某份资料明确包含、而其他份明显缺失的关键项。\n' +
  '只输出一个 JSON 对象，不要任何解释或 markdown：\n' +
  '{"conflicts":[{"topic":"议题","kind":"contradiction|inconsistency|omission","severity":"high|medium|low",' +
  '"statements":[{"source":"文件名","claim":"该资料的说法"}],"suggestion":"建议如何澄清"}]}\n' +
  'severity 判定：直接矛盾或影响核心功能/权限/数据 = high；措辞或次要范围不一致 = medium；可忽略 = low。\n' +
  'statements 的 source 必须用给定的文件名原文。确无冲突时 conflicts 为 []。';

/**
 * 冲突检测（P15-7）：对一个批次内多份资料的结构化理解做跨文档一致性分析。
 *
 * - 走 LlmGateway（text-validator），私有化下用域内模型。
 * - 单份资料或内容过少 → 无跨文档冲突，直接返回 []（不调 LLM，省成本）。
 * - LLM 不可用/返回非法 → 返回 []（不阻断需求理解，冲突视为"未发现"）。
 */
@Injectable()
export class ConflictDetectionService {
  private readonly logger = new Logger(ConflictDetectionService.name);

  constructor(private llm: LlmGatewayService) {}

  /** 把已解析的各份资料做跨文档一致性分析，返回冲突清单 */
  async detect(docs: ConflictDoc[]): Promise<RequirementConflict[]> {
    const usable = docs.filter((d) => this.hasContent(d));
    if (usable.length < 2) return []; // 不足两份有内容的资料 → 无从比对

    let raw: string;
    try {
      raw = await this.llm.chat(
        'text-validator',
        { system: SYSTEM, user: this.render(usable) },
        { temperature: 0.1, maxTokens: 3000 },
      );
    } catch (e) {
      this.logger.warn(`冲突检测 LLM 调用失败，视为未发现冲突: ${e}`);
      return [];
    }

    return this.parse(raw, new Set(usable.map((d) => d.fileName)));
  }

  /** 从一个批次的 (fileName, parseSummary) 列表构造检测输入 */
  static fromParsed(parsed: Array<{ fileName: string; s: ParseSummary }>): ConflictDoc[] {
    return parsed.map(({ fileName, s }) => ({
      fileName,
      summary: s.summary,
      features: s.features,
      pages: s.pages,
      roles: s.roles,
      entities: s.entities,
      notes: s.notes,
    }));
  }

  private hasContent(d: ConflictDoc): boolean {
    return !!(
      d.summary?.trim() ||
      (d.features?.length ?? 0) > 0 ||
      (d.roles?.length ?? 0) > 0 ||
      (d.pages?.length ?? 0) > 0
    );
  }

  private render(docs: ConflictDoc[]): string {
    const list = (v?: string[]) => (v && v.length ? v.join('、') : '（无）');
    return docs
      .map(
        (d) =>
          `【${d.fileName}】\n定位：${d.summary || '（无）'}\n功能：${list(d.features)}\n页面：${list(d.pages)}\n角色：${list(d.roles)}\n实体：${list(d.entities)}\n备注：${d.notes || '（无）'}`,
      )
      .join('\n\n');
  }

  private parse(raw: string, knownSources: Set<string>): RequirementConflict[] {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) return [];
    let obj: { conflicts?: unknown };
    try {
      obj = JSON.parse(raw.slice(start, end + 1));
    } catch {
      return [];
    }
    if (!Array.isArray(obj.conflicts)) return [];

    return obj.conflicts
      .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
      .map((c) => this.normalize(c, knownSources))
      .filter((c): c is RequirementConflict => c !== null);
  }

  private normalize(c: Record<string, unknown>, knownSources: Set<string>): RequirementConflict | null {
    const topic = typeof c.topic === 'string' ? c.topic.trim() : '';
    if (!topic) return null;

    const kind: ConflictKind =
      c.kind === 'contradiction' || c.kind === 'omission' ? c.kind : 'inconsistency';
    const severity: ConflictSeverity =
      c.severity === 'high' || c.severity === 'low' ? c.severity : 'medium';

    const statements: ConflictStatement[] = Array.isArray(c.statements)
      ? c.statements
          .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
          .map((s) => ({
            source: typeof s.source === 'string' ? s.source : '',
            claim: typeof s.claim === 'string' ? s.claim : '',
          }))
          .filter((s) => s.claim)
      : [];

    return {
      topic,
      kind,
      severity,
      statements,
      suggestion: typeof c.suggestion === 'string' ? c.suggestion : '',
    };
  }
}
