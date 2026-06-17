import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { DeliveryEvaluationService } from './delivery-evaluation.service';
import {
  DELIVERY_QUEUE,
  PRODUCTION_DELIVERY_JOB,
  RE_EVALUATE_JOB,
  ProductionDeliveryJob,
  ReEvaluateJob,
} from './delivery.queue';

/**
 * 交付长任务 Worker（BullMQ）。取代原 fire-and-forget：持久化、进程重启可恢复、失败记录。
 * 任务内部已各自有重试/降级链路，故 attempts=1，避免昂贵的 LLM/交付动作被重复执行。
 */
@Processor(DELIVERY_QUEUE)
export class DeliveryProcessor extends WorkerHost {
  private readonly logger = new Logger(DeliveryProcessor.name);

  constructor(private evaluation: DeliveryEvaluationService) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name === PRODUCTION_DELIVERY_JOB) {
      const { deliveryId, projectId, payload } = job.data as ProductionDeliveryJob;
      this.logger.log(`生产交付开始 delivery=${deliveryId} project=${projectId} (job ${job.id})`);
      await this.evaluation.runProductionDelivery(deliveryId, projectId, payload);
    } else if (job.name === RE_EVALUATE_JOB) {
      const { taskId, projectId, sr, queue, demoHtml, planSummary, description } = job.data as ReEvaluateJob;
      this.logger.log(`修复重评估开始 task=${taskId} project=${projectId} (job ${job.id})`);
      await this.evaluation.runReEvaluate(taskId, projectId, sr, queue, demoHtml, planSummary, description);
    } else {
      this.logger.warn(`未知交付 job 类型: ${job.name} (job ${job.id})`);
    }
  }
}
