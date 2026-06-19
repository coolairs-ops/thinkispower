import { BuildDemoService } from './build-demo.service';

describe('BuildDemoService', () => {
  let prisma: any;
  let cloudecode: any;
  let svc: BuildDemoService;

  beforeEach(() => {
    prisma = {
      project: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
      buildModule: { findMany: jest.fn() },
    };
    cloudecode = {
      injectAppDataClient: jest.fn((html: string) => html + '<!--appData-->'),
      injectAnnotationSupport: jest.fn((html: string) => html + '<!--annot-->'),
    };
    svc = new BuildDemoService(prisma, {} as never, cloudecode);
  });

  describe('pageItems（从 planSummary 自动分解模块）', () => {
    it('长"标签—描述"取短名作 name、原文作 brief；7 页在放开后的上限(默认20)内全保留', () => {
      const r = svc.pageItems({ pages: ['门店管理 — 客户列表及详情', '路径规划 — 拖拽调整', 'a', 'b', 'c', 'd', 'e'] });
      expect(r).toHaveLength(7); // 上限放开(DEMO_MAX_PAGES 默认20)，7 页不再被砍到 6
      expect(r[0]).toEqual({ name: '门店管理', brief: '门店管理 — 客户列表及详情' });
    });

    it('超出默认上限(DEMO_MAX_PAGES 未设=20)截断到 20', () => {
      const pages = Array.from({ length: 40 }, (_, i) => `页${i + 1}`);
      expect(svc.pageItems({ pages })).toHaveLength(20);
    });

    it('pages 是 {name} 对象也支持；空则给默认两页', () => {
      expect(svc.pageItems({ pages: [{ name: '看板' }] })[0]).toMatchObject({ name: '看板' });
      expect(svc.pageItems({}).map((m) => m.name)).toEqual(['总览', '列表']);
    });
  });

  describe('assemble（拼装 done 模块产物成 demoHtml）', () => {
    it('外壳 + 各模块 html 拼入 + 注入 appData/批注，存库', async () => {
      prisma.project.findUnique.mockResolvedValue({ name: '门店巡检' });
      prisma.buildModule.findMany.mockResolvedValue([
        { name: '总览', orderIdx: 0, result: { html: '<div data-module-key="ov">总览界面</div>' } },
        { name: '门店', orderIdx: 1, result: { html: '<div data-module-key="st">门店界面</div>' } },
      ]);

      const r = await svc.assemble('p1');
      expect(r.pages).toBe(2);
      expect(r.bytes).toBeGreaterThan(0);

      const saved = prisma.project.update.mock.calls[0][0].data.demoHtml as string;
      expect(saved).toContain("navigate('p0')");  // 外壳菜单
      expect(saved).toContain('总览界面');         // 模块产物拼入
      expect(saved).toContain('门店界面');
      expect(saved).not.toContain('<!--TIP_PAGE:'); // 插槽全替换
      expect(saved).toContain('<!--appData-->');    // 注入 appData
      expect(saved).toContain('<!--annot-->');      // 注入批注
      expect(prisma.project.update.mock.calls[0][0].data.status).toBe('demo_ready');
    });

    it('无 done 模块 → 不写库，返回 0', async () => {
      prisma.project.findUnique.mockResolvedValue({ name: 'x' });
      prisma.buildModule.findMany.mockResolvedValue([]);
      const r = await svc.assemble('p1');
      expect(r).toEqual({ pages: 0, bytes: 0 });
      expect(prisma.project.update).not.toHaveBeenCalled();
    });
  });
});
