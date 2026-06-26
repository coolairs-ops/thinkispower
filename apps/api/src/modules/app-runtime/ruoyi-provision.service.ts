import { Injectable, Logger, BadRequestException, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../database/prisma.service';
import { DeepseekService } from '../../services/deepseek.service';
import { generateConsoleLabels } from './ruoyi-label-gen';
import { AppSpec } from './app-spec.types';
import { ProvisionResult, ProvisionPhase } from './backend-runtime.interface';
import { RuoyiClient } from './ruoyi-client.service';
import { RuoyiRuntime, RuoyiProvisionInfra, ProvisionCheckpoint } from './ruoyi-runtime.service';
import { RuoyiMysqlDdlDriver } from './ruoyi-mysql-ddl.driver';
import { RuoyiLocalDeployer } from './ruoyi-local-deployer';
import { loadRuoyiInstanceConfig, RuoyiInstanceConfig } from './ruoyi-provision.config';
import { AppSpecAssemblerService } from './app-spec-assembler.service';
import { RUOYI_PROVISION_QUEUE, RUOYI_PROVISION_JOB } from './ruoyi-provision.queue';

/**
 * 若依全自动 provision 服务（私有化档）。
 *
 * 把两个真 infra 驱动（MySQL 建表 + 本地部署）接进 RuoyiRuntime.provisionApp，串成无人工的置备：
 *   建表 → importTable+下载源码 → 写工程 → 单模块编译 → 重启 → seed RBAC → 持久 descriptor。
 * 实例配置来自 env（loadRuoyiInstanceConfig）；未配置则拒绝（不乱跑）。
 * 长任务（含 ~分钟级编译/重启），由 RuoyiProvisionProcessor 入队后台跑，不阻塞请求。
 */
@Injectable()
export class RuoyiProvisionService {
  private readonly logger = new Logger(RuoyiProvisionService.name);
  private readonly cfg: RuoyiInstanceConfig;

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: RuoyiClient,
    private readonly runtime: RuoyiRuntime,
    private readonly assembler: AppSpecAssemblerService,
    @InjectQueue(RUOYI_PROVISION_QUEUE) private readonly queue: Queue,
    @Optional() private readonly deepseek?: DeepseekService,
  ) {
    this.cfg = loadRuoyiInstanceConfig();
  }

  /**
   * 确保若依后端已置备（ADR-0005 接线：交付/迭代流程据此自动触发置备，不再手动去 deploy 页）。
   * 幂等：未配实例/非若依项目/已就绪/置备中 → 不重复触发（除非 force）。否则装配 spec + 标 provisioning + 入队。
   * 长任务由 processor 后台跑，本方法只触发不阻塞。force=true 用于显式 opt-in 端点（总是重置重跑）。
   */
  async ensureProvisioned(
    projectId: string,
    opts: { userId?: string; spec?: AppSpec; force?: boolean } = {},
  ): Promise<{ triggered: boolean; status: string; jobId?: string; resources?: string[] }> {
    if (!this.cfg.enabled) return { triggered: false, status: 'disabled' };
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { userId: true, backendRuntime: true } });
    if (!project) return { triggered: false, status: 'no-project' };
    const be = project.backendRuntime as { kind?: string; status?: string; phase?: ProvisionPhase } | null;
    if (!opts.force) {
      // 自动场景：只对"已选若依"的项目动作；已就绪/置备中不重复触发
      if (be?.kind !== 'ruoyi') return { triggered: false, status: 'not-ruoyi' };
      if (be?.status === 'ready') return { triggered: false, status: 'ready' };
      if (be?.status === 'provisioning') return { triggered: false, status: 'provisioning' };
    }
    const spec = opts.spec?.entities?.length ? opts.spec : await this.assembler.fromProject(opts.userId ?? project.userId, projectId);
    if (!spec.entities.length) return { triggered: false, status: 'no-entities' };
    const resources = spec.entities.map((e) => e.table);
    const priorPhase = be?.phase; // 续跑相位保留（重 POST 重置 provisioning 时不丢断点）
    await this.prisma.project.update({
      where: { id: projectId },
      data: { backendRuntime: { kind: 'ruoyi', status: 'provisioning', resources, schemaName: '', provisionedAt: null, ...(priorPhase ? { phase: priorPhase } : {}) } as never },
    });
    const job = await this.queue.add(RUOYI_PROVISION_JOB, { projectId, spec }, { attempts: 1, removeOnComplete: 20, removeOnFail: 50 });
    this.logger.log(`ensureProvisioned project=${projectId} → 入队若依置备 job=${job.id} 资源=[${resources.join(',')}]`);
    return { triggered: true, status: 'provisioning', jobId: String(job.id), resources };
  }

  /**
   * 指定/取消项目用若依底座（方案页开关，ADR-0005 第2层"显式意图"）。
   * use=true：标 backendRuntime={kind:ruoyi,status:pending}（仅"已选"未置备）→ 交付时 ensureProvisioned 自动置备、
   *   迭代立即按若依契约收敛、serve 未就绪前仍走路B。已是若依(可能已置备)则不动。
   * use=false：仅当还停在 pending(未真置备)才清回路B；已 provisioning/ready 不擅自抹除。
   * 纯意图，不校验实例是否配置（置备时 ensureProvisioned 再 gate）。
   */
  async designate(projectId: string, use: boolean): Promise<{ desiredBackend: 'ruoyi' | 'crud'; status?: string }> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { backendRuntime: true } });
    const be = project?.backendRuntime as { kind?: string; status?: string } | null;
    if (use) {
      if (be?.kind === 'ruoyi') return { desiredBackend: 'ruoyi', status: be.status }; // 已选/已置备，幂等不动
      await this.prisma.project.update({
        where: { id: projectId },
        data: { backendRuntime: { kind: 'ruoyi', status: 'pending', resources: [], schemaName: '', provisionedAt: null } as never },
      });
      this.logger.log(`designate project=${projectId} → 指定若依底座(pending)`);
      return { desiredBackend: 'ruoyi', status: 'pending' };
    }
    if (be?.kind === 'ruoyi' && be?.status !== 'pending') return { desiredBackend: 'ruoyi', status: be.status }; // 已置备/置备中，不静默清
    await this.prisma.project.update({ where: { id: projectId }, data: { backendRuntime: null as never } });
    return { desiredBackend: 'crud' };
  }

  get enabled(): boolean {
    return this.cfg.enabled;
  }

  /** 全自动置备一个项目的若依 App，持久 descriptor 到 project.backendRuntime。 */
  async provision(projectId: string, spec: AppSpec): Promise<ProvisionResult> {
    if (!this.cfg.enabled) {
      throw new BadRequestException('未接入若依实例（缺 RUOYI_BASE_URL/RUOYI_SRC_ROOT）');
    }
    const deployer = new RuoyiLocalDeployer(this.client, this.cfg.deploy);
    const infra: RuoyiProvisionInfra = {
      applyDdl: (stmts) => new RuoyiMysqlDdlDriver(this.cfg.mysql).applyDdl(stmts),
      deploySources: (rcfg, tables) => deployer.deploySources(rcfg, tables),
      waitReady: () => deployer.waitReady(),
    };
    const checkpoint = this.makeCheckpoint(projectId);
    this.logger.log(`若依 provision 开始 project=${projectId} 实体=${spec.entities.length} 角色=${spec.roles?.length ?? 0}`);
    // ADR-0012 ①：LLM 生成中文标签（functionName/字段注释）→ 喂 codegen，控制台页/弹窗/列头自动中文。失败回退英文。
    const labels = await generateConsoleLabels(this.deepseek, spec.entities);
    const result = await this.runtime.provisionApp(projectId, spec, this.cfg.client, infra, checkpoint, labels);
    await this.prisma.project.update({
      where: { id: projectId },
      data: { backendRuntime: result.descriptor as never }, // 终态 descriptor 不带 phase（清空续跑标记）
    });
    this.logger.log(`若依 provision 完成 project=${projectId} 资源=[${result.descriptor.resources.join(',')}]`);
    return result;
  }

  /**
   * 断点续跑 checkpoint：相位读写 project.backendRuntime.phase。
   * save 用读改写合并——只动 phase，保留 status/resources 等（与 controller 的 provisioning / processor 的 error 共存）。
   */
  private makeCheckpoint(projectId: string): ProvisionCheckpoint {
    const read = async () => {
      const p = await this.prisma.project.findUnique({ where: { id: projectId }, select: { backendRuntime: true } });
      return (p?.backendRuntime as Record<string, unknown> | null) ?? null;
    };
    return {
      load: async () => ((await read())?.phase as ProvisionPhase | undefined) ?? 'none',
      save: async (phase) => {
        const br = (await read()) ?? { kind: 'ruoyi', status: 'provisioning' };
        await this.prisma.project.update({ where: { id: projectId }, data: { backendRuntime: { ...br, phase } as never } });
      },
    };
  }
}
