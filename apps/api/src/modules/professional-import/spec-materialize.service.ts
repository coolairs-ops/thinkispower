import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { StatusMapperService } from '../../services/status-mapper.service';
import { LlmGatewayService } from '../../integrations/llm/llm-gateway.service';
import { assertOrgAccess, TenantContext } from '../../common/utils/tenant-scope';
import { MergedItem } from './import-understanding.service';

/** 真实验收场景：Given-When-Then + 溯源(provenance) + 覆盖功能(coverage)，作为验收报告(P15-Y)的数据地基 */
export interface AcceptanceScenario {
  name: string;
  given: string;
  when: string;
  then: string;
  priority: 'must' | 'nice';
  /** 来源资料文件名，沿用所覆盖功能的 provenance */
  provenance: string[];
  /** 本场景覆盖的核心功能名 */
  coverage: string[];
}

/**
 * 规格物化（P15-8）：把已确认的 RequirementUnderstanding 物化为带溯源的草稿 Specification，
 * 汇入现有规格链路 —— 之后走现成 updateSpec/freezeSpec → spec_confirmed（不另起并行链路）。
 *
 * - Specification 1:1 Project：批次无 project 时自动新建一个承载（导入路径天然产出项目）。
 *   导入是跳过 clarify/plan 的捷径，新建 project 直接置 spec_ready。
 * - 每个 coreFunction/page/role/targetUser 带 provenance（来源资料文件名），落实 §3.2 可追溯。
 * - acceptanceScenarios 由 features 生成真实 Given-When-Then(带 provenance/coverage)，作为验收报告(P15-Y)地基。
 */
@Injectable()
export class SpecMaterializeService {
  private readonly logger = new Logger(SpecMaterializeService.name);

  constructor(
    private prisma: PrismaService,
    private statusMapper: StatusMapperService,
    private llm: LlmGatewayService,
  ) {}

  /** 物化批次的需求理解为草稿规格，返回承载项目与规格 */
  async materializeSpec(ctx: TenantContext, batchId: string) {
    const batch = await this.prisma.importBatch.findUnique({ where: { id: batchId } });
    if (!batch) throw new NotFoundException('导入批次不存在');
    assertOrgAccess(batch.orgId, ctx.orgId, { allowLegacyNull: true });

    const understanding = await this.prisma.requirementUnderstanding.findUnique({
      where: { batchId },
    });
    if (!understanding) throw new BadRequestException('请先生成需求理解');

    // 门控(P15-7)：存在未解决的「高」严重度冲突时不放行物化，先让 PM 在确认页澄清
    const blockingConflicts = await this.prisma.requirementQuestion.count({
      where: { understandingId: understanding.id, resolved: false, severity: 'high' },
    });
    if (blockingConflicts > 0) {
      throw new BadRequestException(
        `存在 ${blockingConflicts} 项未解决的高冲突，请先在需求理解页逐条确认后再生成规格`,
      );
    }

    const planSummary = this.buildPlanSummary(understanding);
    const projectId = await this.ensureProject(ctx, batch, understanding.positioning, planSummary);

    const existing = await this.prisma.specification.findUnique({ where: { projectId } });
    const specData = await this.assemble(understanding);
    const spec = await this.prisma.specification.upsert({
      where: { projectId },
      create: { projectId, version: 1, status: 'draft', ...specData },
      update: { version: (existing?.version ?? 0) + 1, status: 'draft', ...specData },
    });

    await this.prisma.requirementUnderstanding.update({
      where: { batchId },
      data: { status: 'confirmed' },
    });
    await this.prisma.importBatch.update({
      where: { id: batchId },
      data: { status: 'confirmed' },
    });

    return { projectId, spec };
  }

  /** 确定承载项目：批次已关联则复用并置 spec_ready；否则新建一个。同时写入 planSummary 供下游 demo 生成 */
  private async ensureProject(
    ctx: TenantContext,
    batch: { id: string; projectId: string | null; orgId: string | null; name: string | null },
    positioning: string | null,
    planSummary: Record<string, unknown>,
  ): Promise<string> {
    const label = this.statusMapper.mapProjectStatusToPublicLabel('spec_ready');

    if (batch.projectId) {
      await this.prisma.project.update({
        where: { id: batch.projectId },
        data: { status: 'spec_ready', publicStatusLabel: label, planSummary: planSummary as never },
      });
      return batch.projectId;
    }

    const project = await this.prisma.project.create({
      data: {
        userId: ctx.userId,
        orgId: batch.orgId,
        name: batch.name || positioning?.slice(0, 40) || '导入项目',
        description: positioning || '',
        status: 'spec_ready',
        publicStatusLabel: label,
        planSummary: planSummary as never,
        deliveryOptions: { create: {} },
      },
    });
    await this.prisma.importBatch.update({
      where: { id: batch.id },
      data: { projectId: project.id },
    });
    return project.id;
  }

  /** 从需求理解组装 planSummary —— 下游 demo/预览生成的输入(导入路径跳过了 plan 阶段，在此补齐) */
  private buildPlanSummary(u: {
    positioning: string | null;
    features: unknown;
    pages: unknown;
    roles: unknown;
  }): Record<string, unknown> {
    const names = (v: unknown) =>
      this.items(v).map((x) => ({ name: x.name }));
    return {
      positioning: u.positioning ?? '',
      features: names(u.features),
      pages: names(u.pages),
      roles: names(u.roles),
      source: 'import',
    };
  }

