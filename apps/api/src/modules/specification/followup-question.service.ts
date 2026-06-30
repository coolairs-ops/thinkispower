import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { RequirementCompletionService } from './requirement-completion.service';
import { RelationCompletionService } from './relation-completion.service';
import { BusinessRuleCompletionService } from './business-rule-completion.service';
import { SpecificationService } from './specification.service';

/**
 * 追加问答合批（relationship-completion-design.md §7 + 问答窗口时机建议）。
 *
 * 把「需求补全 D 的 ask 缺口」和「关系补全的 ask 候选」**合成一个问题列表**，
 * 前端在一个"追加问答"窗口里一次渲染、一次答完；提交时路由回各自的 apply。
 * 时机：A/D 补全 + 关系检测之后、规格冻结之前；只有存在 ask 项才有题（前端据此决定弹不弹）。
 * 本服务只读聚合 + 委托，不自己调模型。
 */
export interface FollowUpQuestion {
  id: string;
  group: 'requirement' | 'relation' | 'businessRule';
  kind: string; // gap kind / 'cardinality' | 'onDelete' / 'rule'
  title: string; // 上下文标签（问的是什么）
  question: string;
  options: { label: string; value: string }[];
  missing?: string; // requirement gap 的 missing（供前端组 acceptGaps）
  relationKey?: string; // 关系的 `parent->child`（供前端组 relations 答案）
  ruleName?: string; // 业务规则名（供前端组 businessRules 答案）
}

/**
 * 澄清记录（ADR-0016 切片3）：把每次追加问答的"问/答"沉淀进 structuredRequirement.clarifications，
 * 让"这字段为什么这么定 = 你哪天选的哪个选项"可追溯。保留式 append，绝不整体替换 sr。
 */
export interface ClarificationRecord {
  slot: string; // 澄清的对象（关系名/缺口/规则名）
  kind: string; // cardinality | onDelete | required | requirement | rule
  question: string; // 问的什么（取自当时的问题，可能为空）
  answer: string; // 用户选了什么（优先选项标签，回落原值；缺口为"已采纳"）
  source: string; // 来源，固定 'followup'
  at: string; // ISO 时间戳
}

@Injectable()
export class FollowUpQuestionService {
  private readonly logger = new Logger(FollowUpQuestionService.name);

  constructor(
    private req: RequirementCompletionService,
    private rel: RelationCompletionService,
    private biz: BusinessRuleCompletionService,
    private spec: SpecificationService,
    private prisma: PrismaService,
  ) {}

  /** 合批取追加问答：D 的 ask 缺口 + 关系 ask + 业务规则 ask → 统一问题列表。无 ask 项 → 空（前端不弹窗）。 */
  async getQuestions(userId: string, orgId: string | null, projectId: string): Promise<{ questions: FollowUpQuestion[] }> {
    const [{ gaps }, { candidates }, { candidates: ruleCands }] = await Promise.all([
      this.req.get(userId, orgId, projectId),
      this.rel.get(userId, orgId, projectId),
      this.biz.get(userId, orgId, projectId),
    ]);
    const questions: FollowUpQuestion[] = [];

    for (const g of gaps) {
      if (g.disposition === 'ask' && g.question && (g.options?.length ?? 0) > 0) {
        questions.push({
          id: `gap:${g.missing}`,
          group: 'requirement',
          kind: g.kind,
          title: g.missing,
          question: g.question,
          options: (g.options ?? []).map((o) => ({ label: o, value: o })),
          missing: g.missing,
        });
      }
    }

    for (const c of candidates) {
      if (c.disposition === 'ask' && Array.isArray(c.questions)) {
        for (const q of c.questions) {
          questions.push({
            id: `rel:${c.parent}->${c.child}:${q.key}`,
            group: 'relation',
            kind: q.key,
            title: `${c.parent} 与 ${c.child}`,
            question: q.question,
            options: q.options ?? [],
            relationKey: `${c.parent}->${c.child}`,
          });
        }
      }
    }

    for (const c of ruleCands) {
      if (c.disposition === 'ask' && c.question && (c.options?.length ?? 0) > 0) {
        questions.push({
          id: `rule:${c.name}`,
          group: 'businessRule',
          kind: 'rule',
          title: c.name,
          question: c.question,
          options: c.options ?? [],
          ruleName: c.name,
        });
      }
    }

    return { questions };
  }

