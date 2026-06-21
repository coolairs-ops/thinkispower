import { Injectable, Logger } from '@nestjs/common';
import { evaluate, evaluateBool, EvalError, ExprValue } from './rule-expr';
import {
  RulePack, Metric, Rule, RuleConclusion, RuleDataContext,
  MetricResult, ConclusionResult, RuleEvalResult,
} from './rule-pack.types';

/**
 * 通用规则执行引擎（RulePack v1.3 的 schema 第 202 行 `_engine_execution_order` 八步）。
 *
 * 定位（见工程交接说明 形态B）：BackendRuntime 的**标准内置服务**——任何被生成的后端都能调，
 * 加载对应行业规则包就能跑"风险评分/分级/审批判断"，规则是**配置数据**不是手写代码（守护天然覆盖）。
 *
 * 确定性、零 LLM。受限表达式经 rule-expr 安全求值（不 eval、不注入）。
 * v1 工程范围：aggregate 族全做 + temporal 只做 trend + as_of 仅当前时点（见 schema _v1_scope_note）。
 */
@Injectable()
export class RuleEngineService {
  private readonly logger = new Logger(RuleEngineService.name);

  /**
   * 对一个对象（如一家企业）跑规则包，产出 结论 + 证据链 + 待确认状态。
   * @param now 当前时点（ISO 日期），默认系统当前；显式传入便于确定性测试与 as_of 回溯。
   */
  evaluate(pack: RulePack, ctx: RuleDataContext, now: string = new Date().toISOString().slice(0, 10)): RuleEvalResult {
    const asOf = pack.as_of || now;

    // 步骤1：加载（enabled=false → 本项目无任何规则产物，纯 CRUD）
    if (!pack.meta.enabled) {
      return {
        ruleEngineEnabled: false, metrics: [], formulas: {}, hits: [], finalConclusions: [],
        evidenceCompleteness: 1, needsVerification: false, status: '待人工确认', evidenceChain: [], asOf,
      };
    }

    // 步骤2+3：取数 + 算指标（含证据回指）
    const metrics = pack.metrics.map((m) => this.computeMetric(m, ctx, now));
    const metricVals: Record<string, ExprValue> = {};
    for (const r of metrics) metricVals[r.id] = r.value;

    // 步骤4：算公式（按声明顺序求值，允许引用已算出的公式）
    const formulas: Record<string, number | null> = {};
    for (const f of pack.formulas) {
      try {
        const v = evaluate(f.expression, { vars: { ...metricVals, ...formulas } });
        formulas[f.id] = typeof v === 'number' ? v : Number(v);
      } catch (e) {
        formulas[f.id] = null;
        this.logger.warn(`公式 ${f.id} 求值失败（标空，不崩链）: ${e instanceof EvalError ? e.message : e}`);
      }
    }

    // 步骤5：评规则 → 全部命中结论
    const scope = { vars: { ...metricVals, ...formulas } as Record<string, ExprValue> };
    const hits: ConclusionResult[] = [];
    for (const rule of pack.rules) {
      if (!this.ruleActive(rule, asOf)) continue;
      let when = false;
      try { when = evaluateBool(rule.when, scope); }
      catch (e) { this.logger.warn(`规则 ${rule.id} 条件求值失败（视为不命中）: ${e instanceof EvalError ? e.message : e}`); continue; }
      if (!when) continue;
      for (const c of rule.then) hits.push(this.toConclusion(rule, c, scope));
    }

    // 步骤6：按 conflict_policy 裁决
    const finalConclusions = this.resolveConflicts(hits, pack.conflict_policy.strategy);

    // 步骤7：套 evidence_policy（绑证据、算完整度、缺证据标待核实、整体待人工确认）
    const requiringMetrics = metrics; // 每个指标都应回指证据（policy.require_evidence_ref=true）
    const completeCount = requiringMetrics.filter((m) => m.evidenceComplete).length;
    const evidenceCompleteness = requiringMetrics.length ? completeCount / requiringMetrics.length : 1;
    const needsVerification = pack.evidence_policy.no_auto_conclude_when_incomplete && evidenceCompleteness < 1;
    const evidenceChain = [...new Set([
      ...metrics.flatMap((m) => m.evidenceRefs),
      ...finalConclusions.flatMap((c) => c.evidenceRefs),
    ])];

    // 步骤8：输出
    return {
      ruleEngineEnabled: true, metrics, formulas, hits, finalConclusions,
      evidenceCompleteness, needsVerification, status: '待人工确认', evidenceChain, asOf,
    };
  }

  // ─── 步骤3：指标 ───

  private computeMetric(m: Metric, ctx: RuleDataContext, now: string): MetricResult {
    const evidenceRefs = m.evidence_ref ?? [];
    const base = { id: m.id, label: m.label, evidenceRefs, evidenceComplete: evidenceRefs.length > 0 };

    if (m.source_type === 'manual') {
      const v = ctx.manualInputs?.[m.id];
      return { ...base, value: v ?? null, note: v == null ? '人工录入值缺失（待录入）' : undefined, evidenceComplete: base.evidenceComplete && v != null };
    }
    if (m.source_type === 'external') {
      return { ...base, value: null, note: 'external 外部取值为 v2 预留能力', evidenceComplete: false };
    }
    // computed
    const family = m.metric_family ?? 'aggregate';
    const [entity, field] = (m.source ?? '').split('.');
    const rows = (entity && ctx.related[entity]) || [];
    if (!entity) return { ...base, value: null, note: 'source 未指定', evidenceComplete: false };

    if (family === 'temporal') {
      if (m.temporal_op && m.temporal_op !== 'trend') {
        return { ...base, value: null, note: `temporal.${m.temporal_op} 为 v2 能力（v1 只实做 trend）` };
      }
      const series = this.filtered(rows, m.filter, now).map((r) => this.numField(r, field)).filter((x): x is number => x != null);
      return { ...base, value: this.trend(series) };
    }

    // aggregate
    const filtered = this.filtered(rows, m.filter, now);
    const allRows = rows;
    const value = this.aggregate(m, filtered, allRows, field);
    const missing = value == null;
    return { ...base, value, note: missing ? `聚合 ${m.aggregation} 无可用数据` : undefined, evidenceComplete: base.evidenceComplete && !missing };
  }

