import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AppSpec } from './app-spec.types';
import { ProvisionResult } from './backend-runtime.interface';
import { RuoyiClient } from './ruoyi-client.service';
import { RuoyiRuntime, RuoyiProvisionInfra } from './ruoyi-runtime.service';
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
    const infra: RuoyiProvisionInfra = {
      applyDdl: (stmts) => new RuoyiMysqlDdlDriver(this.cfg.mysql).applyDdl(stmts),
      deployTables: (rcfg, tables) => new RuoyiLocalDeployer(this.client, this.cfg.deploy).deployTables(rcfg, tables),
    };
    this.logger.log(`若依 provision 开始 project=${projectId} 实体=${spec.entities.length} 角色=${spec.roles?.length ?? 0}`);
    const result = await this.runtime.provisionApp(projectId, spec, this.cfg.client, infra);
    await this.prisma.project.update({
      where: { id: projectId },
      data: { backendRuntime: result.descriptor as never },
    });
    this.logger.log(`若依 provision 完成 project=${projectId} 资源=[${result.descriptor.resources.join(',')}]`);
    return result;
  }
}
