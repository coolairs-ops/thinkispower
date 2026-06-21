import { RealBuildStepRunner } from './real-build-step-runner';

describe('RealBuildStepRunner（真实 generate + 测试门）', () => {
  let prisma: any;
  let cloudecode: { generatePageContent: jest.Mock; buildContractNotes: jest.Mock };
  let runner: RealBuildStepRunner;

  const mod = { id: 'm1', name: '门店列表', spec: '门店列表 — 增删改查' };
  const richHtml = '<div data-module-key="store">' + 'x'.repeat(300) + '</div>'; // ≥200 + 有可操作元素

  beforeEach(() => {
    prisma = {
      project: { findUnique: jest.fn().mockResolvedValue({ name: '门店巡检', dataModel: 'model Store{ id String @id }', structuredRequirement: null }) },
      buildModule: { findUnique: jest.fn() },
    };
    cloudecode = { generatePageContent: jest.fn(), buildContractNotes: jest.fn().mockReturnValue('') };
    runner = new RealBuildStepRunner(prisma, cloudecode as never);
  });

  describe('generate', () => {
    it('生成达标内容 → ok，产物含 html/len，并按短项目名+数据模型调用', async () => {
      cloudecode.generatePageContent.mockResolvedValue(richHtml);
      const r = await runner.generate('p1', mod);
      expect(r.ok).toBe(true);
      expect((r.result as any).html).toBe(richHtml);
      expect((r.result as any).len).toBe(richHtml.length);
      expect(cloudecode.generatePageContent).toHaveBeenCalledWith('门店巡检', '门店列表 — 增删改查', 'model Store{ id String @id }', false, '', '');
    });

    it('契约先行：从数据模型+backendRuntime 构契约并传给生成（ADR-0007）', async () => {
      prisma.project.findUnique.mockResolvedValue({
        name: '门店巡检', dataModel: 'model Store{ id String @id }', structuredRequirement: null,
        backendRuntime: { kind: 'ruoyi' },
      });
      cloudecode.buildContractNotes.mockReturnValue('# 数据契约\n- store：id');
      cloudecode.generatePageContent.mockResolvedValue(richHtml);
      await runner.generate('p1', mod);
      expect(cloudecode.buildContractNotes).toHaveBeenCalledWith('model Store{ id String @id }', 'ruoyi');
      expect(cloudecode.generatePageContent.mock.calls[0][5]).toBe('# 数据契约\n- store：id'); // 第6参=契约块
    });

    it('把已采纳设计建议作为设计约束传给生成', async () => {
      prisma.project.findUnique.mockResolvedValue({
        name: '门店巡检',
        dataModel: null,
        structuredRequirement: {
          designSuggestions: [
            { category: 'navigation', title: '底部标签导航', description: '三个主入口', adopted: true },
            { category: 'layout', title: '卡片布局', description: '网格卡片', adopted: false }, // 未采纳，不传
          ],
        },
      });
      cloudecode.generatePageContent.mockResolvedValue(richHtml);
      await runner.generate('p1', mod);
      const notes = cloudecode.generatePageContent.mock.calls[0][4];
      expect(notes).toContain('底部标签导航');
      expect(notes).not.toContain('卡片布局');
    });

    it('生成内容过短 → ok=false（→编排器 blocked）', async () => {
      cloudecode.generatePageContent.mockResolvedValue('<p>太短</p>');
      const r = await runner.generate('p1', mod);
      expect(r.ok).toBe(false);
      expect(r.summary).toContain('过短');
    });

    it('生成调用抛错 → ok=false', async () => {
      cloudecode.generatePageContent.mockRejectedValue(new Error('deepseek down'));
      const r = await runner.generate('p1', mod);
      expect(r.ok).toBe(false);
      expect(r.summary).toContain('deepseek down');
    });
  });

  describe('test（确定性结构门）', () => {
    it('达标长度 + 含 data-module-key → 通过', async () => {
      prisma.buildModule.findUnique.mockResolvedValue({ result: { html: richHtml } });
      const r = await runner.test('p1', mod);
      expect(r.passed).toBe(true);
      expect(r.detail).toMatchObject({ hasAction: true });
    });

    it('够长但无可操作元素（纯介绍）→ 不通过', async () => {
      prisma.buildModule.findUnique.mockResolvedValue({ result: { html: '<div>' + 'x'.repeat(300) + '</div>' } });
      const r = await runner.test('p1', mod);
      expect(r.passed).toBe(false);
      expect(r.detail).toMatchObject({ hasAction: false });
    });

    it('内容过短 → 不通过', async () => {
      prisma.buildModule.findUnique.mockResolvedValue({ result: { html: '<div data-module-key="x">短</div>' } });
      const r = await runner.test('p1', mod);
      expect(r.passed).toBe(false);
    });
  });
});
