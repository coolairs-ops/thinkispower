import { BadRequestException } from '@nestjs/common';
import { RulePackController } from './rule-pack.controller';
import { RuleEngineService } from './rule-engine.service';
import { RulePack, RuleDataContext } from './rule-pack.types';

const pack: RulePack = {
  meta: { name: '药监', version: '1.0', project_id: 'p1', enabled: true },
  data_bindings: [{ entity: '检查记录', fields: ['缺陷数'] }],
  metrics: [{ id: 'M_缺陷', label: '缺陷', source_type: 'computed', aggregation: 'sum', source: '检查记录.缺陷数', evidence_ref: ['EV'] }],
  formulas: [{ id: 'F_score', type: 'weighted_sum', expression: 'M_缺陷 * 5' }],
  rules: [
    { id: 'R-D', when: 'F_score >= 50', then: [{ conclusion_type: 'grade', value: 'D' }], priority: 100, evidence_ref: ['EV'] },
    { id: 'R-A', when: 'F_score >= 0', then: [{ conclusion_type: 'grade', value: 'A' }], priority: 25 },
  ],
  conflict_policy: { strategy: 'most_severe' },
  evidence_policy: { require_evidence_ref: true, default_status: '待人工确认', completeness_metric: true, no_auto_conclude_when_incomplete: true },
};
const sample: RuleDataContext = { subject: {}, related: { 检查记录: [{ id: 'r1', 缺陷数: 12 }] } };

describe('RulePackController（Slice 1：存取 + 即时试算）', () => {
  const req = { user: { id: 'u1' } };
  function build(sr: any = {}) {
    const prisma = {
      project: { findUnique: jest.fn().mockResolvedValue({ userId: 'u1', structuredRequirement: sr }), update: jest.fn().mockResolvedValue({}) },
    };
    return { ctrl: new RulePackController(prisma as any, new RuleEngineService()), prisma };
  }

  it('即时试算：草稿规则包+样例 → 当场跑引擎返结论（缺陷12*5=60≥50→D）', async () => {
    const { ctrl } = build();
    const r = await ctrl.trial(req, 'p1', { rulePack: pack, sample });
    expect(r.finalConclusions[0].value).toBe('D');
    expect(r.formulas['F_score']).toBe(60);
    expect(r.status).toBe('待人工确认');
  });

  it('即时试算：改样例数字 → 结论随之变（缺陷5*5=25<50→A）', async () => {
    const { ctrl } = build();
    const r = await ctrl.trial(req, 'p1', { rulePack: pack, sample: { subject: {}, related: { 检查记录: [{ id: 'r1', 缺陷数: 5 }] } } });
    expect(r.finalConclusions[0].value).toBe('A');
  });

  it('保存 → 写入 structuredRequirement.rulePack（不动其它键）', async () => {
    const { ctrl, prisma } = build({ relations: [{ parent: 'x' }], rulePack: null });
    await ctrl.save(req, 'p1', { rulePack: pack });
    const data = prisma.project.update.mock.calls[0][0].data.structuredRequirement;
    expect(data.rulePack.meta.name).toBe('药监');
    expect(data.relations).toEqual([{ parent: 'x' }]); // 其它键保留
  });

  it('取：返回已存规则包', async () => {
    const { ctrl } = build({ rulePack: pack });
    expect((await ctrl.load(req, 'p1')).rulePack!.meta.name).toBe('药监');
  });

  it('试算缺参数 → BadRequest', async () => {
    const { ctrl } = build();
    await expect(ctrl.trial(req, 'p1', { rulePack: pack } as any)).rejects.toBeInstanceOf(BadRequestException);
  });
});
