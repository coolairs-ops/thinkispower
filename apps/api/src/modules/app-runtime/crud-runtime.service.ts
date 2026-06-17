import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { SchemaMigrationService } from './schema-migration.service';
import {
  BackendRuntime,
  BackendRuntimeDescriptor,
  BackendHealth,
  ProvisionResult,
} from './backend-runtime.interface';

/**
 * 固定通用 CRUD 运行时（路 B 的 BackendRuntime 实现）。
 * 确定性、零 LLM 代码：置备=受控建表，健康=逐资源连通自检，拆除=删 schema。
 * 路 C 将以"生成代码容器"换绑 BACKEND_RUNTIME，本类与契约不变。
 */
@Injectable()
export class CrudRuntime implements BackendRuntime {
  readonly kind = 'crud' as const;
  private readonly logger = new Logger(CrudRuntime.name);
  private static readonly IDENT = /^[A-Za-z][A-Za-z0-9_]*$/;

  constructor(
    private prisma: PrismaService,
    private schemaMigration: SchemaMigrationService,
  ) {}

  async provision(projectId: string, dataModel: string): Promise<ProvisionResult> {
    const { schemaName, resources } = await this.schemaMigration.provision(projectId, dataModel);
    const descriptor: BackendRuntimeDescriptor = {
      kind: 'crud',
      schemaName,
      resources,
      status: 'ready',
      provisionedAt: new Date().toISOString(),
    };
    await this.prisma.project.update({
      where: { id: projectId },
      data: { backendRuntime: descriptor as never },
    });
    this.logger.log(`项目 ${projectId} 后端置备就绪: ${resources.join(', ')}`);
    return { descriptor };
  }

  async health(_projectId: string, descriptor: BackendRuntimeDescriptor): Promise<BackendHealth> {
    if (!CrudRuntime.IDENT.test(descriptor.schemaName)) throw new BadRequestException('后端配置异常');
    const resources: BackendHealth['resources'] = [];
    let healthy = true;
    for (const r of descriptor.resources) {
      if (!CrudRuntime.IDENT.test(r)) { healthy = false; resources.push({ name: r, reachable: false, detail: '非法资源名' }); continue; }
      try {
        await this.prisma.$queryRawUnsafe(`SELECT 1 FROM "${descriptor.schemaName}"."${r}" LIMIT 1`);
        resources.push({ name: r, reachable: true });
      } catch (e) {
        healthy = false;
        resources.push({ name: r, reachable: false, detail: e instanceof Error ? e.message : String(e) });
      }
    }
    return { healthy, resources };
  }

  async teardown(projectId: string, descriptor: BackendRuntimeDescriptor): Promise<void> {
    if (!CrudRuntime.IDENT.test(descriptor.schemaName)) throw new BadRequestException('后端配置异常');
    await this.prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${descriptor.schemaName}" CASCADE`);
    await this.prisma.project.update({
      where: { id: projectId },
      data: { backendRuntime: Prisma.DbNull },
    });
    this.logger.log(`项目 ${projectId} 后端已拆除`);
  }
}
