import { RulePack, RuleDataContext } from './rule-pack.types';

/**
 * 行业模板库（Industry Profile）。
 *
 * 交接说明两层分工：schema/引擎 = **地基层**（通用，能力全不全）；行业模板 = **呈现层**
 * （每行业一个：预填指标/公式/规则骨架 + 一份样例案例供即时试算 + 元数据）。
 * 模板是**配置数据不是代码**——加行业 = 往本表加一条，引擎/配置 UI 零改动。
 *
 * 现仅药监（据 rulepack.schema 文档自建，可被真实 通用性验证_*.json 替换）；
 * 贷款/医疗/电网/金融/安全生产 5 个待真实样例补入。
 */
export interface RuleTemplate {
  id: string;
  name: string;
  industryTag: string;
  description: string;
  /** 预填规则包骨架（业务专家在此基础上改阈值/权重） */
  rulePack: RulePack;
  /** 一份代表性样例案例，供配置态"即时试算"起手（不是生产数据） */
  sample: RuleDataContext;
}

const 药监: RuleTemplate = {
  id: 'yaojian-risk',
  name: '药监风险画像',
  industryTag: '药监',
  description: '按企业近 12 月飞检/缺陷/严重缺陷算风险指数并分级（A-D，取最严），证据回指、待人工确认。',
  rulePack: {
    meta: { name: '药监风险画像', version: '1.0', project_id: '', industry_tag: '药监', enabled: true },
    data_bindings: [
      { entity: '企业', fields: ['企业类型'] },
      { entity: '检查记录', fields: ['检查类型', '检查日期', '缺陷数', '严重缺陷数'] },
    ],
    metrics: [
      { id: 'M_飞检次数', label: '近12月飞检次数', source_type: 'computed', metric_family: 'aggregate', aggregation: 'count', source: '检查记录.检查类型', filter: "检查类型 = '飞检' AND 检查日期 >= monthsAgo(12)", evidence_ref: ['EV_检查记录'] },
      { id: 'M_缺陷总数', label: '近12月缺陷总数', source_type: 'computed', metric_family: 'aggregate', aggregation: 'sum', source: '检查记录.缺陷数', filter: '检查日期 >= monthsAgo(12)', evidence_ref: ['EV_检查记录'] },
      { id: 'M_严重缺陷数', label: '近12月严重缺陷数', source_type: 'computed', metric_family: 'aggregate', aggregation: 'sum', source: '检查记录.严重缺陷数', filter: '检查日期 >= monthsAgo(12)', evidence_ref: ['EV_检查记录'] },
    ],
    formulas: [{ id: 'F_风险指数', label: '风险指数', type: 'weighted_sum', expression: 'M_飞检次数 * 10 + M_缺陷总数 * 2 + M_严重缺陷数 * 15' }],
    rules: [
      { id: 'R-LEVEL-D', label: '高风险', when: 'F_风险指数 >= 50 OR M_严重缺陷数 >= 1', then: [{ conclusion_type: 'grade', value: 'D' }], priority: 100, evidence_ref: ['EV_检查记录'] },
      { id: 'R-LEVEL-C', label: '中高风险', when: 'F_风险指数 >= 30', then: [{ conclusion_type: 'grade', value: 'C' }], priority: 75 },
      { id: 'R-LEVEL-B', label: '中风险', when: 'F_风险指数 >= 10', then: [{ conclusion_type: 'grade', value: 'B' }], priority: 50 },
      { id: 'R-LEVEL-A', label: '低风险', when: 'F_风险指数 >= 0', then: [{ conclusion_type: 'grade', value: 'A' }], priority: 25 },
    ],
    conflict_policy: { strategy: 'most_severe' },
    evidence_policy: { require_evidence_ref: true, default_status: '待人工确认', completeness_metric: true, no_auto_conclude_when_incomplete: true },
  },
  sample: {
    subject: { 企业类型: '批发' },
    related: {
      检查记录: [
        { id: 'r1', 检查类型: '飞检', 检查日期: '2026-05-01', 缺陷数: 5, 严重缺陷数: 1 },
        { id: 'r2', 检查类型: '飞检', 检查日期: '2026-03-10', 缺陷数: 3, 严重缺陷数: 0 },
        { id: 'r3', 检查类型: '日常', 检查日期: '2026-04-01', 缺陷数: 2, 严重缺陷数: 0 },
      ],
    },
  },
};

export const RULE_TEMPLATES: RuleTemplate[] = [药监];

/** 模板元数据（列表用，不含完整 rulePack/sample，轻量） */
export function listTemplateMeta() {
  return RULE_TEMPLATES.map(({ id, name, industryTag, description }) => ({ id, name, industryTag, description }));
}

export function findTemplate(id: string): RuleTemplate | undefined {
  return RULE_TEMPLATES.find((t) => t.id === id);
}
