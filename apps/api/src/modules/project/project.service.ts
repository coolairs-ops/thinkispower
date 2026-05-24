import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { StatusMapperService } from '../../services/status-mapper.service';

@Injectable()
export class ProjectService {
  constructor(
    private prisma: PrismaService,
    private statusMapper: StatusMapperService,
  ) {}

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

  async update(userId: string, projectId: string, data: { name?: string; description?: string; appType?: string }) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new NotFoundException('项目不存在');
    if (project.userId !== userId) throw new ForbiddenException('无权修改该项目');

    const updated = await this.prisma.project.update({
      where: { id: projectId },
      data,
      include: { deliveryOptions: true },
    });
    return this.toPublicProject(updated);
  }

  private toPublicProject(project: any) {
    const { userId, structuredRequirement, planSummary, moduleMap, acceptanceChecklist, ...rest } = project;
    return {
      ...rest,
      hasPlan: !!planSummary,
    };
  }
}
