import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { DeepseekService } from '../../services/deepseek.service';

/**
 * 业务规则补全（A 抽取 + B 问答合一）。
 *
 * 业务规则散在功能/页面描述里（"调整需上报"=审批、"GSP合规"=校验…），规格的 businessRules 却常空
 * （普通访谈流程不抽）。本服务把"规则"接进 A/D/回写流水线：
 *   检测候选规则 → 处置(清楚写明的=autofill直接抽取[=A]；模糊业务决策的=ask出选择题[=B])
 *   → ask 题并进追加问答 → 回写 structuredRequirement.businessRules → 规格重生成即带上。
 * 级联删除类规则已由关系补全覆盖，这里找其他类：审批/上报、计算/精度、状态流转、校验/合规、配额/限制。
 * 复用 relation-completion 的成法。
 */

export interface BusinessRule {
  name: string;
  description?: string;
  trigger?: string; // 触发条件
  outcome?: string; // 结果
  source?: string; // feature | page | flow | llm
  confirmed?: boolean;
}

export interface BusinessRuleCandidate extends BusinessRule {
  evidence?: string;
  disposition: 'autofill' | 'ask';
  question?: string; // 仅 ask
  options?: { label: string; value: string }[]; // 仅 ask，value=选定后的 outcome 文案
}

@Injectable()
export class BusinessRuleCompletionService {
  private readonly logger = new Logger(BusinessRuleCompletionService.name);

  constructor(
    private prisma: PrismaService,
    private deepseek: DeepseekService,
  ) {}

  /** 检测候选业务规则（A 抽取 + B 问答合一调用）。存库 + 返回。 */
  async detect(userId: string, projectId: string): Promise<{ candidates: BusinessRuleCandidate[] }> {
    const project = await this.requireProject(userId, projectId);
    const sr = (project.structuredRequirement as Record<string, unknown>) || {};
    const ctx = this.gatherContext(project.planSummary);

    let candidates: BusinessRuleCandidate[] = [];
    try {
      const resp = await this.deepseek.chat([{ role: 'user', content: this.buildPrompt(ctx) }], {
        temperature: 0.3,
        maxTokens: 4096,
      });
      candidates = this.parse(resp);
    } catch (e) {
      this.logger.warn(`业务规则检测失败 ${projectId}: ${e instanceof Error ? e.message : e}`);
    }

    sr.businessRuleCandidates = candidates as unknown;
    await this.prisma.project.update({ where: { id: projectId }, data: { structuredRequirement: sr as never } });
    const counts = candidates.reduce<Record<string, number>>((a, c) => ((a[c.disposition] = (a[c.disposition] || 0) + 1), a), {});
    this.logger.log(`业务规则检测 ${projectId}: ${candidates.length} 候选 ${JSON.stringify(counts)}`);
    return { candidates };
  }

  /** 取已存候选 + 已确定规则。 */
  async get(userId: string, projectId: string): Promise<{ candidates: BusinessRuleCandidate[]; rules: BusinessRule[] }> {
    const project = await this.requireProject(userId, projectId);
    const sr = (project.structuredRequirement as Record<string, unknown>) || {};
    return {
      candidates: (sr.businessRuleCandidates as BusinessRuleCandidate[]) ?? [],
      rules: (sr.businessRules as BusinessRule[]) ?? [],
    };
  }

  /**
   * 回写：autofill 规则直接定案；ask 规则按 answers（键=规则名，值=选定 outcome）定案。
   * 答案为 '__skip__' 的丢弃。结果写 structuredRequirement.businessRules（规格 generateDraft 会读）。
   */
  async apply(userId: string, projectId: string, answers: Record<string, string> = {}): Promise<{ rules: BusinessRule[] }> {
    const project = await this.requireProject(userId, projectId);
    const sr = (project.structuredRequirement as Record<string, unknown>) || {};
    const candidates = (sr.businessRuleCandidates as BusinessRuleCandidate[]) ?? [];

    const rules: BusinessRule[] = [];
    for (const c of candidates) {
      if (c.disposition === 'ask') {
        const ans = answers[c.name];
        if (ans === '__skip__') continue; // 客户选"不需要此规则"
        rules.push({ name: c.name, description: c.description, trigger: c.trigger, outcome: ans || c.outcome, source: c.source, confirmed: true });
      } else {
        rules.push({ name: c.name, description: c.description, trigger: c.trigger, outcome: c.outcome, source: c.source, confirmed: true });
      }
    }

    sr.businessRules = rules as unknown;
    await this.prisma.project.update({ where: { id: projectId }, data: { structuredRequirement: sr as never } });
    this.logger.log(`业务规则回写 ${projectId}: ${rules.length} 条确定规则`);
    return { rules };
  }

