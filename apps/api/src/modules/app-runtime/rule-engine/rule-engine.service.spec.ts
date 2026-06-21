import { RuleEngineService } from './rule-engine.service';
import { RulePack, RuleDataContext } from './rule-pack.types';

/**
 * 药监风险画像 fixture（据 rulepack.schema.json v1.3 + 药监方案文档自建；
 * 可被真实 通用性验证_药监.json 替换）。覆盖：computed/aggregate(count/sum)、weighted_sum 公式、
 * grade 多级规则、most_severe 裁决、evidence_policy 贯穿线、filter 时间窗。
 */
const NOW = '2026-06-21';

function 药监Pack(overrides: Partial<RulePack> = {}): RulePack {
  return {
    meta: { name: '药监风险画像', version: '1.0', project_id: 'p-yaojian', industry_tag: '药监', enabled: true },
    data_bindings: [
      { entity: '企业', fields: ['企业类型'] },
      { entity: '检查记录', fields: ['检查类型', '检查日期', '缺陷数', '严重缺陷数'] },
    ],
    metrics: [
      { id: 'M_飞检次数', label: '近12月飞检次数', source_type: 'computed', metric_family: 'aggregate', aggregation: 'count',
        source: '检查记录.检查类型', filter: "检查类型 = '飞检' AND 检查日期 >= monthsAgo(12)", evidence_ref: ['EV_检查记录'] },
      { id: 'M_缺陷总数', label: '近12月缺陷总数', source_type: 'computed', metric_family: 'aggregate', aggregation: 'sum',
        source: '检查记录.缺陷数', filter: '检查日期 >= monthsAgo(12)', evidence_ref: ['EV_检查记录'] },
      { id: 'M_严重缺陷数', label: '近12月严重缺陷数', source_type: 'computed', metric_family: 'aggregate', aggregation: 'sum',
        source: '检查记录.严重缺陷数', filter: '检查日期 >= monthsAgo(12)', evidence_ref: ['EV_检查记录'] },
    ],
    formulas: [
      { id: 'F_风险指数', label: '风险指数', type: 'weighted_sum', expression: 'M_飞检次数 * 10 + M_缺陷总数 * 2 + M_严重缺陷数 * 15' },
    ],
    rules: [
      { id: 'R-LEVEL-D', label: '高风险', when: 'F_风险指数 >= 50 OR M_严重缺陷数 >= 1', then: [{ conclusion_type: 'grade', value: 'D' }], priority: 100, evidence_ref: ['EV_检查记录'] },
      { id: 'R-LEVEL-C', label: '中高风险', when: 'F_风险指数 >= 30', then: [{ conclusion_type: 'grade', value: 'C' }], priority: 75 },
      { id: 'R-LEVEL-B', label: '中风险', when: 'F_风险指数 >= 10', then: [{ conclusion_type: 'grade', value: 'B' }], priority: 50 },
      { id: 'R-LEVEL-A', label: '低风险', when: 'F_风险指数 >= 0', then: [{ conclusion_type: 'grade', value: 'A' }], priority: 25 },
    ],
    conflict_policy: { strategy: 'most_severe' },
    evidence_policy: { require_evidence_ref: true, default_status: '待人工确认', completeness_metric: true, no_auto_conclude_when_incomplete: true },
    ...overrides,
  };
}

/** 一家高风险企业：含一条12月外的旧飞检（缺陷100/严重5），应被时间窗滤掉、不计入。 */
const 高风险企业: RuleDataContext = {
  subject: { 名称: '某药批企业', 企业类型: '批发' },
  related: {
    检查记录: [
      { 检查类型: '飞检', 检查日期: '2026-05-01', 缺陷数: 5, 严重缺陷数: 1 },
      { 检查类型: '飞检', 检查日期: '2026-03-10', 缺陷数: 3, 严重缺陷数: 0 },
      { 检查类型: '日常', 检查日期: '2026-04-01', 缺陷数: 2, 严重缺陷数: 0 },
      { 检查类型: '飞检', 检查日期: '2024-01-01', 缺陷数: 100, 严重缺陷数: 5 }, // 12月外，应滤掉
    ],
  },
};

