import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { StatusMapperService } from '../../services/status-mapper.service';
import { assertOrgAccess, TenantContext } from '../../common/utils/tenant-scope';
import { MergedItem } from './import-understanding.service';

/**
 * 规格物化（P15-8）：把已确认的 RequirementUnderstanding 物化为带溯源的草稿 Specification，
 * 汇入现有规格链路 —— 之后走现成 updateSpec/freezeSpec → spec_confirmed（不另起并行链路）。
 *
 * - Specification 1:1 Project：批次无 project 时自动新建一个承载（导入路径天然产出项目）。
 *   导入是跳过 clarify/plan 的捷径，新建 project 直接置 spec_ready。
 * - 每个 coreFunction/page/role/targetUser 带 provenance（来源资料文件名），落实 §3.2 可追溯。
 * - acceptanceScenarios 先给占位（验收基线核心，后续 P15-Y 完善）。
 */
@Injectable()
export class SpecMaterializeService {
  constructor(
    private prisma: PrismaService,
    private statusMapper: StatusMapperService,
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

    const planSummary = this.buildPlanSummary(understanding);
    const projectId = await this.ensureProject(ctx, batch, understanding.positioning, planSummary);

    const existing = await this.prisma.specification.findUnique({ where: { projectId } });
    const specData = this.assemble(understanding);
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
  private assemble(u: {
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
      acceptanceScenarios: [
        { name: '核心功能验收', given: '用户已登录系统', when: '执行核心操作', then: '操作成功完成', priority: 'must' },
      ],
      primaryRisks: [],
    };
  }

  private items(v: unknown): MergedItem[] {
    if (!Array.isArray(v)) return [];
    return v.filter(
      (x): x is MergedItem =>
        !!x && typeof (x as MergedItem).name === 'string' && Array.isArray((x as MergedItem).sources),
    );
  }
}
