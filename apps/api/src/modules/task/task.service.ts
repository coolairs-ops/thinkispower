import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class TaskService {
  private readonly logger = new Logger(TaskService.name);

  constructor(private prisma: PrismaService) {}

  async create(data: {
    projectId: string;
    moduleId?: string;
    type: string;
    title: string;
    description: string;
    priority?: number;
    inputPayload?: Record<string, any>;
  }) {
    return this.prisma.task.create({
      data: {
        projectId: data.projectId,
        moduleId: data.moduleId || null,
        type: data.type,
        title: data.title,
        description: data.description,
        priority: data.priority ?? 100,
        inputPayload: data.inputPayload || undefined,
      },
    });
  }

  async findById(id: string) {
    return this.prisma.task.findUnique({ where: { id } });
  }

  async findByProject(projectId: string) {
    return this.prisma.task.findMany({
      where: { projectId },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async getPendingTasks(projectId: string) {
    return this.prisma.task.findMany({
      where: { projectId, status: 'pending' },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async updateStatus(id: string, status: string, extra?: { resultPayload?: Record<string, any>; errorMessage?: string }) {
    const updateData: any = { status };
    if (extra?.resultPayload) updateData.resultPayload = extra.resultPayload;
    if (extra?.errorMessage) updateData.errorMessage = extra.errorMessage;
    return this.prisma.task.update({ where: { id }, data: updateData });
  }
}
