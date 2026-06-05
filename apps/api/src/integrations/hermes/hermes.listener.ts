import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OnEvent } from '@nestjs/event-emitter';
import { HermesClient } from './hermes.client';
import { EVENTS, FeedbackCreatedPayload } from '../../events/event-types';

@Injectable()
export class HermesListener {
  private readonly logger = new Logger(HermesListener.name);

  constructor(
    private eventEmitter: EventEmitter2,
    private hermes: HermesClient,
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

      // 直接使用本地 PipelineService 执行任务（N8N 已弃用）
      this.logger.log(
        `Dispatching ${taskIds.length} tasks to local PipelineService (project ${payload.projectId})`,
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

}
