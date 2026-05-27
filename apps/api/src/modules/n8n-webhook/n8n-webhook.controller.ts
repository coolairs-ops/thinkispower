import { Controller, Post, Body, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CloudecodeClient } from '../../integrations/cloudecode/cloudecode.client';
import { TaskService } from '../task/task.service';
import { PrismaService } from '../../database/prisma.service';
import { StatusMapperService } from '../../services/status-mapper.service';
import { EVENTS } from '../../events/event-types';
import { Public } from '../../common/decorators/public.decorator';

@Controller('api/n8n-webhook')
export class N8nWebhookController {
  private readonly logger = new Logger(N8nWebhookController.name);

  constructor(
    private cloudecode: CloudecodeClient,
    private taskService: TaskService,
    private prisma: PrismaService,
    private eventEmitter: EventEmitter2,
    private statusMapper: StatusMapperService,
  ) {}

  @Public()
  @Post('execute-task')
  async executeTask(@Body() body: { taskId: string }) {
    const { taskId } = body;
    this.logger.log(`N8N webhook: execute task ${taskId}`);

    if (!taskId) {
      return { success: false, error: 'Missing taskId' };
    }

    const result = await this.cloudecode.executeTask(taskId);
    this.logger.log(`N8N webhook: task ${taskId} -> ${result.success ? 'ok' : 'fail'}`);
    return result;
  }

  @Public()
  @Post('task-complete')
  async taskComplete(@Body() body: { taskId: string; projectId: string; success: boolean; summary?: string }) {
    const { taskId, projectId, success, summary } = body;
    this.logger.log(`N8N webhook: task ${taskId} completed (success=${success})`);

    if (success) {
      await this.taskService.updateStatus(taskId, 'completed', {
        resultPayload: { summary, source: 'n8n' },
      });
    } else {
      await this.taskService.updateStatus(taskId, 'failed', {
        errorMessage: summary || 'N8N workflow reported failure',
      });
    }

    return { received: true };
  }

  @Public()
  @Post('delivery-complete')
  async deliveryComplete(@Body() body: {
    projectId: string;
    success: boolean;
    productionUrl?: string;
    error?: string;
    metrics?: { duration: number; tasksCompleted: number; tasksFailed: number };
  }) {
    const { projectId, success, productionUrl, error, metrics } = body;
    this.logger.log(`[反馈信道] 交付完成回调: project=${projectId} success=${success}`);

    if (success) {
      // 正向通道：交付成功
      const updateData: any = {
        status: 'completed',
        publicStatusLabel: this.statusMapper.mapProjectStatusToPublicLabel('completed'),
      };
      if (productionUrl) {
        updateData.productionUrl = productionUrl;
      }

      await this.prisma.project.update({
        where: { id: projectId },
        data: updateData,
      });

      // 记录指标到最新的 Build（状态观测器数据）
      if (metrics) {
        const latestBuild = await this.prisma.build.findFirst({
          where: { projectId },
          orderBy: { version: 'desc' },
          select: { id: true },
        });
        if (latestBuild) {
          await this.prisma.build.update({
            where: { id: latestBuild.id },
            data: {
              status: 'success',
              productionUrl: productionUrl || undefined,
              testReport: metrics as any,
            },
          });
        }
      }

      this.logger.log(`[反馈信道] 交付完成: ${productionUrl || '无 URL'}`);
    } else {
      // 异常通道：交付失败
      await this.prisma.project.update({
        where: { id: projectId },
        data: {
          status: 'build_failed',
          publicStatusLabel: this.statusMapper.mapProjectStatusToPublicLabel('build_failed'),
        },
      });

      if (metrics) {
        const latestBuild = await this.prisma.build.findFirst({
          where: { projectId },
          orderBy: { version: 'desc' },
          select: { id: true },
        });
        if (latestBuild) {
          await this.prisma.build.update({
            where: { id: latestBuild.id },
            data: {
              status: 'failed',
              testReport: { error, ...metrics } as any,
            },
          });
        }
      }

      this.logger.error(`[反馈信道] 交付失败: ${error || '未知错误'}`);
    }

    return { received: true };
  }

  @Public()
  @Post('run-tasks')
  async runTasks(@Body() body: { projectId: string; feedbackId?: string | null; taskIds?: string[] }) {
    const { projectId, feedbackId } = body;
    const requestedTaskIds = Array.isArray(body.taskIds) ? body.taskIds.filter(Boolean) : [];
    this.logger.log(`N8N webhook: run tasks for project ${projectId} (${requestedTaskIds.length || 'pending'} requested)`);

    if (!projectId) {
      return { success: false, error: 'Missing projectId' };
    }

    const tasks = await this.prisma.task.findMany({
      where: requestedTaskIds.length > 0
        ? { projectId, id: { in: requestedTaskIds }, status: 'pending' }
        : { projectId, status: 'pending' },
      select: { id: true },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
    });

    if (tasks.length === 0) {
      this.logger.warn(`N8N webhook: no pending tasks for project ${projectId}`);
      return { success: true, taskCount: 0, taskIds: [] };
    }

    const taskIds = tasks.map((task) => task.id);
    this.eventEmitter.emit(EVENTS.TASKS_CREATED, {
      projectId,
      feedbackId: feedbackId || null,
      taskIds,
    });

    return { success: true, taskCount: taskIds.length, taskIds };
  }

  @Public()
  @Post('tasks-complete')
  async tasksComplete(@Body() body: { projectId: string; feedbackId: string }) {
    const { projectId, feedbackId } = body;
    this.logger.log(`N8N webhook: all tasks complete for project ${projectId}`);

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { demoHtml: true },
    });

    this.eventEmitter.emit(EVENTS.TASKS_COMPLETED, {
      projectId,
      feedbackId,
      newHtml: project?.demoHtml || undefined,
    });

    return { received: true };
  }
}
