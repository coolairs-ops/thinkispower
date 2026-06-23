import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { DeepseekService } from '../../services/deepseek.service';
import { assertResourceAccess } from '../../common/utils/tenant-scope';

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
  // 升级D 处置分类（阶段4.5）：autofill 自动补默认 / ask 回去问用户 / info 仅提示
  disposition?: 'autofill' | 'ask' | 'info';
  question?: string; // 仅 disposition=ask：给非技术用户的二选一/单选小问题
  options?: string[]; // 仅 disposition=ask：可选项
  // 升级E 回写（kit §1「回流补进 IR」）：该缺口是否已回写进 planSummary，避免重复回写
  applied?: boolean;
}

type Disposition = 'autofill' | 'ask' | 'info';
const DISPOSITIONS: Disposition[] = ['autofill', 'ask', 'info'];

/** 回写后正式规格的同步结果：无操作 / 无规格 / 已并入 / 已冻结待重确认 */
type SpecSync = 'noop' | 'no-spec' | 'updated' | 'stale-frozen';

/**
 * 回写映射表（kit §1「整块缺失回流补进 IR」）：每个缺口 kind → planSummary 字段 + 正式规格字段 + 规格条目形状。
 * 只回写 screen/flow/entity（有明确生成/规格落点）；role/dimension 跨切面、无干净落点，不回写。
 */
const WRITEBACK = {
  screen: { plan: 'pages', spec: 'pages', toSpec: (n: string) => ({ name: n, route: `/${n}`, description: '' }) },
  flow: { plan: 'features', spec: 'coreFunctions', toSpec: (n: string) => ({ name: n, description: '', priority: 'must' }) },
  entity: { plan: 'dataObjects', spec: 'dataModels', toSpec: (n: string) => ({ name: n, fields: [{ name: 'id', type: 'string', required: true }] }) },
} as const;
type WbKind = keyof typeof WRITEBACK;
const WB_KINDS = Object.keys(WRITEBACK) as WbKind[];

@Injectable()
export class RequirementCompletionService {
  private readonly logger = new Logger(RequirementCompletionService.name);

  constructor(
    private prisma: PrismaService,
    private deepseek: DeepseekService,
  ) {}

