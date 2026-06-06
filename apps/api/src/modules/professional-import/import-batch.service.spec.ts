import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { ImportBatchService } from './import-batch.service';

describe('ImportBatchService', () => {
  let prisma: {
    importBatch: { create: jest.Mock; findMany: jest.Mock; findUnique: jest.Mock };
  };
  let service: ImportBatchService;
  const ctx = { userId: 'u1', orgId: 'org-1' };

  beforeEach(() => {
    prisma = {
      importBatch: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() },
    };
    service = new ImportBatchService(prisma as never);
  });

  it('create 设置当前租户 orgId 与初始状态 uploading', async () => {
    prisma.importBatch.create.mockResolvedValue({ id: 'b1' });
    await service.create(ctx, { name: '一批资料' });
    expect(prisma.importBatch.create).toHaveBeenCalledWith({
      data: { orgId: 'org-1', projectId: null, name: '一批资料', status: 'uploading' },
    });
  });

  it('list 按 org 作用域查询(租户隔离)', async () => {
    prisma.importBatch.findMany.mockResolvedValue([]);
    await service.list(ctx);
    expect(prisma.importBatch.findMany).toHaveBeenCalledWith({
      where: { orgId: 'org-1' },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('get 批次不存在 → NotFound', async () => {
    prisma.importBatch.findUnique.mockResolvedValue(null);
    await expect(service.get(ctx, 'x')).rejects.toThrow(NotFoundException);
  });

  it('get 跨租户访问 → Forbidden', async () => {
    prisma.importBatch.findUnique.mockResolvedValue({ id: 'b1', orgId: 'org-2' });
    await expect(service.get(ctx, 'b1')).rejects.toThrow(ForbiddenException);
  });

  it('get 同租户 → 返回批次', async () => {
    const batch = { id: 'b1', orgId: 'org-1', assets: [], understanding: null };
    prisma.importBatch.findUnique.mockResolvedValue(batch);
    expect(await service.get(ctx, 'b1')).toBe(batch);
  });

  it('list 无租户上下文 → 拒绝(防无作用域全表查询)', async () => {
    await expect(service.list({ userId: 'u1', orgId: null })).rejects.toThrow(ForbiddenException);
  });
});
