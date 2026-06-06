import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { DemoService } from './demo.service';
import { DEMO_QUEUE, DemoGenerateJob } from './demo.queue';

/**
 * 预览生成 Worker（BullMQ）。
 * 取代原 fire-and-forget 异步：持久化、进程重启可恢复、失败自动重试。
 * 生成本身与进度更新在 DemoService.executeGeneration，这里只负责队列消费与重试编排。
 */
@Processor(DEMO_QUEUE)
export class DemoProcessor extends WorkerHost {
  private readonly logger = new Logger(DemoProcessor.name);

  constructor(private demoService: DemoService) {
    super();
  }

  async process(job: Job<DemoGenerateJob>): Promise<void> {
    const { projectId } = job.data;
    const attempts = job.opts.attempts ?? 1;
    const attemptNo = job.attemptsMade + 1;
    this.logger.log(`预览生成开始 project=${projectId} (尝试 ${attemptNo}/${attempts}, job ${job.id})`);

    try {
      await this.demoService.executeGeneration(projectId);
    } catch (e) {
      const willRetry = attemptNo < attempts;
      this.logger.warn(
        `预览生成失败 project=${projectId} (${attemptNo}/${attempts})${willRetry ? '，将重试' : '，终态失败'}: ${e instanceof Error ? e.message : e}`,
      );
      await this.demoService.onGenerationError(projectId, willRetry, attemptNo + 1);
      throw e; // 交给 BullMQ 记录失败 / 触发重试
    }
  }
}
