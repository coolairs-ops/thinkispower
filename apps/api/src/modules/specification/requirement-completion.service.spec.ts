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
    };
    deepseek = { chat: jest.fn() };
    svc = new RequirementCompletionService(prisma as never, deepseek as never);
  });

  it('调模型找整块缺口，解析并存到 structuredRequirement.completenessGaps', async () => {
    deepseek.chat.mockResolvedValue('```json\n[{"kind":"flow","missing":"对账流程","why":"门店巡检通常要对账","source":"uncovered-dimension"}]\n```');
    const r = await svc.analyze('u1', 'p1');
    expect(r.gaps).toHaveLength(1);
    expect(r.gaps[0]).toMatchObject({ kind: 'flow', missing: '对账流程' });
    // 存库到 completenessGaps
    const saved = prisma.project.update.mock.calls[0][0].data.structuredRequirement;
    expect(saved.completenessGaps).toHaveLength(1);
    expect(saved.prd.pages).toEqual(['门店列表']); // 原 prd 保留
  });

  it('模型输出非法 JSON → 降级为空，不崩', async () => {
    deepseek.chat.mockResolvedValue('抱歉我无法回答');
    const r = await svc.analyze('u1', 'p1');
    expect(r.gaps).toEqual([]);
    expect(prisma.project.update).toHaveBeenCalled(); // 仍存空数组
  });

  it('过滤无 missing 字段的脏项，上限 30', async () => {
    deepseek.chat.mockResolvedValue('[{"kind":"entity","missing":"跟进记录"},{"kind":"entity"},{"foo":1}]');
    const r = await svc.analyze('u1', 'p1');
    expect(r.gaps).toHaveLength(1);
    expect(r.gaps[0].missing).toBe('跟进记录');
  });

  it('ownership：非属主拒绝', async () => {
    await expect(svc.analyze('other', 'p1')).rejects.toThrow(ForbiddenException);
    expect(deepseek.chat).not.toHaveBeenCalled();
  });

  it('get 返回已存缺口，不再调模型', async () => {
    prisma.project.findUnique.mockResolvedValue({
      ...project,
      structuredRequirement: { ...project.structuredRequirement, completenessGaps: [{ kind: 'role', missing: '审批人' }] },
    });
    const r = await svc.get('u1', 'p1');
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
      const r = await svc.classify('u1', 'p1');
      expect(r.gaps[0]).toMatchObject({ missing: '看板', disposition: 'autofill' });
      expect(r.gaps[1]).toMatchObject({ missing: '数据权限', disposition: 'ask', question: '销售能互看客户吗？', options: ['只看自己', '看本部门'] });
      expect(prisma.project.update.mock.calls[0][0].data.structuredRequirement.completenessGaps).toHaveLength(2);
    });

    it('ask 但模型没给问题/选项 → 降级 info，不抛半成品追问', async () => {
      withGaps([{ kind: 'flow', missing: '审批流' }]);
      deepseek.chat.mockResolvedValue('[{"index":1,"disposition":"ask"}]');
      const r = await svc.classify('u1', 'p1');
      expect(r.gaps[0].disposition).toBe('info');
      expect(r.gaps[0].question).toBeUndefined();
    });

    it('非法 disposition / 缺序号 → 降级 info', async () => {
      withGaps([{ kind: 'entity', missing: '门店' }, { kind: 'role', missing: '管理员' }]);
      deepseek.chat.mockResolvedValue('[{"index":1,"disposition":"bogus"}]'); // 2 没返回
      const r = await svc.classify('u1', 'p1');
      expect(r.gaps.map((g) => g.disposition)).toEqual(['info', 'info']);
    });

    it('模型非法 JSON → 全部 info，不崩', async () => {
      withGaps([{ kind: 'entity', missing: '门店' }]);
      deepseek.chat.mockResolvedValue('抱歉无法处理');
      const r = await svc.classify('u1', 'p1');
      expect(r.gaps[0].disposition).toBe('info');
    });

    it('没有已存缺口 → 返回空，不调模型', async () => {
      withGaps([]);
      const r = await svc.classify('u1', 'p1');
      expect(r.gaps).toEqual([]);
      expect(deepseek.chat).not.toHaveBeenCalled();
    });

    it('ownership：非属主拒绝', async () => {
      withGaps([{ kind: 'entity', missing: '门店' }]);
      await expect(svc.classify('other', 'p1')).rejects.toThrow(ForbiddenException);
      expect(deepseek.chat).not.toHaveBeenCalled();
    });
  });
});
