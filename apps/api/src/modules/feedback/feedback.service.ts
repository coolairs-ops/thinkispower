import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../database/prisma.service';
import { StatusMapperService } from '../../services/status-mapper.service';
import { EVENTS } from '../../events/event-types';

@Injectable()
export class FeedbackService {
  constructor(
    private prisma: PrismaService,
    private statusMapper: StatusMapperService,
    private eventEmitter: EventEmitter2,
  ) {}

  async findAll(userId: string, projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { userId: true },
    });
    if (!project) throw new NotFoundException('项目不存在');
    if (project.userId !== userId) throw new ForbiddenException('无权访问');

    return this.prisma.feedbackItem.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        moduleKey: true,
        elementPath: true,
        pageUrl: true,
        comment: true,
        status: true,
        createdAt: true,
      },
    });
  }

  async create(
    userId: string,
    projectId: string,
    data: { moduleKey?: string; elementPath?: string; pageUrl?: string; comment: string },
  ) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { userId: true, status: true },
    });
    if (!project) throw new NotFoundException('项目不存在');
    if (project.userId !== userId) throw new ForbiddenException('无权访问');

    const feedback = await this.prisma.feedbackItem.create({
      data: {
        projectId,
        moduleKey: data.moduleKey || null,
        elementPath: data.elementPath || null,
        pageUrl: data.pageUrl || null,
        comment: data.comment,
      },
    });

    // Update project status to awaiting_demo_feedback if currently demo_ready
    if (project.status === 'demo_ready') {
      await this.prisma.project.update({
        where: { id: projectId },
        data: {
          status: 'awaiting_demo_feedback',
          publicStatusLabel: this.statusMapper.mapProjectStatusToPublicLabel('awaiting_demo_feedback'),
        },
      });
    }

    // Emit event for the pipeline to process
    this.eventEmitter.emit(EVENTS.FEEDBACK_CREATED, {
      feedbackId: feedback.id,
      projectId,
      comment: data.comment,
      moduleKey: data.moduleKey,
      elementPath: data.elementPath,
    });

    return {
      id: feedback.id,
      moduleKey: feedback.moduleKey,
      elementPath: feedback.elementPath,
      comment: feedback.comment,
      status: feedback.status,
      createdAt: feedback.createdAt,
    };
  }

  async updateStatus(userId: string, projectId: string, feedbackId: string, newStatus: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { userId: true },
    });
    if (!project) throw new NotFoundException('项目不存在');
    if (project.userId !== userId) throw new ForbiddenException('无权访问');

    const feedback = await this.prisma.feedbackItem.findFirst({
      where: { id: feedbackId, projectId },
    });
    if (!feedback) throw new NotFoundException('反馈不存在');

    const validStatuses = ['new', 'processing', 'resolved'];
    if (!validStatuses.includes(newStatus)) {
      throw new BadRequestException('无效的状态值，有效值：new, processing, resolved');
    }

    const updated = await this.prisma.feedbackItem.update({
      where: { id: feedbackId },
      data: { status: newStatus },
    });

    return {
      id: updated.id,
      status: updated.status,
    };
  }
}