  /** 从需求理解组装规格内容，逐条带 provenance(来源资料) */
  private async assemble(u: {
    features: unknown;
    pages: unknown;
    roles: unknown;
  }) {
    const features = this.items(u.features);
    const pages = this.items(u.pages);
    const roles = this.items(u.roles);

    return {
      targetUsers: roles.map((r) => ({ role: r.name, description: '', provenance: r.sources })),
      coreFunctions: features.map((f) => ({
        name: f.name,
        description: '',
        priority: 'must',
        provenance: f.sources,
      })),
      outOfScope: [],
      pages: pages.map((p) => ({
        name: p.name,
        route: `/${p.name.toLowerCase()}`,
        description: '',
        provenance: p.sources,
      })),
      roles: roles.map((r) => ({ name: r.name, permissions: ['view'], provenance: r.sources })),
      dataModels: [],
      businessRules: [],
      acceptanceScenarios: (await this.buildAcceptanceScenarios(features)) as never,
      primaryRisks: [],
    };
  }

  /**
   * 从功能清单生成真实的 Given-When-Then 验收场景(P15-Y 数据地基)。
   * 每个场景带 coverage(覆盖功能名) 与 provenance(沿用功能来源资料)。
   * 先 LLM 批量生成专业 GWT；失败/无功能则回落到确定性逐功能场景，保证报告始终有可验收内容。
   */
  private async buildAcceptanceScenarios(features: MergedItem[]): Promise<AcceptanceScenario[]> {
    if (features.length === 0) return [];
    const sourceOf = new Map(features.map((f) => [f.name, f.sources]));

    const llm = await this.llmScenarios(features).catch((e) => {
      this.logger.warn(`验收场景 LLM 生成失败，回落确定性场景: ${e}`);
      return null;
    });

    const raw = llm && llm.length > 0 ? llm : this.fallbackScenarios(features);

    // 统一补齐 provenance(按 coverage 命中的功能来源合并去重)与字段，丢弃无名场景
    return raw
      .filter((s) => s.name && s.then)
      .map((s) => {
        const coverage = (s.coverage ?? []).filter((c) => sourceOf.has(c));
        const provenance = [
          ...new Set(coverage.flatMap((c) => sourceOf.get(c) ?? [])),
        ];
        return {
          name: s.name,
          given: s.given || '用户已登录并具备相应权限',
          when: s.when || `使用「${s.name}」`,
          then: s.then,
          priority: s.priority === 'nice' ? 'nice' : 'must',
          coverage: coverage.length > 0 ? coverage : (s.coverage ?? []),
          provenance,
        } as AcceptanceScenario;
      });
  }

  /** 确定性兜底：逐功能给一条可验收的 GWT 场景 */
  private fallbackScenarios(features: MergedItem[]): AcceptanceScenario[] {
    return features.map((f) => ({
      name: `${f.name} 验收`,
      given: '用户已登录并具备相应权限',
      when: `使用「${f.name}」功能`,
      then: `${f.name}按预期正常完成，无报错`,
      priority: 'must',
      coverage: [f.name],
      provenance: f.sources,
    }));
  }

  /** LLM 批量从功能生成 GWT 场景；只返回 {name,given,when,then,priority,coverage}，provenance 在上层补 */
  private async llmScenarios(features: MergedItem[]): Promise<Array<Partial<AcceptanceScenario>> | null> {
    const list = features.map((f, i) => `${i + 1}. ${f.name}`).join('\n');
    const system =
      '你是一位资深测试/验收工程师。请把给定的产品功能清单转化为可执行的验收场景(Given-When-Then)。' +
      '只输出一个 JSON 对象，不要任何解释或 markdown 代码块。要求：\n' +
      '- 为每个功能至少生成一条核心场景；关键功能可补充一条异常/边界场景。\n' +
      '- given=前置条件，when=用户操作，then=可观察的预期结果(具体、可判定)。\n' +
      '- coverage 必须是它覆盖的功能名(从清单原文照抄，可多个)。\n' +
      '- priority: 核心路径 must，次要/边界 nice。\n' +
      '字段：{"scenarios":[{"name":"场景名","given":"前置","when":"操作","then":"预期结果","priority":"must|nice","coverage":["功能名"]}]}';

    const raw = await this.llm.chat(
      'text-primary',
      { system, user: `功能清单：\n${list}` },
      { temperature: 0.2, maxTokens: 4000 },
    );

    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    let parsed: { scenarios?: unknown };
    try {
      parsed = JSON.parse(raw.slice(start, end + 1));
    } catch {
      return null;
    }
    if (!Array.isArray(parsed.scenarios)) return null;
    return parsed.scenarios
      .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
      .map((s) => ({
        name: typeof s.name === 'string' ? s.name : '',
        given: typeof s.given === 'string' ? s.given : '',
        when: typeof s.when === 'string' ? s.when : '',
        then: typeof s.then === 'string' ? s.then : '',
        priority: s.priority === 'nice' ? 'nice' : 'must',
        coverage: Array.isArray(s.coverage) ? s.coverage.filter((c): c is string => typeof c === 'string') : [],
      }));
  }

  private items(v: unknown): MergedItem[] {
    if (!Array.isArray(v)) return [];
    return v.filter(
      (x): x is MergedItem =>
        !!x && typeof (x as MergedItem).name === 'string' && Array.isArray((x as MergedItem).sources),
    );
  }
}
