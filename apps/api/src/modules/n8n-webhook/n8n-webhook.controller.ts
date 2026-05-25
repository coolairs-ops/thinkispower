import { Controller, Post, Body, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CloudecodeClient } from '../../integrations/cloudecode/cloudecode.client';
import { TaskService } from '../task/task.service';
import { PrismaService } from '../../database/prisma.service';
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
