import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { DeepseekService } from '../../services/deepseek.service';

/** 需求补全工具包 v2 · 升级A：IR 完备性批判 + 30题补集（docs/requirement-completion-kit-v2.md §1） */

/** 30题采集已覆盖的维度（structuredRequirement 已捕获的面） */
const COVERED_DIMENSIONS = ['实体与字段', '核心页面', '主流程', '角色与可见范围', '产品定位'];

/** 这类企业内部应用常漏、但关键的维度（补集扫描的靶子） */
const COMMONLY_UNCOVERED_DIMENSIONS = [
  '对账/统计/报表', '操作审计与留痕', '通知/提醒/消息', '导入/导出/批量',
  '多端/响应式', '离线/弱网', '数据归档/清理/配额', '对外接口/集成',
  '并发/重复提交', '权限的数据维度(非菜单维度)', '首次使用/引导/空数据',
  '异常分支与回滚', '搜索/筛选/排序的组合',
];

export interface CompletenessGap {
  kind: string; // entity | screen | flow | role | dimension
  missing: string;
  why: string;
  ignorableIf?: string;
  source?: string; // archetype | uncovered-dimension
}

@Injectable()
export class RequirementCompletionService {
  private readonly logger = new Logger(RequirementCompletionService.name);

  constructor(
    private prisma: PrismaService,
    private deepseek: DeepseekService,
  ) {}

  /** 跑一次 IR 完备性批判：找"整块漏掉的实体/页面/流程/角色/维度"，存库 + 返回。 */
  async analyze(userId: string, projectId: string): Promise<{ gaps: CompletenessGap[] }> {
    const project = await this.requireProject(userId, projectId);
    const sr = (project.structuredRequirement as Record<string, unknown>) || {};
    const prd = (sr.prd as Record<string, unknown>) || sr;

    const reqJson = JSON.stringify(
      {
        name: project.name,
        summary: prd.summary,
        targetUsers: prd.targetUsers,
        pages: prd.pages,
        features: prd.features,
        roles: prd.roles,
        mvpScope: prd.mvpScope,
        dataObjects: prd.dataObjects,
      },
      null,
      2,
    );

    let gaps: CompletenessGap[] = [];
    try {
      const resp = await this.deepseek.chat([{ role: 'user', content: this.buildPrompt(reqJson) }], {
        temperature: 0.3,
        maxTokens: 4096,
      });
      gaps = this.parseGaps(resp);
    } catch (e) {
      this.logger.warn(`需求完备性批判失败 ${projectId}: ${e instanceof Error ? e.message : e}`);
    }

    sr.completenessGaps = gaps as unknown;
    await this.prisma.project.update({ where: { id: projectId }, data: { structuredRequirement: sr as never } });
    this.logger.log(`需求完备性批判 ${projectId}: 发现 ${gaps.length} 处整块缺口`);
    return { gaps };
  }

  /** 取已存的完备性缺口（不重新调模型）。 */
  async get(userId: string, projectId: string): Promise<{ gaps: CompletenessGap[] }> {
    const project = await this.requireProject(userId, projectId);
    const sr = (project.structuredRequirement as Record<string, unknown>) || {};
    return { gaps: (sr.completenessGaps as CompletenessGap[]) ?? [] };
  }

  /** v2 §1 提示词：只查"整块缺失"，不查字段级细节；对照典型构成 + 30题补集。 */
  private buildPrompt(reqJson: string): string {
    return `# 角色
你是资深B端解决方案架构师。你的任务**不是**检查需求内部的字段级缺口，而是判断
**这份需求本身是否漏掉了整类实体/页面/流程/角色/维度**——方案里压根没出现、但这类应用几乎一定需要的东西。

# 输入（从用户访谈得到的结构化需求）
${reqJson}

# 参照
- 30题已覆盖维度（不必再提）：${COVERED_DIMENSIONS.join('、')}
- 常被遗漏、但这类企业内部应用关键的维度（重点对照取补集）：${COMMONLY_UNCOVERED_DIMENSIONS.join('、')}

# 任务
1. 对照"这类应用通常有的实体/页面/流程/角色"，列出需求中缺失的**整块**项（非字段级）。
2. 在"常被遗漏维度"里取补集：列出本类应用关键、但需求与30题都没触及的维度。
3. 每条说明：缺什么 / 为什么这类应用通常需要 / 用户若确实不需要可忽略。

# 约束
- 只提"整类缺失"，不重复需求里已有内容的字段级问题。
- 宁少而准：每条须能对应"这类应用的常规构成"或"未覆盖维度"，不凭空发明，不发明用户明显不需要的功能。

# 输出
仅输出严格JSON数组，无任何额外文字/注释/markdown围栏：
[{ "kind":"entity|screen|flow|role|dimension", "missing":"跟进记录实体", "why":"CRM核心是跟进过程，几乎必有", "ignorableIf":"纯静态名录则不需要", "source":"archetype|uncovered-dimension" }]`;
  }

  /** 健壮解析：去围栏 → 抽数组 → 过滤合法项。失败降级为空。 */
  private parseGaps(resp: string): CompletenessGap[] {
    if (!resp) return [];
    const m = resp.match(/\[[\s\S]*\]/);
    if (!m) return [];
    try {
      const arr = JSON.parse(m[0]) as unknown[];
      return arr
        .filter((g): g is CompletenessGap => !!g && typeof (g as CompletenessGap).missing === 'string')
        .slice(0, 30)
        .map((g) => ({
          kind: g.kind || 'dimension',
          missing: g.missing,
          why: g.why || '',
          ignorableIf: g.ignorableIf,
          source: g.source,
        }));
    } catch {
      return [];
    }
  }

  private async requireProject(userId: string, projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { userId: true, name: true, structuredRequirement: true },
    });
    if (!project) throw new NotFoundException('项目不存在');
    if (project.userId !== userId) throw new ForbiddenException('无权访问');
    return project;
  }
}
