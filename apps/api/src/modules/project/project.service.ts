import { Injectable, ForbiddenException, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { StatusMapperService } from '../../services/status-mapper.service';
import { assertOrgAccess } from '../../common/utils/tenant-scope';

@Injectable()
export class ProjectService {
  private readonly logger = new Logger(ProjectService.name);

  constructor(
    private prisma: PrismaService,
    private statusMapper: StatusMapperService,
  ) {}

  /**
   * 带状态机校验的项目状态更新。
   * 替换所有散布在各处的直接 prisma.project.update({ data: { status } })。
   */
  async updateProjectStatus(projectId: string, nextStatus: string): Promise<void> {
    const current = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { status: true },
    });
    if (!current) throw new NotFoundException('项目不存在');

    this.statusMapper.assertValidTransition(current.status, nextStatus);

    await this.prisma.project.update({
      where: { id: projectId },
      data: {
        status: nextStatus,
        publicStatusLabel: this.statusMapper.mapProjectStatusToPublicLabel(nextStatus),
      },
    });

    this.logger.log(`项目 ${projectId} 状态: ${current.status} → ${nextStatus}`);
  }

  async create(userId: string, orgId: string, data: { name: string; description?: string }) {
    const project = await this.prisma.project.create({
      data: {
        userId,
        orgId,
        name: data.name,
        description: data.description || '',
        status: 'needs_input',
        publicStatusLabel: this.statusMapper.mapProjectStatusToPublicLabel('needs_input'),
        deliveryOptions: {
          create: {},
        },
      },
      include: { deliveryOptions: true },
    });
    return this.toPublicProject(project);
  }

  async findAll(userId: string, orgId: string | null) {
    const projects = await this.prisma.project.findMany({
      where: { userId, ...(orgId ? { orgId } : {}) }, // 租户边界：有 org 上下文则按 org 过滤（own + 同租户）
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        appType: true,
        publicStatusLabel: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return projects.map((p) => ({
      id: p.id,
      name: p.name,
      appType: p.appType,
      status: p.publicStatusLabel,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    }));
  }

  async findOne(userId: string, orgId: string | null, projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: { deliveryOptions: true },
    });
    if (!project) throw new NotFoundException('项目不存在');
    this.assertAccess(project, userId, orgId);
    return this.toPublicProject(project);
  }

  async update(userId: string, orgId: string | null, projectId: string, data: { name?: string; description?: string; appType?: string; structuredRequirement?: any }) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('项目不存在');
    this.assertAccess(project, userId, orgId);

    const updateData: any = { ...data };
    if (data.structuredRequirement) {
      updateData.structuredRequirement = data.structuredRequirement as any;
    }

    const updated = await this.prisma.project.update({
      where: { id: projectId },
      data: updateData,
      include: { deliveryOptions: true },
    });
    return this.toPublicProject(updated);
  }

  async confirmPlan(userId: string, orgId: string | null, projectId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('项目不存在');
    this.assertAccess(project, userId, orgId);
    if (project.status !== 'prd_ready') {
      throw new ForbiddenException('项目状态不是 prd_ready，无法确认方案');
    }

    const updated = await this.prisma.project.update({
      where: { id: projectId },
      data: {
        status: 'plan_ready',
        publicStatusLabel: this.statusMapper.mapProjectStatusToPublicLabel('plan_ready'),
      },
      include: { deliveryOptions: true },
    });
    return this.toPublicProject(updated);
  }

  private toPublicProject(project: any) {
    const { userId, planSummary, moduleMap, acceptanceChecklist, ...rest } = project;
    return {
      ...rest,
      hasPlan: !!planSummary,
    };
  }

  async remove(userId: string, orgId: string | null, projectId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('项目不存在');
    this.assertAccess(project, userId, orgId);
    await this.prisma.project.delete({ where: { id: projectId } });
  }

  /**
   * A2b 隔离收口：租户边界(org) + 组织内归属(userId) 二维校验。
   * 有 org 上下文才强制 org 边界（跨租户 → 403；过渡期 allowLegacyNull 放行尚未回填 orgId 的旧项目）；
   * 无 org 上下文（旧会话）退回纯 userId 归属（仍安全）。userId 校验保留=组织内只动自己的项目。
   */
  private assertAccess(project: { orgId: string | null; userId: string }, userId: string, orgId: string | null) {
    if (orgId) assertOrgAccess(project.orgId, orgId, { allowLegacyNull: true });
    if (project.userId !== userId) throw new ForbiddenException('无权访问该项目');
  }
}
