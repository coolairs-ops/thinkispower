import { Injectable, ForbiddenException, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { StatusMapperService } from '../../services/status-mapper.service';

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

  async create(userId: string, data: { name: string; description?: string }) {
    const project = await this.prisma.project.create({
      data: {
        userId,
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

  async findAll(userId: string) {
    const projects = await this.prisma.project.findMany({
      where: { userId },
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

  async findOne(userId: string, projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: { deliveryOptions: true },
    });
    if (!project) throw new NotFoundException('项目不存在');
    if (project.userId !== userId) throw new ForbiddenException('无权访问该项目');
    return this.toPublicProject(project);
  }

  async update(userId: string, projectId: string, data: { name?: string; description?: string; appType?: string; structuredRequirement?: any }) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('项目不存在');
    if (project.userId !== userId) throw new ForbiddenException('无权修改该项目');

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

  async confirmPlan(userId: string, projectId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('项目不存在');
    if (project.userId !== userId) throw new ForbiddenException('无权操作');
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
}
