import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OnEvent } from '@nestjs/event-emitter';
import { OpenClawClient } from './openclaw.client';
import { EVENTS, FeedbackCreatedPayload } from '../../events/event-types';

@Injectable()
export class OpenClawListener {
  private readonly logger = new Logger(OpenClawListener.name);

  constructor(
    private eventEmitter: EventEmitter2,
    private openclaw: OpenClawClient,
  ) {}

  @OnEvent(EVENTS.FEEDBACK_CREATED)
  async handleFeedbackCreated(payload: FeedbackCreatedPayload) {
    this.logger.log(`OpenClaw processing feedback ${payload.feedbackId}`);

    try {
      const taskIds = await this.openclaw.handleFeedback(payload.feedbackId);

      if (taskIds.length > 0) {
        this.eventEmitter.emit(EVENTS.TASKS_CREATED, {
          projectId: payload.projectId,
          feedbackId: payload.feedbackId,
          taskIds,
        });
      }
    } catch (error) {
      this.logger.error(`OpenClaw processing failed for feedback ${payload.feedbackId}`, error);
    }
  }
}
