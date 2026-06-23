import { ForbiddenException } from '@nestjs/common';
import { RequirementCompletionService } from './requirement-completion.service';

describe('RequirementCompletionService（IR 完备性批判 · 升级A）', () => {
  let prisma: any;
  let deepseek: { chat: jest.Mock };
  let svc: RequirementCompletionService;

  const project = {
    userId: 'u1',
    name: '门店巡检',
    structuredRequirement: { prd: { summary: 'x', pages: ['门店列表'], roles: ['销售'] } },
  };

  beforeEach(() => {
    prisma = {
      project: { findUnique: jest.fn().mockResolvedValue(project), update: jest.fn().mockResolvedValue({}) },
      specification: { findUnique: jest.fn().mockResolvedValue(null), update: jest.fn().mockResolvedValue({}) },
    };
    deepseek = { chat: jest.fn() };
    svc = new RequirementCompletionService(prisma as never, deepseek as never);
  });

  it('调模型找整块缺口，解析并存到 structuredRequirement.completenessGaps', async () => {
    deepseek.chat.mockResolvedValue('```json\n[{"kind":"flow","missing":"对账流程","why":"门店巡检通常要对账","source":"uncovered-dimension"}]\n```');
    const r = await svc.analyze('u1', null, 'p1');
    expect(r.gaps).toHaveLength(1);
    expect(r.gaps[0]).toMatchObject({ kind: 'flow', missing: '对账流程' });
    // 存库到 completenessGaps
    const saved = prisma.project.update.mock.calls[0][0].data.structuredRequirement;
    expect(saved.completenessGaps).toHaveLength(1);
    expect(saved.prd.pages).toEqual(['门店列表']); // 原 prd 保留
  });

  it('模型输出非法 JSON → 降级为空，不崩', async () => {
    deepseek.chat.mockResolvedValue('抱歉我无法回答');
    const r = await svc.analyze('u1', null, 'p1');
    expect(r.gaps).toEqual([]);
    expect(prisma.project.update).toHaveBeenCalled(); // 仍存空数组
  });

  it('过滤无 missing 字段的脏项，上限 30', async () => {
    deepseek.chat.mockResolvedValue('[{"kind":"entity","missing":"跟进记录"},{"kind":"entity"},{"foo":1}]');
    const r = await svc.analyze('u1', null, 'p1');
    expect(r.gaps).toHaveLength(1);
    expect(r.gaps[0].missing).toBe('跟进记录');
  });

  it('ownership：非属主拒绝', async () => {
    await expect(svc.analyze('other', null, 'p1')).rejects.toThrow(ForbiddenException);
    expect(deepseek.chat).not.toHaveBeenCalled();
  });

  it('get 返回已存缺口，不再调模型', async () => {
    prisma.project.findUnique.mockResolvedValue({
      ...project,
      structuredRequirement: { ...project.structuredRequirement, completenessGaps: [{ kind: 'role', missing: '审批人' }] },
    });
    const r = await svc.get('u1', null, 'p1');
    expect(r.gaps).toEqual([{ kind: 'role', missing: '审批人' }]);
    expect(deepseek.chat).not.toHaveBeenCalled();
  });

  describe('classify（处置分类 · 升级D）', () => {
    const withGaps = (gaps: any[]) =>
      prisma.project.findUnique.mockResolvedValue({
        ...project,
        structuredRequirement: { ...project.structuredRequirement, completenessGaps: gaps },
      });

    it('按 index 对齐处置，ask 带问题/选项；富集回 completenessGaps', async () => {
      withGaps([{ kind: 'screen', missing: '看板' }, { kind: 'dimension', missing: '数据权限' }]);
      deepseek.chat.mockResolvedValue(
        '[{"index":1,"disposition":"autofill"},{"index":2,"disposition":"ask","question":"销售能互看客户吗？","options":["只看自己","看本部门"]}]',
      );
      const r = await svc.classify('u1', null, 'p1');
      expect(r.gaps[0]).toMatchObject({ missing: '看板', disposition: 'autofill' });
      expect(r.gaps[1]).toMatchObject({ missing: '数据权限', disposition: 'ask', question: '销售能互看客户吗？', options: ['只看自己', '看本部门'] });
      expect(prisma.project.update.mock.calls[0][0].data.structuredRequirement.completenessGaps).toHaveLength(2);
    });

    it('ask 但模型没给问题/选项 → 降级 info，不抛半成品追问', async () => {
      withGaps([{ kind: 'flow', missing: '审批流' }]);
      deepseek.chat.mockResolvedValue('[{"index":1,"disposition":"ask"}]');
      const r = await svc.classify('u1', null, 'p1');
      expect(r.gaps[0].disposition).toBe('info');
      expect(r.gaps[0].question).toBeUndefined();
    });

    it('非法 disposition / 缺序号 → 降级 info', async () => {
      withGaps([{ kind: 'entity', missing: '门店' }, { kind: 'role', missing: '管理员' }]);
      deepseek.chat.mockResolvedValue('[{"index":1,"disposition":"bogus"}]'); // 2 没返回
      const r = await svc.classify('u1', null, 'p1');
      expect(r.gaps.map((g) => g.disposition)).toEqual(['info', 'info']);
    });

    it('模型非法 JSON → 全部 info，不崩', async () => {
      withGaps([{ kind: 'entity', missing: '门店' }]);
      deepseek.chat.mockResolvedValue('抱歉无法处理');
      const r = await svc.classify('u1', null, 'p1');
      expect(r.gaps[0].disposition).toBe('info');
    });

    it('没有已存缺口 → 返回空，不调模型', async () => {
      withGaps([]);
      const r = await svc.classify('u1', null, 'p1');
      expect(r.gaps).toEqual([]);
      expect(deepseek.chat).not.toHaveBeenCalled();
    });

    it('ownership：非属主拒绝', async () => {
      withGaps([{ kind: 'entity', missing: '门店' }]);
      await expect(svc.classify('other', null, 'p1')).rejects.toThrow(ForbiddenException);
      expect(deepseek.chat).not.toHaveBeenCalled();
    });
  });

  describe('apply（回写缺口 → planSummary · 升级E）', () => {
    const withState = (gaps: any[], plan: any = { pages: ['首页概览', '门店列表'] }, userId = 'u1') =>
      prisma.project.findUnique.mockResolvedValue({
        userId,
        name: '门店巡检',
        planSummary: plan,
        structuredRequirement: { ...project.structuredRequirement, completenessGaps: gaps },
      });

    it('autofill 的 screen 缺口回写为页面，并标记 applied', async () => {
      withState([{ kind: 'screen', missing: '操作日志/审计记录页面', disposition: 'autofill' }]);
      const r = await svc.apply('u1', null, 'p1');
      expect(r.added.pages).toEqual(['操作日志']);
      const saved = prisma.project.update.mock.calls[0][0].data;
      expect(saved.planSummary.pages).toEqual(['首页概览', '门店列表', '操作日志']);
      expect(saved.structuredRequirement.completenessGaps[0].applied).toBe(true);
    });

    it('flow→features、entity→dataObjects 回写；dimension/role 不回写', async () => {
      withState(
        [
          { kind: 'flow', missing: '数据同步与离线操作流程', disposition: 'autofill' },
          { kind: 'entity', missing: '巡检记录实体', disposition: 'autofill' },
          { kind: 'dimension', missing: '操作审计与留痕', disposition: 'autofill' },
          { kind: 'role', missing: '系统管理员', disposition: 'autofill' },
        ],
        { pages: [], features: ['巡检上报'], dataObjects: ['门店'] },
      );
      const r = await svc.apply('u1', null, 'p1');
      expect(r.added.features).toEqual(['数据同步与离线操作']);
      expect(r.added.dataObjects).toEqual(['巡检记录']);
      expect(r.added.pages).toEqual([]);
      const saved = prisma.project.update.mock.calls[0][0].data;
      expect(saved.planSummary.features).toEqual(['巡检上报', '数据同步与离线操作']);
      expect(saved.planSummary.dataObjects).toEqual(['门店', '巡检记录']);
      // dimension/role 既未进 plan，也不计入 applied 的回写字段
      expect(r.applied).toBe(2);
    });

    it('ask 缺口默认不写；在 accept 里则写', async () => {
      const gap = { kind: 'screen', missing: '数据看板/统计报表页面', disposition: 'ask' };
      withState([gap]);
      const r1 = await svc.apply('u1', null, 'p1'); // 不传 accept
      expect(r1.added.pages).toEqual([]);
      expect(r1.specSync).toBe('noop');

      withState([gap]);
      const r2 = await svc.apply('u1', null, 'p1', ['数据看板/统计报表页面']);
      expect(r2.added.pages).toEqual(['数据看板']);
    });

    it('已存在的同名项去重，不重复添加', async () => {
      withState([{ kind: 'screen', missing: '门店列表页面', disposition: 'autofill' }], { pages: ['首页概览', '门店列表'] });
      const r = await svc.apply('u1', null, 'p1');
      expect(r.added.pages).toEqual([]); // 门店列表 已存在
    });

    it('已 applied 的缺口幂等：再调不重复回写', async () => {
      withState([{ kind: 'screen', missing: '操作日志页面', disposition: 'autofill', applied: true }]);
      const r = await svc.apply('u1', null, 'p1');
      expect(r.added.pages).toEqual([]);
      expect(r.applied).toBe(0);
      expect(prisma.project.update).not.toHaveBeenCalled();
    });

    it('ownership：非属主拒绝', async () => {
      withState([{ kind: 'screen', missing: '看板', disposition: 'autofill' }], { pages: ['首页'] }, 'owner');
      await expect(svc.apply('intruder', null, 'p1')).rejects.toThrow(ForbiddenException);
    });

    describe('规格随动（apply→Specification 同步）', () => {
      it('未冻结规格 → 新页并入 spec.pages + changeLog auto-sync，返回 updated', async () => {
        withState([{ kind: 'screen', missing: '数据看板页面', disposition: 'autofill' }]);
        prisma.specification.findUnique.mockResolvedValue({ status: 'draft', version: 1, pages: [{ name: '首页概览' }], changeLog: [] });
        const r = await svc.apply('u1', null, 'p1');
        expect(r.specSync).toBe('updated');
        const specData = prisma.specification.update.mock.calls[0][0].data;
        expect(specData.pages.map((p: any) => p.name)).toEqual(['首页概览', '数据看板']);
        expect(specData.changeLog.at(-1)).toMatchObject({ action: 'auto-sync', addedItems: ['数据看板'] });
      });

      it('已冻结规格 → 不改 spec.pages，只在 changeLog 记 pending-sync，返回 stale-frozen', async () => {
        withState([{ kind: 'screen', missing: '数据看板页面', disposition: 'autofill' }]);
        prisma.specification.findUnique.mockResolvedValue({ status: 'frozen', version: 1, pages: [{ name: '首页概览' }], changeLog: [] });
        const r = await svc.apply('u1', null, 'p1');
        expect(r.specSync).toBe('stale-frozen');
        const specData = prisma.specification.update.mock.calls[0][0].data;
        expect(specData.pages).toBeUndefined(); // 不动冻结内容
        expect(specData.changeLog.at(-1)).toMatchObject({ action: 'pending-sync', pendingItems: ['数据看板'] });
      });

      it('无规格 → 不报错，返回 no-spec（日后 draft 会从已含新页的 planSummary 组装）', async () => {
        withState([{ kind: 'screen', missing: '数据看板页面', disposition: 'autofill' }]);
        prisma.specification.findUnique.mockResolvedValue(null);
        const r = await svc.apply('u1', null, 'p1');
        expect(r.specSync).toBe('no-spec');
        expect(prisma.specification.update).not.toHaveBeenCalled();
      });

      it('没有实际新增页面（dedup）→ 不查规格，specSync=noop', async () => {
        withState([{ kind: 'screen', missing: '门店列表页面', disposition: 'autofill' }], { pages: ['首页概览', '门店列表'] });
        const r = await svc.apply('u1', null, 'p1');
        expect(r.specSync).toBe('noop');
        expect(prisma.specification.findUnique).not.toHaveBeenCalled();
      });
    });
  });
});
