import { NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { ImportUnderstandingService } from './import-understanding.service';

describe('ImportUnderstandingService', () => {
  let prisma: {
    importBatch: { findUnique: jest.Mock; update: jest.Mock };
    requirementUnderstanding: { upsert: jest.Mock };
    requirementQuestion: { deleteMany: jest.Mock; createMany: jest.Mock };
  };
  let conflictDetection: { detect: jest.Mock };
  let service: ImportUnderstandingService;
  const ctx = { userId: 'u1', orgId: 'org-1' };

  beforeEach(() => {
    prisma = {
      importBatch: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
      requirementUnderstanding: { upsert: jest.fn().mockImplementation(({ create, update }) => ({ id: 'u1', ...(create ?? update) })) },
      requirementQuestion: { deleteMany: jest.fn().mockResolvedValue({}), createMany: jest.fn().mockResolvedValue({}) },
    };
    conflictDetection = { detect: jest.fn().mockResolvedValue([]) };
    service = new ImportUnderstandingService(prisma as never, conflictDetection as never);
  });

  const asset = (fileName: string, s: unknown) => ({ fileName, parseSummary: s });

  it('批次不存在 → NotFound', async () => {
    prisma.importBatch.findUnique.mockResolvedValue(null);
    await expect(service.summarize(ctx, 'b1')).rejects.toThrow(NotFoundException);
  });

  it('跨租户 → Forbidden', async () => {
    prisma.importBatch.findUnique.mockResolvedValue({ id: 'b1', orgId: 'org-2', assets: [] });
    await expect(service.summarize(ctx, 'b1')).rejects.toThrow(ForbiddenException);
  });

  it('空批次 → BadRequest', async () => {
    prisma.importBatch.findUnique.mockResolvedValue({ id: 'b1', orgId: 'org-1', assets: [] });
    await expect(service.summarize(ctx, 'b1')).rejects.toThrow(BadRequestException);
  });

  it('合并去重 + 溯源：同名功能累积来源文件', async () => {
    prisma.importBatch.findUnique.mockResolvedValue({
      id: 'b1', orgId: 'org-1',
      assets: [
        asset('PRD.txt', { status: 'parsed', summary: '电商系统', features: ['登录', '下单'], pages: ['首页'], roles: ['买家'] }),
        asset('补充.md', { status: 'parsed', summary: '补充说明', features: ['登录', '退款'], pages: [], roles: ['买家', '客服'] }),
        asset('截图.png', { status: 'skipped', reason: '图片' }),
      ],
    });

    const u = await service.summarize(ctx, 'b1');

    // 登录出现在两份资料 → sources 两个；退款只在一份
    expect(u.features).toContainEqual({ name: '登录', sources: ['PRD.txt', '补充.md'] });
    expect(u.features).toContainEqual({ name: '下单', sources: ['PRD.txt'] });
    expect(u.features).toContainEqual({ name: '退款', sources: ['补充.md'] });
    expect(u.roles).toContainEqual({ name: '买家', sources: ['PRD.txt', '补充.md'] });
    expect(u.roles).toContainEqual({ name: '客服', sources: ['补充.md'] });
    expect(u.positioning).toBe('电商系统；补充说明');
  });

  it('置信度 = 已理解份数 / 总份数(skipped/error 拉低)', async () => {
    prisma.importBatch.findUnique.mockResolvedValue({
      id: 'b1', orgId: 'org-1',
      assets: [
        asset('a.txt', { status: 'parsed', features: ['x'] }),
        asset('b.png', { status: 'skipped' }),
        asset('c.pdf', { status: 'skipped' }),
        asset('d.txt', { status: 'error' }),
      ],
    });
    const u = await service.summarize(ctx, 'b1');
    expect(u.confidenceScore).toBe(0.25);
  });

  it('落库 status=draft、批次推进 ready_for_review', async () => {
    prisma.importBatch.findUnique.mockResolvedValue({
      id: 'b1', orgId: 'org-1',
      assets: [asset('a.txt', { status: 'parsed', features: ['x'] })],
    });

    const u = await service.summarize(ctx, 'b1');

    expect(u.status).toBe('draft');
    expect(prisma.requirementUnderstanding.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { batchId: 'b1' } }),
    );
    expect(prisma.importBatch.update).toHaveBeenCalledWith({
      where: { id: 'b1' },
      data: { status: 'ready_for_review' },
    });
  });

  it('汇总建议补充(suggestions)并去重', async () => {
    prisma.importBatch.findUnique.mockResolvedValue({
      id: 'b1', orgId: 'org-1',
      assets: [
        asset('a.txt', { status: 'parsed', features: ['x'], suggestions: ['未明确角色权限分级', '缺少异常处理流程'] }),
        asset('b.txt', { status: 'parsed', features: ['y'], suggestions: ['未明确角色权限分级', '缺少数据保留策略'] }),
      ],
    });

    const u = await service.summarize(ctx, 'b1') as { suggestions: string[] };

    expect(u.suggestions).toEqual(
      expect.arrayContaining(['未明确角色权限分级', '缺少异常处理流程', '缺少数据保留策略']),
    );
    expect(u.suggestions.length).toBe(3); // 跨份去重
  });

  it('检测到冲突 → 落 conflicts 并为 high/medium 生成待确认问题(low 不生成)', async () => {
    prisma.importBatch.findUnique.mockResolvedValue({
      id: 'b1', orgId: 'org-1',
      assets: [
        asset('PRD.txt', { status: 'parsed', features: ['游客可下单'] }),
        asset('补充.md', { status: 'parsed', features: ['下单需登录'] }),
      ],
    });
    conflictDetection.detect.mockResolvedValue([
      { topic: '下单是否需登录', kind: 'contradiction', severity: 'high', statements: [{ source: 'PRD.txt', claim: '游客可下单' }], suggestion: '确认' },
      { topic: '措辞', kind: 'inconsistency', severity: 'low', statements: [], suggestion: '' },
    ]);

    const u = await service.summarize(ctx, 'b1') as unknown as { conflicts: unknown[] };

    expect(u.conflicts).toHaveLength(2); // 全部落库
    expect(prisma.requirementQuestion.deleteMany).toHaveBeenCalledWith({
      where: { understandingId: 'u1', resolved: false },
    });
    // 仅 high/medium 生成问题(low 排除)
    const created = prisma.requirementQuestion.createMany.mock.calls[0][0].data;
    expect(created).toHaveLength(1);
    expect(created[0]).toEqual(expect.objectContaining({ understandingId: 'u1', severity: 'high' }));
    expect(created[0].question).toContain('下单是否需登录');
  });

  it('无冲突 → 不创建问题(仍清理旧未解决问题)', async () => {
    prisma.importBatch.findUnique.mockResolvedValue({
      id: 'b1', orgId: 'org-1',
      assets: [asset('a.txt', { status: 'parsed', features: ['x'] })],
    });
    await service.summarize(ctx, 'b1');
    expect(prisma.requirementQuestion.deleteMany).toHaveBeenCalled();
    expect(prisma.requirementQuestion.createMany).not.toHaveBeenCalled();
  });
});
