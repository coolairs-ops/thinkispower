import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { GuardianService } from './guardian.service';
import { GUARDIAN_QUEUE, GUARDIAN_SWEEP_JOB, GUARDIAN_CHECK_JOB, GuardianCheckJob } from './guardian.queue';

/**
 * 守护巡检 Worker（BullMQ，同进程）。
 * sweep：扫已上线项目，逐个入队 check（拆成单项任务 → 单项失败不拖累整轮、可独立重放）。
 * check：跑单项巡检。attempts=1：验收内部已自带降级，外层重试会重复昂贵的 LLM 判定。
 */
@Processor(GUARDIAN_QUEUE)
export class GuardianProcessor extends WorkerHost {
  private readonly logger = new Logger(GuardianProcessor.name);

  constructor(
    private guardian: GuardianService,
    @InjectQueue(GUARDIAN_QUEUE) private queue: Queue,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name === GUARDIAN_SWEEP_JOB) {
      const ids = await this.guardian.listGuardianProjects();
      this.logger.log(`Guardian 巡检 sweep：${ids.length} 个项目入队`);
      for (const projectId of ids) {
        await this.queue.add(
          GUARDIAN_CHECK_JOB,
          { projectId, trigger: 'scheduled' },
          { attempts: 1, removeOnComplete: true, removeOnFail: 50 },
        );
      }
    } else if (job.name === GUARDIAN_CHECK_JOB) {
      const { projectId, trigger } = job.data as GuardianCheckJob;
      await this.guardian.runCheck(projectId, trigger ?? 'scheduled');
    } else {
      this.logger.warn(`未知 Guardian job 类型: ${job.name} (job ${job.id})`);
    }
  }
}
