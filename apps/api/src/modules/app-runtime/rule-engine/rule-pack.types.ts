/**
 * 通用规则包 RulePack 类型（镜像 rulepack.schema.json v1.3，六行业验证封版）。
 *
 * 四层结构：data_bindings（引平台已生成实体/字段）→ metrics（指标）→ formulas（公式）→ rules（规则），
 * 加 conflict_policy（裁决）+ evidence_policy（证据/人工确认贯穿线）。
 * 配置界面据此生成录入表单；执行引擎据此解析执行；守护据此体检——三方共用此地基。
 *
 * v1 工程范围（见 _v1_scope_note）：aggregate 族全做；temporal 只做 trend；as_of 只当前时点；
 * formula matrix_lookup 留 v2。schema 已留好 v2 位置，扩展不改地基。
 */

export type MetricSourceType = 'computed' | 'manual' | 'external';
export type MetricFamily = 'aggregate' | 'temporal';
export type Aggregation = 'count' | 'sum' | 'avg' | 'ratio' | 'min' | 'max' | 'latest' | 'earliest' | 'last_n';
export type TemporalOp = 'trend' | 'slope' | 'yoy' | 'mom' | 'diff'; // v1 只实做 trend
export type FormulaType = 'weighted_sum' | 'normalize' | 'product' | 'piecewise';
export type ConclusionType = 'grade' | 'decision' | 'assign';
export type ConflictStrategy = 'most_severe' | 'veto_first' | 'by_priority' | 'weighted';

export interface RulePackMeta {
  name: string;
  version: string;
  project_id: string;
  industry_tag?: string;
  /** 开关绑在项目上：false = 该项目根本不生成任何规则产物，保持纯 CRUD */
  enabled: boolean;
}

export interface DataBinding {
  entity: string;
  fields: string[];
}

export interface ManualSpec {
  input_role: string;
  scoring_standard: string;
  value_range?: string;
}

export interface Metric {
  /** 约定 M_ 前缀，供公式/规则引用 */
  id: string;
  label: string;
  source_type: MetricSourceType;
  metric_family?: MetricFamily; // 默认 aggregate
  aggregation?: Aggregation; // family=aggregate & computed 时必填
  temporal_op?: TemporalOp; // family=temporal 时必填
  /** 作用的 实体.字段，如 检查记录.缺陷数 */
  source?: string;
  /** 可选过滤（含时间窗），受限布尔表达式，对该实体每行求值 */
  filter?: string;
  manual_spec?: ManualSpec; // source_type=manual 时必填
  evidence_ref?: string[];
}

export interface Formula {
  /** 约定 F_ 前缀 */
  id: string;
  label?: string;
  type: FormulaType;
  /** 受限表达式：只引用已定义 metric/formula id，只用 + - * / 和白名单函数。禁止任意脚本 */
  expression: string;
  output_kind?: 'number';
}

export interface RuleConclusion {
  conclusion_type: ConclusionType;
  /** 结论内容；assign 类型可为表达式 */
  value: string;
}

export interface Rule {
  /** 约定 R 前缀，如 R-LEVEL-D-001 */
  id: string;
  label?: string;
  /** 条件表达式：引用 metric/formula，比较符 + AND/OR 组合 */
  when: string;
  /** 补丁1：一条规则可同时给多个结论 */
  then: RuleConclusion[];
  priority?: number; // 默认 50
  is_veto?: boolean; // 补丁3：一票否决，命中即定、先于打分
  effective_from?: string | null; // 补丁6：as-of 计算用，空=一直有效
  effective_to?: string | null;
  evidence_ref?: string[];
}

export interface ConflictPolicy {
  strategy: ConflictStrategy;
}

export interface EvidencePolicy {
  require_evidence_ref: true;
  default_status: '待人工确认';
  completeness_metric?: boolean;
  no_auto_conclude_when_incomplete: true;
}

export interface RulePack {
  meta: RulePackMeta;
  data_bindings: DataBinding[];
  metrics: Metric[];
  formulas: Formula[];
  rules: Rule[];
  conflict_policy: ConflictPolicy;
  evidence_policy: EvidencePolicy;
  /** 补丁6：执行时点。空=当前时点用当前规则；历史日期=回溯选当时有效规则（回溯重算为 v2） */
  as_of?: string | null;
}

// ─── 引擎输入/输出 ───

/** 引擎取数上下文：实体名 → 该对象相关行（CRUD list 的自然形状）。manual 指标值另由 manualInputs 提供。 */
export interface RuleDataContext {
  /** 目标对象本身的字段（如一家企业的属性） */
  subject: Record<string, unknown>;
  /** 各绑定实体的相关行集合（如该企业的全部检查记录），供 aggregate/temporal 取数 */
  related: Record<string, Array<Record<string, unknown>>>;
  /** source_type=manual 指标的人工录入值：metricId → value */
  manualInputs?: Record<string, number>;
}

export interface MetricResult {
  id: string;
  label: string;
  value: number | string | null;
  /** 未实现/缺数据时的说明（如 v2 能力、证据缺失） */
  note?: string;
  evidenceRefs: string[];
  /** 该指标依赖的证据是否齐全（用于 evidence_policy 完整度） */
  evidenceComplete: boolean;
}

export interface ConclusionResult {
  conclusion_type: ConclusionType;
  value: string | number;
  ruleId: string;
  ruleLabel?: string;
  isVeto: boolean;
  priority: number;
  evidenceRefs: string[];
}

export interface RuleEvalResult {
  /** 本项目未启用规则引擎（enabled=false）→ 引擎不产出任何规则结论 */
  ruleEngineEnabled: boolean;
  metrics: MetricResult[];
  /** 公式 id → 数值 */
  formulas: Record<string, number | null>;
  /** 全部命中的候选结论（裁决前） */
  hits: ConclusionResult[];
  /** conflict_policy 裁决后的最终结论 */
  finalConclusions: ConclusionResult[];
  /** evidence_policy：证据完整度 = 已绑定/应绑定 */
  evidenceCompleteness: number;
  /** 关键证据缺失 → 待核实，绝不自动下结论 */
  needsVerification: boolean;
  /** 所有结论默认待人工确认 */
  status: '待人工确认';
  /** 去重后的证据链 */
  evidenceChain: string[];
  asOf: string | null;
}
