import { ForbiddenException } from '@nestjs/common';
import { BusinessRuleCompletionService } from './business-rule-completion.service';

describe('BusinessRuleCompletionService（业务规则补全 · A抽取+B问答）', () => {
  let prisma: any;
  let deepseek: { chat: jest.Mock };
  let svc: BusinessRuleCompletionService;

  const project = {
    userId: 'u1',
    name: '门店巡检',
    planSummary: { features: ['智能路径规划 — 调整需上报'], pages: ['门店详情'], roles: ['销售管理员'] },
    structuredRequirement: {},
  };

  beforeEach(() => {
    prisma = { project: { findUnique: jest.fn().mockResolvedValue(project), update: jest.fn().mockResolvedValue({}) } };
    deepseek = { chat: jest.fn() };
    svc = new BusinessRuleCompletionService(prisma as never, deepseek as never);
  });

  describe('detect', () => {
    it('抽取 autofill 规则 + 出 ask 选择题，存 businessRuleCandidates', async () => {
      deepseek.chat.mockResolvedValue(
        JSON.stringify([
          { name: '路径调整审批', trigger: '调整路径时', outcome: '需上报审批', source: 'feature', disposition: 'autofill' },
          { name: '金额精度', trigger: '记金额时', source: 'feature', disposition: 'ask', question: '几位小数？', options: [{ label: '2位', value: '保留2位小数' }] },
        ]),
      );
      const r = await svc.detect('u1', 'p1');
      expect(r.candidates).toHaveLength(2);
      expect(r.candidates[0]).toMatchObject({ name: '路径调整审批', disposition: 'autofill' });
      expect(r.candidates[1]).toMatchObject({ name: '金额精度', disposition: 'ask' });
      expect(r.candidates[1].options).toHaveLength(1);
      expect(prisma.project.update.mock.calls[0][0].data.structuredRequirement.businessRuleCandidates).toHaveLength(2);
    });

    it('非法 JSON → 候选空，不崩', async () => {
      deepseek.chat.mockResolvedValue('抱歉');
      expect((await svc.detect('u1', 'p1')).candidates).toEqual([]);
    });

    it('过滤缺 name 的脏项', async () => {
      deepseek.chat.mockResolvedValue('[{"name":"规则A","disposition":"autofill"},{"trigger":"x"}]');
      expect((await svc.detect('u1', 'p1')).candidates).toHaveLength(1);
    });

    it('ownership：非属主拒绝', async () => {
      await expect(svc.detect('other', 'p1')).rejects.toThrow(ForbiddenException);
      expect(deepseek.chat).not.toHaveBeenCalled();
    });
  });

  describe('apply', () => {
    const withCands = (cands: any[]) =>
      prisma.project.findUnique.mockResolvedValue({ ...project, structuredRequirement: { businessRuleCandidates: cands } });

    it('autofill 直接成规则；ask 按答案定 outcome', async () => {
      withCands([
        { name: '路径调整审批', trigger: '调整时', outcome: '需审批', source: 'feature', disposition: 'autofill' },
        { name: '金额精度', trigger: '记金额', source: 'feature', disposition: 'ask' },
      ]);
      const r = await svc.apply('u1', 'p1', { 金额精度: '保留2位小数' });
      expect(r.rules).toHaveLength(2);
      expect(r.rules.find((x) => x.name === '路径调整审批')).toMatchObject({ outcome: '需审批', confirmed: true });
      expect(r.rules.find((x) => x.name === '金额精度')!.outcome).toBe('保留2位小数');
      expect(prisma.project.update.mock.calls[0][0].data.structuredRequirement.businessRules).toHaveLength(2);
    });

    it('ask: __skip__丢弃 / 无答案有默认用默认 / 无答案无默认跳过(不写半成品)', async () => {
      withCands([
        { name: '二次确认', disposition: 'ask', outcome: '默认开启' }, // 无答案+有默认 → 用默认
        { name: '配额', disposition: 'ask' }, // 无答案+无默认 → 跳过
        { name: '审批', disposition: 'ask', outcome: 'x' }, // __skip__ → 丢弃
      ]);
      const r = await svc.apply('u1', 'p1', { 审批: '__skip__' });
      expect(r.rules.map((x) => x.name)).toEqual(['二次确认']);
      expect(r.rules[0].outcome).toBe('默认开启');
    });

    it('ownership：非属主拒绝', async () => {
      withCands([{ name: 'x', disposition: 'autofill' }]);
      await expect(svc.apply('intruder', 'p1')).rejects.toThrow(ForbiddenException);
    });
  });

  it('get 返回候选 + 规则，不调模型', async () => {
    prisma.project.findUnique.mockResolvedValue({
      ...project,
      structuredRequirement: { businessRuleCandidates: [{ name: 'a' }], businessRules: [{ name: 'a', confirmed: true }] },
    });
    const r = await svc.get('u1', 'p1');
    expect(r.candidates).toHaveLength(1);
    expect(r.rules).toHaveLength(1);
    expect(deepseek.chat).not.toHaveBeenCalled();
  });
});
