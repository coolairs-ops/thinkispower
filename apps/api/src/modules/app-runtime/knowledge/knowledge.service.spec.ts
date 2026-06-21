import { KnowledgeService } from './knowledge.service';
import { RuleEngineService } from '../rule-engine/rule-engine.service';
import { FactExtractor } from './knowledge.types';
import { RulePack } from '../rule-engine/rule-pack.types';

/**
 * 接入轨 Slice A：拿真实荷花池报告证通「原件→证据→事实→评分→证据链回指」。
 * 报告片段取自 河北荷花池药业_企业风险分析报告.docx（真实材料）。
 */
const 荷花池报告 = `─── 河北省药品监督管理局 ───
企业风险分析与应对策略报告  河北荷花池药业有限公司
一、企业概况
河北荷花池药业有限公司主要从事中药饮片生产与销售。该企业已累计接受3次飞行检查（分别为2021年、2025年6月、2025年12月），发现主要缺陷7项；累计被通报不合格药品13批次；曾被发出告诫信1份。整体合规风险呈明显上升趋势。
六、监管措施建议
基于以上分析，建议将该企业风险等级调整为"D级（高风险）"。`;

// 确定性提取器（模拟"AI 找候选+强制附原文"；真实 LLM 提取器实现同接口插入即可）。
// 含一条**编造**候选（99批次）证明机器校验门能卡掉指不出原文的幻觉。
const 提取器: FactExtractor = () => [
  { name: '飞检次数', value: 3, quote: '累计接受3次飞行检查', locator: { paragraph: 1 } },
  { name: '不合格批次数', value: 13, quote: '累计被通报不合格药品13批次', locator: { paragraph: 1 } },
  { name: '不合格批次数', value: 99, quote: '累计被通报不合格药品99批次', locator: { paragraph: 1 } }, // 幻觉：原文里没有
];

// 评分规则包：metric 绑 confirmed Fact 取数（source 'fact.value' + filter name=）
const 评分包: RulePack = {
  meta: { name: '药监风险画像(知识库版)', version: '1.0', project_id: 'p1', industry_tag: '药监', enabled: true },
  data_bindings: [{ entity: 'fact', fields: ['name', 'value'] }],
  metrics: [
    { id: 'M_飞检次数', label: '飞检次数', source_type: 'computed', metric_family: 'aggregate', aggregation: 'sum', source: 'fact.value', filter: "name = '飞检次数'", evidence_ref: ['EV-报告'] },
    { id: 'M_不合格批次数', label: '不合格批次数', source_type: 'computed', metric_family: 'aggregate', aggregation: 'sum', source: 'fact.value', filter: "name = '不合格批次数'", evidence_ref: ['EV-报告'] },
  ],
  formulas: [{ id: 'F_风险指数', type: 'weighted_sum', expression: 'M_不合格批次数 * 2 + M_飞检次数 * 10' }],
  rules: [
    { id: 'R-LEVEL-D', when: 'F_风险指数 >= 50', then: [{ conclusion_type: 'grade', value: 'D' }], priority: 100, evidence_ref: ['EV-报告'] },
    { id: 'R-LEVEL-A', when: 'F_风险指数 >= 0', then: [{ conclusion_type: 'grade', value: 'A' }], priority: 25 },
  ],
  conflict_policy: { strategy: 'most_severe' },
  evidence_policy: { require_evidence_ref: true, default_status: '待人工确认', completeness_metric: true, no_auto_conclude_when_incomplete: true },
};

describe('KnowledgeService 接入轨 Slice A（荷花池报告 → 评分 → 证据链回指）', () => {
  const kb = new KnowledgeService();
  const engine = new RuleEngineService();
  const NOW = '2026-06-21';

  it('ingest：原件留哈希 + 机器校验门（真原文过、编造的99批次作废）+ 缺失显式', () => {
    const base = kb.ingest({ title: '河北荷花池药业_企业风险分析报告', doc_type: '风险分析报告', text: 荷花池报告 }, 提取器, ['严重缺陷数']);
    // 原件指纹
    expect(base.sources[0].content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(base.sources[0].status).toBe('active');
    // 校验门：13批次真原文 → candidate；99批次编造 → verified_in_source=false、fact rejected
    const f13 = base.facts.find((f) => f.name === '不合格批次数' && f.value === 13)!;
    const f99 = base.facts.find((f) => f.value === 99)!;
    expect(f13.status).toBe('candidate');
    expect(f99.status).toBe('rejected'); // 幻觉被卡掉
    expect(base.evidences.find((e) => e.quote.includes('99'))!.verified_in_source).toBe(false);
    // 缺失显式：需要但没提取到的严重缺陷数 → missing（绝不静默补0）
    expect(base.facts.find((f) => f.name === '严重缺陷数')!.status).toBe('missing');
  });

  it('confirm → 评分 → D级；证据链能从结论顺链回指报告里"13批次"那句原文', () => {
    let base = kb.ingest({ title: '河北荷花池药业_企业风险分析报告', text: 荷花池报告 }, 提取器);
    // 人工确认两条真实事实（13批次 / 3次飞检）
    const realIds = base.facts.filter((f) => f.status === 'candidate').map((f) => f.fact_id);
    base = kb.confirm(base, realIds, '张审核', `${NOW}T09:00:00Z`);

    // confirmed Fact → RuleDataContext → 引擎
    const ctx = kb.toRuleContext(base);
    const r = engine.evaluate(评分包, ctx, NOW);
    // 风险指数 = 13*2 + 3*10 = 56 ≥ 50 → D
    expect(r.formulas['F_风险指数']).toBe(56);
    expect(r.finalConclusions[0].value).toBe('D');

    // ② 数据级闭环（引擎层）：D级结论的证据 = 它依赖的指标(透传公式)所携带的真 evidence_id
    const f13 = base.facts.find((f) => f.name === '不合格批次数' && f.value === 13)!;
    const ev13 = f13.evidence_refs[0]; // 13批次那条 Fact 的真证据 id
    expect(r.finalConclusions[0].evidenceRefs).toContain(ev13); // D级 ← 真证据
    expect(r.evidenceChain).toContain(ev13); // 证据链含真 evidence_id（非占位）
    // 引擎输出里就能闭环：D级 → evidence_id → 原文"13批次"
    expect(base.evidences.find((e) => e.evidence_id === ev13)!.quote).toContain('13批次');

    // 证据链回指（KB 侧 trace 另证同一链）：D级 ← 不合格批次数=13 ← 原文 ← 原件荷花池
    const t13 = kb.trace(base).find((x) => x.factName === '不合格批次数')!;
    expect(t13.quote).toContain('13批次');
    expect(t13.verified).toBe(true);
    expect(t13.sourceTitle).toContain('荷花池');
  });

  it('未确认的候选不进评分（只有 confirmed 才取数）', () => {
    const base = kb.ingest({ title: 't', text: 荷花池报告 }, 提取器); // 不 confirm
    const ctx = kb.toRuleContext(base);
    expect(ctx.related.fact).toHaveLength(0); // candidate 不入上下文
    const r = engine.evaluate(评分包, ctx, NOW);
    expect(r.formulas['F_风险指数']).toBe(0); // 无数据 → 0 → A，不会凭空出 D
    expect(r.finalConclusions[0].value).toBe('A');
  });
});