describe('RuleEngineService（8步执行引擎，药监端到端）', () => {
  const engine = new RuleEngineService();

  it('高风险企业 → D级 + 正确风险指数 + 证据链 + 待人工确认（时间窗生效）', () => {
    const r = engine.evaluate(药监Pack(), 高风险企业, NOW);

    // 时间窗：旧飞检被滤 → 飞检2次、缺陷10、严重1（不是含旧行的 3/110/6）
    expect(r.metrics.find((m) => m.id === 'M_飞检次数')!.value).toBe(2);
    expect(r.metrics.find((m) => m.id === 'M_缺陷总数')!.value).toBe(10);
    expect(r.metrics.find((m) => m.id === 'M_严重缺陷数')!.value).toBe(1);
    // 风险指数 = 2*10 + 10*2 + 1*15 = 55
    expect(r.formulas['F_风险指数']).toBe(55);
    // most_severe：D(100)/C(75)/B(50)/A(25) 全命中 → 取最严 D
    expect(r.finalConclusions).toHaveLength(1);
    expect(r.finalConclusions[0]).toMatchObject({ conclusion_type: 'grade', value: 'D', ruleId: 'R-LEVEL-D' });
    expect(r.hits.length).toBe(4); // 四级规则都命中（裁决前）
    // evidence_policy：证据齐 → 完整度1、不需额外核实、整体待人工确认
    expect(r.evidenceCompleteness).toBe(1);
    expect(r.needsVerification).toBe(false);
    expect(r.status).toBe('待人工确认');
    expect(r.evidenceChain).toContain('EV_检查记录');
    expect(r.ruleEngineEnabled).toBe(true);
  });

  it('低风险企业 → A级', () => {
    const 低风险: RuleDataContext = {
      subject: { 企业类型: '零售' },
      related: { 检查记录: [{ 检查类型: '日常', 检查日期: '2026-05-01', 缺陷数: 0, 严重缺陷数: 0 }] },
    };
    const r = engine.evaluate(药监Pack(), 低风险, NOW);
    expect(r.formulas['F_风险指数']).toBe(0); // 飞检0*10 + 缺陷0*2 + 严重0*15
    expect(r.finalConclusions[0].value).toBe('A');
  });

  it('enabled=false → 不产出任何规则结论（纯CRUD）', () => {
    const pack = 药监Pack({ meta: { ...药监Pack().meta, enabled: false } });
    const r = engine.evaluate(pack, 高风险企业, NOW);
    expect(r.ruleEngineEnabled).toBe(false);
    expect(r.finalConclusions).toHaveLength(0);
    expect(r.metrics).toHaveLength(0);
  });

  it('证据缺失 → 待核实，绝不自动下结论（evidence_policy 贯穿线）', () => {
    // 去掉一个指标的 evidence_ref → 证据不全 → needsVerification
    const pack = 药监Pack();
    pack.metrics[1] = { ...pack.metrics[1], evidence_ref: [] };
    const r = engine.evaluate(pack, 高风险企业, NOW);
    expect(r.evidenceCompleteness).toBeLessThan(1);
    expect(r.needsVerification).toBe(true);
    // 仍算出结论，但标记需人工核实（不静默自动定级）
    expect(r.finalConclusions[0].value).toBe('D');
    expect(r.status).toBe('待人工确认');
  });

  it('veto_first：一票否决先于打分', () => {
    const pack = 药监Pack({
      conflict_policy: { strategy: 'veto_first' },
      rules: [
        { id: 'R-VETO', label: '严重缺陷一票否决', when: 'M_严重缺陷数 >= 1', then: [{ conclusion_type: 'decision', value: '不通过' }], is_veto: true, priority: 60 },
        { id: 'R-PASS', label: '常规通过', when: 'F_风险指数 < 1000', then: [{ conclusion_type: 'decision', value: '通过' }], priority: 90 },
      ],
    });
    const r = engine.evaluate(pack, 高风险企业, NOW);
    // 否决命中 → 取否决结论，即便"通过"规则 priority 更高
    expect(r.finalConclusions).toHaveLength(1);
    expect(r.finalConclusions[0]).toMatchObject({ value: '不通过', isVeto: true });
  });

  it('temporal trend（v1 唯一时序能力）：持续上升 → 升', () => {
    const pack: RulePack = {
      ...药监Pack(),
      metrics: [{ id: 'M_乙炔趋势', label: '乙炔含量趋势', source_type: 'computed', metric_family: 'temporal', temporal_op: 'trend', source: '监测.乙炔', evidence_ref: ['EV_监测'] }],
      formulas: [],
      rules: [{ id: 'R-预警', when: "M_乙炔趋势 = '升'", then: [{ conclusion_type: 'grade', value: '预警' }], priority: 100, evidence_ref: ['EV_监测'] }],
    };
    const ctx: RuleDataContext = { subject: {}, related: { 监测: [{ 乙炔: 1 }, { 乙炔: 2 }, { 乙炔: 5 }] } };
    const r = engine.evaluate(pack, ctx, NOW);
    expect(r.metrics[0].value).toBe('升');
    expect(r.finalConclusions[0].value).toBe('预警');
  });

  it('assign 结论支持表达式（补丁1：额度=表达式）', () => {
    const pack: RulePack = {
      ...药监Pack(),
      metrics: [{ id: 'M_月收入', label: '月收入', source_type: 'manual', manual_spec: { input_role: '信贷员', scoring_standard: '工资流水' }, evidence_ref: ['EV_流水'] }],
      formulas: [],
      rules: [{ id: 'R-额度', when: 'M_月收入 > 0', then: [{ conclusion_type: 'assign', value: 'M_月收入 * 8' }], priority: 100, evidence_ref: ['EV_流水'] }],
      conflict_policy: { strategy: 'by_priority' },
    };
    const r = engine.evaluate(pack, { subject: {}, related: {}, manualInputs: { M_月收入: 10000 } }, NOW);
    expect(r.finalConclusions[0]).toMatchObject({ conclusion_type: 'assign', value: 80000 });
  });
});