  /** 跑一次 IR 完备性批判：找"整块漏掉的实体/页面/流程/角色/维度"，存库 + 返回。 */
  async analyze(userId: string, orgId: string | null, projectId: string): Promise<{ gaps: CompletenessGap[] }> {
    const project = await this.requireProject(userId, orgId, projectId);
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
  async get(userId: string, orgId: string | null, projectId: string): Promise<{ gaps: CompletenessGap[] }> {
    const project = await this.requireProject(userId, orgId, projectId);
    const sr = (project.structuredRequirement as Record<string, unknown>) || {};
    return { gaps: (sr.completenessGaps as CompletenessGap[]) ?? [] };
  }

  /**
   * 升级D 处置分类（阶段4.5）：对已存的完备性缺口逐条判 autofill/ask/info，
   * ask 类附带给用户的小问题，富集回 completenessGaps + 返回。需先跑过 analyze(A)。
   */
  async classify(userId: string, orgId: string | null, projectId: string): Promise<{ gaps: CompletenessGap[] }> {
    const project = await this.requireProject(userId, orgId, projectId);
    const sr = (project.structuredRequirement as Record<string, unknown>) || {};
    const gaps = (sr.completenessGaps as CompletenessGap[]) ?? [];
    if (gaps.length === 0) return { gaps: [] };

    let classified = gaps;
    try {
      const resp = await this.deepseek.chat([{ role: 'user', content: this.buildDispositionPrompt(gaps) }], {
        temperature: 0.3,
        maxTokens: 4096,
      });
      classified = this.applyDispositions(gaps, resp);
    } catch (e) {
      this.logger.warn(`处置分类失败 ${projectId}: ${e instanceof Error ? e.message : e}`);
      classified = gaps.map((g) => ({ ...g, disposition: 'info' as Disposition }));
    }

    sr.completenessGaps = classified as unknown;
    await this.prisma.project.update({ where: { id: projectId }, data: { structuredRequirement: sr as never } });
    const counts = classified.reduce<Record<string, number>>((a, g) => ((a[g.disposition || 'info'] = (a[g.disposition || 'info'] || 0) + 1), a), {});
    this.logger.log(`处置分类 ${projectId}: ${JSON.stringify(counts)}`);
    return { gaps: classified };
  }

  /**
   * 升级E 回写（kit §1「命中的整块缺失应回流补进 IR」）：把采纳的缺口按 kind 写回 planSummary——
   * screen→pages、flow→features、entity→dataObjects，让生成/设计建议/规格真正吃到补齐结果。
   * 采纳口径：disposition=autofill（低风险自动补）或用户在 accept 里显式选中（覆盖 ask/info）。
   * role/dimension 跨切面、无干净落点，不回写。回写后同步正式规格（syncSpec）。
   */
  async apply(
    userId: string,
    orgId: string | null,
    projectId: string,
    accept: string[] = [],
  ): Promise<{ added: Record<string, string[]>; applied: number; specSync: SpecSync }> {
    const project = await this.requireProject(userId, orgId, projectId);
    const sr = (project.structuredRequirement as Record<string, unknown>) || {};
    const gaps = (sr.completenessGaps as CompletenessGap[]) ?? [];
    const acceptSet = new Set(accept);
    const plan = (project.planSummary as Record<string, unknown>) || {};

    const added: Record<WbKind, string[]> = { screen: [], flow: [], entity: [] };
    let applied = 0;
    for (const kind of WB_KINDS) {
      const field = WRITEBACK[kind].plan;
      const list: unknown[] = Array.isArray(plan[field]) ? [...(plan[field] as unknown[])] : [];
      const existing = new Set(list.map((x) => this.shortName(x)));
      for (const g of gaps) {
        if (g.kind !== kind || g.applied) continue;
        if (!(g.disposition === 'autofill' || acceptSet.has(g.missing))) continue;
        const name = this.shortName(g.missing);
        if (name && !existing.has(name)) {
          list.push(name);
          existing.add(name);
          added[kind].push(name);
        }
        g.applied = true; // 标记已回写，apply 幂等（再调不会重复加）
        applied++;
      }
      plan[field] = list;
    }

    if (applied === 0) {
      return { added: { pages: [], features: [], dataObjects: [] }, applied: 0, specSync: 'noop' };
    }

    sr.completenessGaps = gaps as unknown;
    await this.prisma.project.update({
      where: { id: projectId },
      data: { planSummary: plan as never, structuredRequirement: sr as never },
    });
    // 让正式规格随动：回写改的是 planSummary，但 Specification 是另一份快照，不会自动更新。
    const specSync = await this.syncSpec(projectId, added);
    this.logger.log(`需求回写 ${projectId}: 采纳 ${applied} 个缺口，新增 ${JSON.stringify(added)}，规格同步=${specSync}`);
    return {
      added: { pages: added.screen, features: added.flow, dataObjects: added.entity },
      applied,
      specSync,
    };
  }

  /**
   * 把回写新增项同步进正式规格：未冻结→并入各对应字段(spec.pages/coreFunctions/dataModels)；
   * 已冻结→不偷改内容，只在 changeLog 留"待重新确认"信号，把解冻重确认的决定权交回用户。
   */
  private async syncSpec(projectId: string, added: Record<WbKind, string[]>): Promise<SpecSync> {
    const allAdded = WB_KINDS.flatMap((k) => added[k]);
    if (allAdded.length === 0) return 'noop';
    const spec = await this.prisma.specification.findUnique({ where: { projectId } });
    if (!spec) return 'no-spec'; // 规格尚未生成，日后 draft 会从已含新项的 planSummary 组装

    const changeLog = Array.isArray(spec.changeLog) ? [...(spec.changeLog as unknown[])] : [];
    if (spec.status === 'frozen') {
      changeLog.push({
        changedAt: new Date().toISOString(),
        action: 'pending-sync',
        pendingItems: allAdded,
        note: '需求补全新增页面/功能/实体，规格已冻结；建议解冻后重新确认',
      });
      await this.prisma.specification.update({ where: { projectId }, data: { changeLog: changeLog as never } });
      return 'stale-frozen';
    }

    const specRec = spec as unknown as Record<string, unknown>;
    const data: Record<string, unknown> = {};
    const addedToSpec: string[] = [];
    for (const kind of WB_KINDS) {
      if (added[kind].length === 0) continue;
      const cfg = WRITEBACK[kind];
      const cur: unknown[] = Array.isArray(specRec[cfg.spec]) ? [...(specRec[cfg.spec] as unknown[])] : [];
      const existing = new Set(cur.map((x) => this.shortName(x)));
      for (const n of added[kind]) {
        if (!existing.has(n)) {
          cur.push(cfg.toSpec(n));
          existing.add(n);
          addedToSpec.push(n);
        }
      }
      data[cfg.spec] = cur;
    }
    if (addedToSpec.length === 0) return 'updated'; // 各项规格里已存在
    changeLog.push({
      version: spec.version,
      changedAt: new Date().toISOString(),
      action: 'auto-sync',
      addedItems: addedToSpec,
      reason: '需求补全回写',
    });
    data.changeLog = changeLog;
    await this.prisma.specification.update({ where: { projectId }, data: data as never });
    return 'updated';
  }

  /** 从缺口描述/项提取简洁名："数据看板/统计报表页面"→"数据看板"、"门店基础信息实体"→"门店基础信息"。 */
  private shortName(p: unknown): string {
    const s = (typeof p === 'string' ? p : (p as { name?: string } | null)?.name || '').trim();
    const first = (s.split(/[/／、,，(（]/)[0] || s).trim();
    return first.replace(/(页面|页|实体|流程|模块)$/u, '').trim() || s;
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

  /** v2 §3 提示词：对每条 gap 判处置方式，ask 类给非技术用户的小问题。按序号对齐输出。 */
  private buildDispositionPrompt(gaps: CompletenessGap[]): string {
    const list = gaps.map((g, i) => `${i + 1}. [${g.kind}] ${g.missing}（${g.why}）`).join('\n');
    return `# 任务
下面是对一份B端需求做完备性批判后发现的"整块缺口"。请对**每一条**判定处置方式 disposition：
- "autofill"：有业界默认、低风险，直接补默认即可，无需问用户（如空数据态/加载态/删除二次确认/字段级校验/分页/基础列表页这类标配）。
- "ask"：属业务决策、无通用默认、答错代价高（如数据权限可见范围/状态机谁可改/是否需审批流/金额精度规则/谁能删数据）→ **不要替用户猜默认**，而是生成一个给非技术用户的二选一或单选小问题。
- "info"：可选增值能力（如导出、批量导入、对外接口）→ 仅提示，默认不做。

# 缺口清单
${list}

# 输出
仅输出严格JSON数组，无任何额外文字/注释/markdown围栏。每条对应上面一个序号，index 从1开始：
[{ "index":1, "disposition":"autofill|ask|info", "question":"销售之间能互相看客户吗？", "options":["只看自己负责的","看本部门全部","都能看"] }]
其中 question 与 options 仅在 disposition 为 "ask" 时给出；其余情况省略它们。`;
  }

  /** 把模型的处置结果按 index 对齐回 gaps；非法/未分类降级 info，ask 缺问题也降级 info。 */
  private applyDispositions(gaps: CompletenessGap[], resp: string): CompletenessGap[] {
    const byIndex = new Map<number, { disposition?: string; question?: unknown; options?: unknown }>();
    const m = (resp || '').match(/\[[\s\S]*\]/);
    if (m) {
      try {
        for (const item of JSON.parse(m[0]) as Array<Record<string, unknown>>) {
          const idx = Number(item?.index);
          if (Number.isInteger(idx)) byIndex.set(idx, item as never);
        }
      } catch {
        /* 解析失败：全部走默认 info */
      }
    }
    return gaps.map((g, i) => {
      const r = byIndex.get(i + 1);
      let disposition: Disposition = DISPOSITIONS.includes(r?.disposition as Disposition)
        ? (r!.disposition as Disposition)
        : 'info';
      const base: CompletenessGap = { ...g };
      delete base.question;
      delete base.options;
      if (disposition === 'ask') {
        const question = typeof r?.question === 'string' ? r.question.trim() : '';
        const options = Array.isArray(r?.options) ? (r!.options as unknown[]).filter((o): o is string => typeof o === 'string') : [];
        if (question && options.length >= 2) {
          return { ...base, disposition, question, options };
        }
        disposition = 'info'; // ask 但模型没给可用问题/选项 → 降级，不抛半成品追问给前端
      }
      return { ...base, disposition };
    });
  }

  private async requireProject(userId: string, orgId: string | null, projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { userId: true, orgId: true, name: true, structuredRequirement: true, planSummary: true },
    });
    if (!project) throw new NotFoundException('项目不存在');
    assertResourceAccess(project, userId, orgId);
    return project;
  }
}
