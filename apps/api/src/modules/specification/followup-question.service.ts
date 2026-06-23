import { Injectable, Logger } from '@nestjs/common';
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

@Injectable()
export class FollowUpQuestionService {
  private readonly logger = new Logger(FollowUpQuestionService.name);

  constructor(
    private req: RequirementCompletionService,
    private rel: RelationCompletionService,
    private biz: BusinessRuleCompletionService,
    private spec: SpecificationService,
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
  ): Promise<{ relations: unknown; requirement: unknown; businessRules: unknown; specRegenerated: boolean; specStale: boolean }> {
    const rel = await this.rel.apply(userId, orgId, projectId, body.relations ?? {});
    const req = await this.req.apply(userId, orgId, projectId, body.acceptGaps ?? []);
    const biz = await this.biz.apply(userId, orgId, projectId, body.businessRules ?? {});

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
      `追加问答提交 ${projectId}: 关系 ${rel.relations.length} / 采纳缺口 ${(body.acceptGaps ?? []).length} / 业务规则 ${biz.rules.length} / 规格${specRegenerated ? '已重生成' : specStale ? '待解冻重确认' : '未动'}`,
    );
    return { relations: rel.relations, requirement: req, businessRules: biz.rules, specRegenerated, specStale };
  }
}
