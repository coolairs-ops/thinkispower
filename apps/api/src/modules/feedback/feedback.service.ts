import { Injectable, NotFoundException, ForbiddenException, BadRequestException, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../database/prisma.service';
import { StatusMapperService } from '../../services/status-mapper.service';
import { SpecificationService } from '../specification/specification.service';
import { EVENTS, TaskFailedPayload, TasksCompletedPayload } from '../../events/event-types';

@Injectable()
export class FeedbackService {
  private readonly logger = new Logger(FeedbackService.name);

  constructor(
    private prisma: PrismaService,
    private statusMapper: StatusMapperService,
    private eventEmitter: EventEmitter2,
    private specService: SpecificationService,
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
        feedbackType: true,
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

    // 自动判定 bug vs 变更请求（基于冻结的规格）
    let feedbackType = 'bug';
    try {
      const spec = await this.prisma.specification.findUnique({ where: { projectId } });
      if (spec && spec.status === 'frozen') {
        feedbackType = this.specService.isBugWithinSpec(spec, data.comment) ? 'bug' : 'change_request';
      }
    } catch (e) {
      this.logger.warn(`规格判定失败，默认标记为bug: ${e}`);
    }

    const feedback = await this.prisma.feedbackItem.create({
      data: {
        projectId,
        moduleKey: data.moduleKey || null,
        elementPath: data.elementPath || null,
        pageUrl: data.pageUrl || null,
        comment: data.comment,
        feedbackType,
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

  @OnEvent(EVENTS.TASKS_COMPLETED)
  async handleFeedbackTasksCompleted(payload: TasksCompletedPayload) {
    if (!payload.feedbackId) return;

    const feedback = await this.prisma.feedbackItem.findFirst({
      where: { id: payload.feedbackId, projectId: payload.projectId },
      select: { id: true },
    });
    if (!feedback) return;

    await this.prisma.feedbackItem.update({
      where: { id: payload.feedbackId },
      data: { status: 'resolved' },
    });

    this.statusMapper.assertValidTransition(
      (await this.prisma.project.findUnique({ where: { id: payload.projectId }, select: { status: true } }))?.status || '',
      'demo_ready',
    );
    await this.prisma.project.update({
      where: { id: payload.projectId },
      data: {
        status: 'demo_ready',
        publicStatusLabel: this.statusMapper.mapProjectStatusToPublicLabel('demo_ready'),
      },
    });
  }

  @OnEvent(EVENTS.TASK_FAILED)
  async handleFeedbackTaskFailed(payload: TaskFailedPayload) {
    if (!payload.feedbackId) return;

    const feedback = await this.prisma.feedbackItem.findFirst({
      where: { id: payload.feedbackId, projectId: payload.projectId },
      select: { id: true },
    });
    if (!feedback) return;

    await this.prisma.feedbackItem.update({
      where: { id: payload.feedbackId },
      data: { status: 'processing' },
    });

    await this.prisma.project.update({
      where: { id: payload.projectId },
      data: {
        status: 'failed',
        publicStatusLabel: this.statusMapper.mapProjectStatusToPublicLabel('failed'),
      },
    });
  }
}
