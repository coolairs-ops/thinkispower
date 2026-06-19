import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PostBuildCritiqueService } from './post-build-critique.service';

describe('PostBuildCritiqueService（后置遍 · 升级E）', () => {
  let prisma: any;
  let svc: PostBuildCritiqueService;

  const setup = (opts: { planPages?: any[]; modules?: any[]; userId?: string } = {}) => {
    prisma = {
      project: {
        findUnique: jest.fn().mockResolvedValue({
          userId: opts.userId ?? 'u1',
          planSummary: { pages: opts.planPages ?? [] },
        }),
      },
      buildModule: { findMany: jest.fn().mockResolvedValue(opts.modules ?? []) },
      buildJournalEntry: { create: jest.fn().mockResolvedValue({}) },
    };
    svc = new PostBuildCritiqueService(prisma as never);
  };

  it('blocked 模块 → 后置缺口，含测试门失败原因，可重建', async () => {
    setup({ modules: [{ name: '看板', status: 'blocked', result: { failedPhase: 'test', detail: { len: 800, hasAction: false } } }] });
    const r = await svc.critique('u1', 'p1');
    expect(r.gaps).toHaveLength(1);
    expect(r.gaps[0]).toMatchObject({ kind: 'blocked', moduleName: '看板', rebuildable: true });
    expect(r.gaps[0].issue).toContain('缺少可操作元素');
  });

  it('done 且产物正常 → 不产生缺口', async () => {
    setup({ modules: [{ name: '列表', status: 'done', result: { html: '<div data-module-key="x">' + 'x'.repeat(300) + '</div>' } }] });
    const r = await svc.critique('u1', 'p1');
    expect(r.gaps).toHaveLength(0);
  });

  it('done 但内容为空/占位 → empty 缺口', async () => {
    setup({ modules: [{ name: '设置', status: 'done', result: { html: '<div class="alert">「设置」暂无内容</div>' } }] });
    const r = await svc.critique('u1', 'p1');
    expect(r.gaps.map((g) => g.kind)).toEqual(['empty']);
  });

  it('pending/中断模块 → pending 缺口', async () => {
    setup({ modules: [{ name: '报表', status: 'pending', result: null }] });
    const r = await svc.critique('u1', 'p1');
    expect(r.gaps[0]).toMatchObject({ kind: 'pending', rebuildable: true });
  });

  it('需求页面多于建造模块 → 显式报覆盖缺口（不静默截断）', async () => {
    setup({
      planPages: ['总览', '门店', '巡检', '报表', '审批', '设置', '权限', '日志'], // 8 页
      modules: [
        { name: '总览', status: 'done', result: { html: '<div data-module-key="x">' + 'x'.repeat(300) + '</div>' } },
        { name: '门店', status: 'done', result: { html: '<div data-module-key="x">' + 'x'.repeat(300) + '</div>' } },
      ], // 只建了 2 个
    });
    const r = await svc.critique('u1', 'p1');
    const uncovered = r.gaps.filter((g) => g.kind === 'uncovered-page').map((g) => g.moduleName);
    expect(uncovered).toEqual(['巡检', '报表', '审批', '设置', '权限', '日志']);
    expect(r.gaps.every((g) => g.kind !== 'uncovered-page' || g.rebuildable === false)).toBe(true);
  });

  it('写一条 critique 建造日志', async () => {
    setup({ modules: [{ name: '看板', status: 'blocked', result: { failedPhase: 'generate' } }] });
    await svc.critique('u1', 'p1');
    expect(prisma.buildJournalEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ phase: 'critique' }) }),
    );
  });

  it('ownership：非属主拒绝，不读模块', async () => {
    setup({ userId: 'owner' });
    await expect(svc.critique('intruder', 'p1')).rejects.toThrow(ForbiddenException);
    expect(prisma.buildModule.findMany).not.toHaveBeenCalled();
  });

  it('项目不存在 → NotFound', async () => {
    setup();
    prisma.project.findUnique.mockResolvedValue(null);
    await expect(svc.critique('u1', 'missing')).rejects.toThrow(NotFoundException);
  });
});
