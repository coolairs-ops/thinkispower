import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { assertOrgAccess, orgScope, TenantContext } from '../../common/utils/tenant-scope';

/**
 * 导入批次生命周期（P15-2 第 1 步）。
 *
 * 新功能从一开始就走 org 作用域（tenant-scope helper），天生租户隔离。
 * 导入生命周期挂 ImportBatch，不污染 Project.status。
 */
@Injectable()
export class ImportBatchService {
  constructor(private prisma: PrismaService) {}

  /** 创建导入批次（归属当前租户） */
  async create(ctx: TenantContext, data: { name?: string; projectId?: string }) {
    return this.prisma.importBatch.create({
      data: {
        orgId: ctx.orgId,
        projectId: data.projectId ?? null,
        name: data.name ?? null,
        status: 'uploading',
      },
    });
  }

  /** 列出当前租户的导入批次 */
  async list(ctx: TenantContext) {
    return this.prisma.importBatch.findMany({
      where: orgScope(ctx.orgId),
      orderBy: { createdAt: 'desc' },
    });
  }

  /** 批次详情（校验租户归属） */
  async get(ctx: TenantContext, batchId: string) {
    const batch = await this.prisma.importBatch.findUnique({
      where: { id: batchId },
      include: {
        assets: true,
        understanding: { include: { questions: { orderBy: [{ resolved: 'asc' }, { createdAt: 'asc' }] } } },
      },
    });
    if (!batch) throw new NotFoundException('导入批次不存在');
    assertOrgAccess(batch.orgId, ctx.orgId, { allowLegacyNull: true });
    return batch;
  }
}
