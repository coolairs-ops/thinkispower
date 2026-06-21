import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AppSpec } from './app-spec.types';
import { ProvisionResult, ProvisionPhase } from './backend-runtime.interface';
import { RuoyiClient } from './ruoyi-client.service';
import { RuoyiRuntime, RuoyiProvisionInfra, ProvisionCheckpoint } from './ruoyi-runtime.service';
import { RuoyiMysqlDdlDriver } from './ruoyi-mysql-ddl.driver';
import { RuoyiLocalDeployer } from './ruoyi-local-deployer';
import { loadRuoyiInstanceConfig, RuoyiInstanceConfig } from './ruoyi-provision.config';

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
  ) {
    this.cfg = loadRuoyiInstanceConfig();
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
    const result = await this.runtime.provisionApp(projectId, spec, this.cfg.client, infra, checkpoint);
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