  /**
   * 提交答案，路由回各自 apply：
   *   relations 答案 → relation-completion.apply（键 `parent->child`）
   *   acceptGaps（用户肯定的 ask 缺口的 missing）→ requirement-completion.apply
   */
  async submit(
    userId: string,
    orgId: string | null,
    projectId: string,
    body: {
      relations?: Record<string, { cardinality?: string; onDelete?: string; required?: boolean }>;
      acceptGaps?: string[];
      businessRules?: Record<string, string>;
    },
  ): Promise<{ relations: unknown; requirement: unknown; businessRules: unknown; specRegenerated: boolean; specStale: boolean; clarificationsAdded: number }> {
    // 先抓当下问题（带题面/选项标签），apply 会消费候选→之后取不到；失败不阻断作答（题面留空）。
    let captured: FollowUpQuestion[];
    try {
      ({ questions: captured } = await this.getQuestions(userId, orgId, projectId));
    } catch {
      captured = [];
    }

    const rel = await this.rel.apply(userId, orgId, projectId, body.relations ?? {});
    const req = await this.req.apply(userId, orgId, projectId, body.acceptGaps ?? []);
    const biz = await this.biz.apply(userId, orgId, projectId, body.businessRules ?? {});

    // 澄清记录沉淀（切片3）：保留式 append 进 sr.clarifications，在 spec 随动前持久化。
    const clarificationsAdded = await this.recordClarifications(projectId, body, captured);

    // 回写后让正式规格随动：未冻结自动重生成（业务规则/关系/页面立刻反映）；
    // 已冻结(generateDraft 会抛)→ 不偷改已确认规格，回 specStale 信号让前端提示"解冻后重确认"。
    let specRegenerated = false;
    let specStale = false;
    try {
      await this.spec.generateDraft(userId, orgId, projectId);
      specRegenerated = true;
    } catch {
      specStale = true;
    }

    this.logger.log(
      `追加问答提交 ${projectId}: 关系 ${rel.relations.length} / 采纳缺口 ${(body.acceptGaps ?? []).length} / 业务规则 ${biz.rules.length} / 澄清记录 +${clarificationsAdded} / 规格${specRegenerated ? '已重生成' : specStale ? '待解冻重确认' : '未动'}`,
    );
    return { relations: rel.relations, requirement: req, businessRules: biz.rules, specRegenerated, specStale, clarificationsAdded };
  }

  /**
   * 把本次答案 + 当下题面 合成澄清记录，**保留式 append** 进 sr.clarifications（绝不整体替换 sr）。
   * 题面/选项标签取自 apply 前抓的 captured；取不到则题面留空、答案回落原值。返回新增条数。
   */
  private async recordClarifications(
    projectId: string,
    body: { relations?: Record<string, { cardinality?: string; onDelete?: string; required?: boolean }>; acceptGaps?: string[]; businessRules?: Record<string, string> },
    captured: FollowUpQuestion[],
  ): Promise<number> {
    const qById = new Map(captured.map((q) => [q.id, q]));
    const at = new Date().toISOString();
    const label = (q: FollowUpQuestion | undefined, val: string) => q?.options?.find((o) => o.value === val)?.label ?? val;
    const records: ClarificationRecord[] = [];

    for (const [key, ans] of Object.entries(body.relations ?? {})) {
      for (const [kind, val] of Object.entries(ans)) {
        if (val === undefined || val === null || (val as unknown) === '') continue;
        const q = qById.get(`rel:${key}:${kind}`);
        records.push({ slot: q?.title ?? key, kind, question: q?.question ?? '', answer: label(q, String(val)), source: 'followup', at });
      }
    }
    for (const missing of body.acceptGaps ?? []) {
      const q = qById.get(`gap:${missing}`);
      records.push({ slot: missing, kind: q?.kind ?? 'requirement', question: q?.question ?? '', answer: '已采纳', source: 'followup', at });
    }
    for (const [name, val] of Object.entries(body.businessRules ?? {})) {
      if (!val) continue;
      const q = qById.get(`rule:${name}`);
      records.push({ slot: name, kind: 'rule', question: q?.question ?? '', answer: label(q, String(val)), source: 'followup', at });
    }

    if (records.length === 0) return 0;

    // 读最新 sr（在三条 apply 之后），仅追加 clarifications，写回——其余字段原样保留。
    const proj = await this.prisma.project.findUnique({ where: { id: projectId }, select: { structuredRequirement: true } });
    const sr = (proj?.structuredRequirement as Record<string, unknown>) || {};
    const existing = Array.isArray(sr.clarifications) ? (sr.clarifications as unknown[]) : [];
    sr.clarifications = [...existing, ...records];
    await this.prisma.project.update({ where: { id: projectId }, data: { structuredRequirement: sr as never } });
    return records.length;
  }
}
