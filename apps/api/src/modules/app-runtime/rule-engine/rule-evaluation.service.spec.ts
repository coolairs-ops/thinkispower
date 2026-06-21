import { NotFoundException } from '@nestjs/common';
import { RuleEvaluationService } from './rule-evaluation.service';
import { RuleEngineService } from './rule-engine.service';
import { RulePack } from './rule-pack.types';

const NOW = '2026-06-21';

const 药监Pack: RulePack = {
  meta: { name: '药监风险画像', version: '1.0', project_id: 'p1', industry_tag: '药监', enabled: true },
  data_bindings: [
    { entity: '企业', fields: ['企业类型'] },
    { entity: '检查记录', fields: ['检查类型', '检查日期', '缺陷数', '严重缺陷数'] },
  ],
  metrics: [
    { id: 'M_飞检次数', label: '飞检次数', source_type: 'computed', aggregation: 'count', source: '检查记录.检查类型', filter: "检查类型 = '飞检' AND 检查日期 >= monthsAgo(12)", evidence_ref: ['EV_检查记录'] },
    { id: 'M_缺陷总数', label: '缺陷总数', source_type: 'computed', aggregation: 'sum', source: '检查记录.缺陷数', filter: '检查日期 >= monthsAgo(12)', evidence_ref: ['EV_检查记录'] },
    { id: 'M_严重缺陷数', label: '严重缺陷数', source_type: 'computed', aggregation: 'sum', source: '检查记录.严重缺陷数', filter: '检查日期 >= monthsAgo(12)', evidence_ref: ['EV_检查记录'] },
  ],
  formulas: [{ id: 'F_风险指数', type: 'weighted_sum', expression: 'M_飞检次数 * 10 + M_缺陷总数 * 2 + M_严重缺陷数 * 15' }],
  rules: [
    { id: 'R-LEVEL-D', when: 'F_风险指数 >= 50', then: [{ conclusion_type: 'grade', value: 'D' }], priority: 100, evidence_ref: ['EV_检查记录'] },
    { id: 'R-LEVEL-A', when: 'F_风险指数 >= 0', then: [{ conclusion_type: 'grade', value: 'A' }], priority: 25 },
  ],
  conflict_policy: { strategy: 'most_severe' },
  evidence_policy: { require_evidence_ref: true, default_status: '待人工确认', completeness_metric: true, no_auto_conclude_when_incomplete: true },
};

describe('RuleEvaluationService（Slice 0.5：引擎接真实 CRUD 数据）', () => {
  function build(sr: Record<string, unknown>, crudRows: Array<Record<string, unknown>>) {
    const prisma = { project: { findUnique: jest.fn().mockResolvedValue({ structuredRequirement: sr }) } };
    const crud = {
      get: jest.fn().mockResolvedValue({ data: { id: 'ent-1', 企业类型: '批发' } }),
      list: jest.fn().mockResolvedValue({ data: crudRows, page: 1, pageSize: 100, total: crudRows.length }),
    };
    const svc = new RuleEvaluationService(prisma as any, crud as any, new RuleEngineService());
    return { svc, prisma, crud };
  }

  const 检查记录 = [
    { id: 'r1', 检查类型: '飞检', 检查日期: '2026-05-01', 缺陷数: 5, 严重缺陷数: 1 },
    { id: 'r2', 检查类型: '飞检', 检查日期: '2026-03-10', 缺陷数: 3, 严重缺陷数: 0 },
  ];

  it('查一家企业 → 按 data_bindings 取真实关联行 → 跑规则 → D级 + 数据来源回指真实记录', async () => {
    const { svc, crud } = build(
      { rulePack: 药监Pack, relations: [{ parent: '企业', child: '检查记录', fkField: '企业Id' }] },
      检查记录,
    );
    const r = await svc.evaluateObject('p1', '企业', 'ent-1', NOW);

    // 引擎跑出 D 级（飞检2*10 + 缺陷8*2 + 严重1*15 = 51 ≥ 50）
    expect(r.finalConclusions[0].value).toBe('D');
    expect(r.ruleEngineEnabled).toBe(true);
    expect(r.status).toBe('待人工确认');

    // 用外键 企业Id 过滤到本企业取关联行
    expect(crud.get).toHaveBeenCalledWith('p1', '企业', 'ent-1');
    expect(crud.list).toHaveBeenCalledWith('p1', '检查记录', { filters: { 企业Id: 'ent-1' }, pageSize: 100 });

    // provenance：结论真回指 r1/r2 两条真实记录
    const prov = r.dataProvenance.find((p) => p.entity === '检查记录')!;
    expect(prov.via).toBe('企业Id');
    expect(prov.rowIds).toEqual(['r1', 'r2']);
  });

  it('未配置规则包 → NotFoundException', async () => {
    const { svc } = build({}, []);
    await expect(svc.evaluateObject('p1', '企业', 'ent-1', NOW)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('找不到关联外键 → 该实体按空集处理 + provenance 标注（不静默乱取全表）', async () => {
    const { svc, crud } = build(
      { rulePack: 药监Pack, relations: [] }, // 无关系 → 取不到检查记录
      检查记录,
    );
    const r = await svc.evaluateObject('p1', '企业', 'ent-1', NOW);
    expect(crud.list).not.toHaveBeenCalled(); // 没乱拉全表
    const prov = r.dataProvenance.find((p) => p.entity === '检查记录')!;
    expect(prov.via).toBeNull();
    expect(prov.rowIds).toEqual([]);
    expect(prov.note).toContain('未找到');
    // 无关联数据 → 风险指数 0 → A 级（不会误判 D）
    expect(r.finalConclusions[0].value).toBe('A');
  });
});
