import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../database/prisma.service';
import { RuoyiProvisionService } from './ruoyi-provision.service';
import { RUOYI_PROVISION_QUEUE, RuoyiProvisionJob } from './ruoyi-provision.queue';

/**
 * 若依 provision Worker（BullMQ，同进程）。后台跑完整置备链（含分钟级编译/重启）。
 * attempts=1：建表/部署/编译是重副作用，盲目重试代价高且不幂等于"重启中"，失败留给人看 + 显式重放。
 * 状态机：controller 入队时写 provisioning；service 成功写 ready；本处失败写 error（流程/前端据此显示）。
 */
@Processor(RUOYI_PROVISION_QUEUE)
export class RuoyiProvisionProcessor extends WorkerHost {
  private readonly logger = new Logger(RuoyiProvisionProcessor.name);

  constructor(
    private readonly svc: RuoyiProvisionService,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    const { projectId, spec } = job.data as RuoyiProvisionJob;
    try {
      await this.svc.provision(projectId, spec);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`若依 provision 失败 project=${projectId}: ${msg}`);
      // 读改写合并：保留 phase/resources，仅置 error——让重 POST 能从断点续（不重编译）
      const cur = await this.prisma.project
        .findUnique({ where: { id: projectId }, select: { backendRuntime: true } })
        .catch(() => null);
      const br = (cur?.backendRuntime as Record<string, unknown> | null) ?? {};
      await this.prisma.project
        .update({ where: { id: projectId }, data: { backendRuntime: { ...br, kind: 'ruoyi', status: 'error', error: msg.slice(0, 300) } as never } })
        .catch(() => undefined);
      throw e;
    }
  }
}