  // ─── 内部 ───

  private gatherContext(planSummary: unknown): { features: string[]; pages: string[]; roles: string[] } {
    const plan = (planSummary as Record<string, unknown>) || {};
    const names = (raw: unknown): string[] =>
      Array.isArray(raw) ? raw.map((x) => (typeof x === 'string' ? x : (x as { name?: string } | null)?.name || '')).filter(Boolean) : [];
    return { features: names(plan.features), pages: names(plan.pages), roles: names(plan.roles) };
  }

  private buildPrompt(ctx: { features: string[]; pages: string[]; roles: string[] }): string {
    return `# 角色
你是资深B端需求分析师。从下面客户已填的功能/页面/角色描述里，**找出业务规则**——那些"什么情况下、要发生什么"
的约束（审批/上报、计算/精度、状态流转、校验/合规、配额/限制等）。规则常**藏在功能描述里**（如"调整需上报"=审批规则）。

# 输入
- 功能：${ctx.features.join('；') || '（无）'}
- 页面：${ctx.pages.join('、') || '（无）'}
- 角色：${ctx.roles.join('、') || '（无）'}

# 任务（每条规则）
1. 给 name(规则名)、trigger(触发条件)、outcome(结果)、evidence(来自哪句)、source(feature|page|flow|llm)。
2. 判 disposition：
   - "autofill"：描述里**已清楚写明**的规则（如"路径调整需上报"）→ 直接结构化抽取，无需问。
   - "ask"：**业务决策、答错代价高、没通用默认**（如金额精度/状态机谁可改/是否需二次确认/配额上限）→ 出给非技术用户的选择题。
3. ask 时给 question + options（每个 option 的 value 写成"选定后的 outcome 文案"）。

# 约束
- 宁少而准。**级联删除类不在本轮**（已由关系补全覆盖）。问题用非技术、口语化的话。

# 输出（严格JSON数组，无任何额外文字/markdown围栏）
[{"name":"路径调整审批","trigger":"销售调整巡检路径时","outcome":"需上报管理员审批后生效","evidence":"智能路径规划…调整需上报","source":"feature","disposition":"autofill"},
{"name":"金额精度","trigger":"记录/展示金额时","outcome":"","evidence":"涉及项目金额","source":"feature","disposition":"ask","question":"金额按几位小数记录？","options":[{"label":"2位(精确到分)","value":"金额保留2位小数"},{"label":"0位(精确到元)","value":"金额取整到元"}]}]`;
  }

  /** 健壮解析：去围栏→抽数组→过滤合法项。 */
  private parse(resp: string): BusinessRuleCandidate[] {
    if (!resp) return [];
    const m = resp.match(/\[[\s\S]*\]/);
    if (!m) return [];
    try {
      const arr = JSON.parse(m[0]) as unknown[];
      return arr
        .filter((c): c is BusinessRuleCandidate => !!c && typeof (c as BusinessRuleCandidate).name === 'string')
        .slice(0, 20)
        .map((c) => ({
          name: c.name,
          description: c.description,
          trigger: c.trigger,
          outcome: c.outcome,
          evidence: c.evidence,
          source: c.source,
          disposition: c.disposition === 'ask' ? 'ask' : 'autofill',
          question: c.disposition === 'ask' ? c.question : undefined,
          options: c.disposition === 'ask' && Array.isArray(c.options) ? c.options : undefined,
        }));
    } catch {
      return [];
    }
  }

  private async requireProject(userId: string, projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { userId: true, name: true, structuredRequirement: true, planSummary: true },
    });
    if (!project) throw new NotFoundException('项目不存在');
    if (project.userId !== userId) throw new ForbiddenException('无权访问');
    return project;
  }
}
