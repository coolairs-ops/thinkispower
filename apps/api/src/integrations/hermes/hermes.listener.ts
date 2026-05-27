import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OnEvent } from '@nestjs/event-emitter';
import { HermesClient } from './hermes.client';
import { N8nClient } from '../n8n/n8n.client';
import { EVENTS, FeedbackCreatedPayload, UserConfirmedPlanPayload } from '../../events/event-types';

@Injectable()
export class HermesListener {
  private readonly logger = new Logger(HermesListener.name);

  constructor(
    private eventEmitter: EventEmitter2,
    private hermes: HermesClient,
    private n8nClient: N8nClient,
  ) {}

  @OnEvent(EVENTS.FEEDBACK_CREATED)
  async handleFeedbackCreated(payload: FeedbackCreatedPayload) {
    this.logger.log(`Hermes processing feedback ${payload.feedbackId}`);

    try {
      const taskIds = await this.hermes.handleFeedback(payload.feedbackId);

      if (taskIds.length === 0) {
        this.logger.warn(`No tasks created for feedback ${payload.feedbackId}`);
        return;
      }

      // 优先通过 N8N 编排任务执行
      const n8nResult = await this.n8nClient.triggerTaskPlanningWorkflow(
        payload.projectId,
        payload.feedbackId,
        taskIds,
      );

      if (n8nResult.success) {
        this.logger.log(
          `N8N workflow triggered for ${taskIds.length} tasks (project ${payload.projectId})`,
        );
        // N8N 接管执行，不 emit TASKS_CREATED，避免 PipelineService 重复处理
        return;
      }

      // N8N 不可用 → 降级到本地 PipelineService
      this.logger.warn(
        `N8N not available, falling back to local PipelineService for project ${payload.projectId}`,
      );
      this.eventEmitter.emit(EVENTS.TASKS_CREATED, {
        projectId: payload.projectId,
        feedbackId: payload.feedbackId,
        taskIds,
      });
    } catch (error) {
      this.logger.error(`Hermes processing failed for feedback ${payload.feedbackId}`, error);
    }
  }

  @OnEvent(EVENTS.USER_CONFIRMED_PLAN)
  async handleUserConfirmedPlan(payload: UserConfirmedPlanPayload) {
    this.logger.log(`[Hermes] 用户确认方案, 启动交付管线, 项目 ${payload.projectId}`);

    // 用户的确认信号 → Hermes 认知分析 → N8N 编排 → Cloudecode 执行
    // DeliveryService.confirmDelivery 已完成全套流程
  }
}
