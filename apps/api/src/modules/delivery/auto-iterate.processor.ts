import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { DeliveryIterationService } from './delivery-iteration.service';
import { AUTO_ITERATE_QUEUE, AutoIterateJob } from './auto-iterate.queue';

/**
 * 自迭代长循环 Worker（BullMQ）。取代原进程内 fire-and-forget：
 * 持久化、进程重启可恢复（stalled job 重拨）、失败记录。
 *
 * 实时 SSE 进度走内存 Subject（同进程 provider，map 共享）；崩溃重拨后的 job
 * 在新进程没有 Subject，executeAutoIterate 仅落库 autoIterateState，前端轮询对账。
 */
@Processor(AUTO_ITERATE_QUEUE)
export class AutoIterateProcessor extends WorkerHost {
  private readonly logger = new Logger(AutoIterateProcessor.name);

  constructor(private iteration: DeliveryIterationService) {
    super();
  }

  async process(job: Job): Promise<void> {
    const { taskId, projectId } = job.data as AutoIterateJob;
    this.logger.log(`自迭代开始 task=${taskId} project=${projectId} (job ${job.id})`);
    await this.iteration.executeAutoIterate(taskId, projectId);
  }
}
