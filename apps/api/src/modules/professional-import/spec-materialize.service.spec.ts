import { NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { SpecMaterializeService } from './spec-materialize.service';

describe('SpecMaterializeService', () => {
  let prisma: {
    importBatch: { findUnique: jest.Mock; update: jest.Mock };
    requirementUnderstanding: { findUnique: jest.Mock; update: jest.Mock };
    project: { create: jest.Mock; update: jest.Mock };
    specification: { findUnique: jest.Mock; upsert: jest.Mock };
    requirementQuestion: { count: jest.Mock };
  };
  let statusMapper: { mapProjectStatusToPublicLabel: jest.Mock };
  let llm: { chat: jest.Mock };
  let service: SpecMaterializeService;
  const ctx = { userId: 'u1', orgId: 'org-1' };

  const understanding = {
    positioning: '在线图书商城',
    features: [
      { name: '登录', sources: ['PRD.txt', '补充.md'] },
      { name: '下单', sources: ['PRD.txt'] },
    ],
    pages: [{ name: '首页', sources: ['PRD.txt'] }],
    roles: [{ name: '买家', sources: ['PRD.txt', '补充.md'] }],
  };

  beforeEach(() => {
    prisma = {
      importBatch: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
      requirementUnderstanding: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
      project: {
        create: jest.fn().mockResolvedValue({ id: 'p-new' }),
        update: jest.fn().mockResolvedValue({}),
      },
      specification: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockImplementation(({ create }) => ({ id: 's1', ...create })),
      },
      requirementQuestion: { count: jest.fn().mockResolvedValue(0) },
    };
    statusMapper = { mapProjectStatusToPublicLabel: jest.fn().mockReturnValue('规格已生成，等待确认') };
    // 默认 LLM 不可用 → 走确定性兜底场景，保证多数用例不依赖外呼
    llm = { chat: jest.fn().mockRejectedValue(new Error('llm off')) };
    service = new SpecMaterializeService(prisma as never, statusMapper as never, llm as never);
  });

  it('批次不存在 → NotFound', async () => {
    prisma.importBatch.findUnique.mockResolvedValue(null);
    await expect(service.materializeSpec(ctx, 'b1')).rejects.toThrow(NotFoundException);
  });

  it('跨租户 → Forbidden', async () => {
    prisma.importBatch.findUnique.mockResolvedValue({ id: 'b1', orgId: 'org-2', projectId: null, name: null });
    await expect(service.materializeSpec(ctx, 'b1')).rejects.toThrow(ForbiddenException);
  });

  it('无需求理解 → BadRequest', async () => {
    prisma.importBatch.findUnique.mockResolvedValue({ id: 'b1', orgId: 'org-1', projectId: null, name: null });
    prisma.requirementUnderstanding.findUnique.mockResolvedValue(null);
    await expect(service.materializeSpec(ctx, 'b1')).rejects.toThrow(BadRequestException);
  });

  it('批次无 project → 新建项目(spec_ready) 并回填 batch.projectId', async () => {
    prisma.importBatch.findUnique.mockResolvedValue({ id: 'b1', orgId: 'org-1', projectId: null, name: '图书商城' });
    prisma.requirementUnderstanding.findUnique.mockResolvedValue(understanding);

    const r = await service.materializeSpec(ctx, 'b1');

    expect(prisma.project.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'u1', orgId: 'org-1', name: '图书商城', status: 'spec_ready',
          deliveryOptions: { create: {} },
        }),
      }),
    );
    expect(prisma.importBatch.update).toHaveBeenCalledWith({ where: { id: 'b1' }, data: { projectId: 'p-new' } });
    expect(r.projectId).toBe('p-new');
  });

  it('物化的草稿规格带 provenance(来源资料)', async () => {
    prisma.importBatch.findUnique.mockResolvedValue({ id: 'b1', orgId: 'org-1', projectId: null, name: 'x' });
    prisma.requirementUnderstanding.findUnique.mockResolvedValue(understanding);

    const r = await service.materializeSpec(ctx, 'b1');
    const spec = r.spec as never as {
      status: string;
      coreFunctions: Array<{ name: string; priority: string; provenance: string[] }>;
      pages: Array<{ name: string; provenance: string[] }>;
      roles: Array<{ name: string; provenance: string[] }>;
      targetUsers: Array<{ role: string; provenance: string[] }>;
    };

    expect(spec.status).toBe('draft');
    expect(spec.coreFunctions).toContainEqual(
      expect.objectContaining({ name: '登录', priority: 'must', provenance: ['PRD.txt', '补充.md'] }),
    );
    expect(spec.coreFunctions).toContainEqual(expect.objectContaining({ name: '下单', provenance: ['PRD.txt'] }));
    expect(spec.pages).toContainEqual(expect.objectContaining({ name: '首页', provenance: ['PRD.txt'] }));
    expect(spec.roles).toContainEqual(expect.objectContaining({ name: '买家', provenance: ['PRD.txt', '补充.md'] }));
    expect(spec.targetUsers).toContainEqual(expect.objectContaining({ role: '买家', provenance: ['PRD.txt', '补充.md'] }));
  });

  it('批次已有 project → 复用并置 spec_ready，不新建', async () => {
    prisma.importBatch.findUnique.mockResolvedValue({ id: 'b1', orgId: 'org-1', projectId: 'p-existing', name: 'x' });
    prisma.requirementUnderstanding.findUnique.mockResolvedValue(understanding);

    const r = await service.materializeSpec(ctx, 'b1');

    expect(prisma.project.create).not.toHaveBeenCalled();
    expect(prisma.project.update).toHaveBeenCalledWith({
      where: { id: 'p-existing' },
      data: expect.objectContaining({ status: 'spec_ready', publicStatusLabel: '规格已生成，等待确认' }),
    });
    expect(r.projectId).toBe('p-existing');
  });

  it('物化时写入 planSummary，供下游 demo 生成', async () => {
    prisma.importBatch.findUnique.mockResolvedValue({ id: 'b1', orgId: 'org-1', projectId: null, name: 'x' });
    prisma.requirementUnderstanding.findUnique.mockResolvedValue(understanding);

    await service.materializeSpec(ctx, 'b1');

    const created = prisma.project.create.mock.calls[0][0].data;
    expect(created.planSummary).toEqual(
      expect.objectContaining({
        positioning: '在线图书商城',
        features: [{ name: '登录' }, { name: '下单' }],
        pages: [{ name: '首页' }],
        roles: [{ name: '买家' }],
        source: 'import',
      }),
    );
  });

  it('版本递增：已有 spec 则 version+1', async () => {
    prisma.importBatch.findUnique.mockResolvedValue({ id: 'b1', orgId: 'org-1', projectId: 'p1', name: 'x' });
    prisma.requirementUnderstanding.findUnique.mockResolvedValue(understanding);
    prisma.specification.findUnique.mockResolvedValue({ version: 3 });
    prisma.specification.upsert.mockImplementation(({ update }) => ({ id: 's1', ...update }));

    await service.materializeSpec(ctx, 'b1');
    expect(prisma.specification.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ version: 4, status: 'draft' }) }),
    );
  });

  it('LLM 不可用 → 逐功能生成确定性 GWT 验收场景(带 coverage/provenance)', async () => {
    prisma.importBatch.findUnique.mockResolvedValue({ id: 'b1', orgId: 'org-1', projectId: 'p1', name: 'x' });
    prisma.requirementUnderstanding.findUnique.mockResolvedValue(understanding);

    const r = await service.materializeSpec(ctx, 'b1');
    const scenarios = (r.spec as never as { acceptanceScenarios: any[] }).acceptanceScenarios;

    expect(scenarios.length).toBe(2); // 登录 / 下单
    expect(scenarios).toContainEqual(
      expect.objectContaining({
        name: '登录 验收',
        priority: 'must',
        coverage: ['登录'],
        provenance: ['PRD.txt', '补充.md'],
      }),
    );
    const login = scenarios.find((s) => s.coverage.includes('登录'));
    expect(login.given).toBeTruthy();
    expect(login.when).toBeTruthy();
    expect(login.then).toBeTruthy();
  });

  it('LLM 生成场景 → 按 coverage 命中功能补齐 provenance，丢弃无关功能', async () => {
    prisma.importBatch.findUnique.mockResolvedValue({ id: 'b1', orgId: 'org-1', projectId: 'p1', name: 'x' });
    prisma.requirementUnderstanding.findUnique.mockResolvedValue(understanding);
    llm.chat.mockResolvedValue(
      JSON.stringify({
        scenarios: [
          { name: '成功登录', given: '已注册', when: '输入正确密码', then: '进入首页', priority: 'must', coverage: ['登录'] },
          { name: '密码错误', given: '已注册', when: '输入错误密码', then: '提示错误', priority: 'nice', coverage: ['登录', '不存在的功能'] },
        ],
      }),
    );

    const r = await service.materializeSpec(ctx, 'b1');
    const scenarios = (r.spec as never as { acceptanceScenarios: any[] }).acceptanceScenarios;

    expect(scenarios.length).toBe(2);
    expect(scenarios[0]).toEqual(
      expect.objectContaining({ name: '成功登录', then: '进入首页', coverage: ['登录'], provenance: ['PRD.txt', '补充.md'] }),
    );
    // coverage 过滤掉「不存在的功能」，只保留命中的「登录」
    expect(scenarios[1].coverage).toEqual(['登录']);
    expect(scenarios[1].priority).toBe('nice');
  });

  it('物化后 understanding 与 batch 推进到 confirmed', async () => {
    prisma.importBatch.findUnique.mockResolvedValue({ id: 'b1', orgId: 'org-1', projectId: 'p1', name: 'x' });
    prisma.requirementUnderstanding.findUnique.mockResolvedValue(understanding);

    await service.materializeSpec(ctx, 'b1');

    expect(prisma.requirementUnderstanding.update).toHaveBeenCalledWith({
      where: { batchId: 'b1' }, data: { status: 'confirmed' },
    });
    expect(prisma.importBatch.update).toHaveBeenCalledWith({
      where: { id: 'b1' }, data: { status: 'confirmed' },
    });
  });

  it('存在未解决高冲突 → 拒绝物化(BadRequest)', async () => {
    prisma.importBatch.findUnique.mockResolvedValue({ id: 'b1', orgId: 'org-1', projectId: 'p1', name: 'x' });
    prisma.requirementUnderstanding.findUnique.mockResolvedValue(understanding);
    prisma.requirementQuestion.count.mockResolvedValue(2); // 2 项未解决高冲突

    await expect(service.materializeSpec(ctx, 'b1')).rejects.toThrow(BadRequestException);
    expect(prisma.specification.upsert).not.toHaveBeenCalled();
  });
});