  /** 行过滤：对每行按 filter 受限布尔表达式求值；filter 可用 monthsAgo/daysAgo（相对 now）。 */
  private filtered(rows: Array<Record<string, unknown>>, filter: string | undefined, now: string): Array<Record<string, unknown>> {
    if (!filter) return rows;
    const funcs = { monthsAgo: (n: ExprValue) => shiftDate(now, 0, -Number(n)), daysAgo: (n: ExprValue) => shiftDate(now, -Number(n), 0) };
    return rows.filter((row) => {
      try { return evaluateBool(filter, { vars: row as Record<string, ExprValue>, funcs }); }
      catch (e) { this.logger.warn(`filter 求值失败（该行视为不通过）: ${e instanceof EvalError ? e.message : e}`); return false; }
    });
  }

  private aggregate(m: Metric, filtered: Array<Record<string, unknown>>, allRows: Array<Record<string, unknown>>, field: string): number | null {
    const nums = () => filtered.map((r) => this.numField(r, field)).filter((x): x is number => x != null);
    switch (m.aggregation) {
      case 'count': return filtered.length;
      case 'sum': return nums().reduce((s, x) => s + x, 0);
      case 'avg': { const a = nums(); return a.length ? a.reduce((s, x) => s + x, 0) / a.length : null; }
      case 'min': { const a = nums(); return a.length ? Math.min(...a) : null; }
      case 'max': { const a = nums(); return a.length ? Math.max(...a) : null; }
      case 'ratio': return allRows.length ? filtered.length / allRows.length : null; // 通过过滤行 / 全部行
      case 'latest': { const r = filtered[filtered.length - 1]; return r ? this.numField(r, field) : null; } // 按取数顺序（建议按时间排序）
      case 'earliest': { const r = filtered[0]; return r ? this.numField(r, field) : null; }
      case 'last_n': return null; // 需 N 参数（schema 未含字段），v1 未实做
      default: return filtered.length; // 缺 aggregation 退化为 count
    }
  }

  /** 趋势判定（v1 temporal 唯一实做）：单调升→'升'、单调降→'降'、否则'平'。按取数顺序。 */
  private trend(series: number[]): string {
    if (series.length < 2) return '平';
    let up = true, down = true;
    for (let i = 1; i < series.length; i++) {
      if (series[i] < series[i - 1]) up = false;
      if (series[i] > series[i - 1]) down = false;
    }
    if (up && series[series.length - 1] > series[0]) return '升';
    if (down && series[series.length - 1] < series[0]) return '降';
    return '平';
  }

  private numField(row: Record<string, unknown>, field: string): number | null {
    const v = row[field];
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))) return Number(v);
    return null;
  }

  // ─── 步骤5/6：规则与裁决 ───

  /** 补丁6：as-of 有效性。v1 用当前 asOf 判生效区间；effective_from/to 空=不限。 */
  private ruleActive(rule: Rule, asOf: string): boolean {
    if (rule.effective_from && asOf < rule.effective_from) return false;
    if (rule.effective_to && asOf > rule.effective_to) return false;
    return true;
  }

  private toConclusion(rule: Rule, c: RuleConclusion, scope: { vars: Record<string, ExprValue> }): ConclusionResult {
    let value: string | number = c.value;
    if (c.conclusion_type === 'assign') {
      // assign 的 value 可为表达式（如 月收入*8）；纯字面量则原样
      try { const v = evaluate(c.value, scope); value = typeof v === 'number' ? v : String(v); }
      catch { value = c.value; }
    }
    return {
      conclusion_type: c.conclusion_type, value, ruleId: rule.id, ruleLabel: rule.label,
      isVeto: !!rule.is_veto, priority: rule.priority ?? 50, evidenceRefs: rule.evidence_ref ?? [],
    };
  }

  /**
   * 补丁2：冲突裁决。priority 作"严重度/优先级"的统一代理（规则作者用 priority 编码 D>C>B>A 等严重度）。
   * - veto_first：任一 is_veto 命中 → 取全部否决结论；否则取最高 priority。
   * - most_severe / by_priority：取最高 priority 的结论（most_severe 约定 priority 越大越严）。
   * - weighted：v1 简化为按 priority（加权综合留待 v2 明确语义）。
   */
  private resolveConflicts(hits: ConclusionResult[], strategy: string): ConclusionResult[] {
    if (hits.length === 0) return [];
    if (strategy === 'veto_first') {
      const vetoes = hits.filter((h) => h.isVeto);
      if (vetoes.length) return vetoes;
    }
    const maxPriority = Math.max(...hits.map((h) => h.priority));
    return hits.filter((h) => h.priority === maxPriority);
  }
}

/** now(YYYY-MM-DD) 偏移若干天/月，返回 ISO 日期串。供 filter 的 monthsAgo/daysAgo。 */
function shiftDate(now: string, days: number, months: number): string {
  const d = new Date(now + 'T00:00:00Z');
  if (months) d.setUTCMonth(d.getUTCMonth() + months);
  if (days) d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
