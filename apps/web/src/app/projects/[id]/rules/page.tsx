'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import NavBar from '@/lib/nav-bar';
import { parseWeightedSum, serializeWeightedSum, parseConditions, serializeConditions } from '@/lib/expr-blocks';

// ── 类型（与后端 rule-pack.types 对齐，前端只用到的子集）──
interface Rule { id: string; label?: string; when: string; then: { conclusion_type: string; value: string }[]; priority?: number; evidence_ref?: string[] }
interface Formula { id: string; label?: string; type: string; expression: string }
interface RulePack {
  meta: { name: string; version: string; project_id: string; industry_tag?: string; enabled: boolean };
  data_bindings: { entity: string; fields: string[] }[];
  metrics: any[];
  formulas: Formula[];
  rules: Rule[];
  conflict_policy: { strategy: string };
  evidence_policy: any;
}
interface InspRow { id: string; 检查类型: string; 检查日期: string; 缺陷数: number; 严重缺陷数: number }
interface TrialResult {
  ruleEngineEnabled: boolean;
  metrics: { id: string; label: string; value: any; evidenceComplete: boolean }[];
  formulas: Record<string, number | null>;
  finalConclusions: { conclusion_type: string; value: string; ruleId: string }[];
  evidenceCompleteness: number;
  needsVerification: boolean;
  status: string;
  evidenceChain: string[];
}

// ── 行业模板起手（药监风险画像，无已存规则包时用；可被真实模板替换）──
const STARTER_PACK: RulePack = {
  meta: { name: '药监风险画像', version: '1.0', project_id: '', industry_tag: '药监', enabled: true },
  data_bindings: [
    { entity: '企业', fields: ['企业类型'] },
    { entity: '检查记录', fields: ['检查类型', '检查日期', '缺陷数', '严重缺陷数'] },
  ],
  metrics: [
    { id: 'M_飞检次数', label: '近12月飞检次数', source_type: 'computed', aggregation: 'count', source: '检查记录.检查类型', filter: "检查类型 = '飞检' AND 检查日期 >= monthsAgo(12)", evidence_ref: ['EV_检查记录'] },
    { id: 'M_缺陷总数', label: '近12月缺陷总数', source_type: 'computed', aggregation: 'sum', source: '检查记录.缺陷数', filter: '检查日期 >= monthsAgo(12)', evidence_ref: ['EV_检查记录'] },
    { id: 'M_严重缺陷数', label: '近12月严重缺陷数', source_type: 'computed', aggregation: 'sum', source: '检查记录.严重缺陷数', filter: '检查日期 >= monthsAgo(12)', evidence_ref: ['EV_检查记录'] },
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
};

const STARTER_ROWS: InspRow[] = [
  { id: 'r1', 检查类型: '飞检', 检查日期: '2026-05-01', 缺陷数: 5, 严重缺陷数: 1 },
  { id: 'r2', 检查类型: '飞检', 检查日期: '2026-03-10', 缺陷数: 3, 严重缺陷数: 0 },
  { id: 'r3', 检查类型: '日常', 检查日期: '2026-04-01', 缺陷数: 2, 严重缺陷数: 0 },
];

const GRADE_STYLE: Record<string, string> = {
  D: 'bg-red-600 text-white', C: 'bg-amber-500 text-white', B: 'bg-blue-500 text-white', A: 'bg-green-600 text-white',
  预警: 'bg-red-600 text-white', 不通过: 'bg-red-600 text-white', 通过: 'bg-green-600 text-white',
};

const today = () => new Date().toISOString().slice(0, 10);

export default function RulesConfigPage() {
  const params = useParams();
  const projectId = params.id as string;

  const [pack, setPack] = useState<RulePack>(STARTER_PACK);
  const [rows, setRows] = useState<InspRow[]>(STARTER_ROWS);
  const [result, setResult] = useState<TrialResult | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounce = useRef<any>(null);

  // 载入已存规则包（无则用行业模板）
  useEffect(() => {
    api.get(`/api/projects/${projectId}/rule-pack`).then((r) => {
      if (r?.rulePack) setPack(r.rulePack);
    }).catch(() => {});
  }, [projectId]);

  // 即时试算：pack / 样例变 → 防抖 400ms → 跑引擎
  const runTrial = useCallback((p: RulePack, sampleRows: InspRow[]) => {
    setCalculating(true);
    const sample = { subject: { 企业类型: '批发' }, related: { 检查记录: sampleRows }, manualInputs: {} };
    api.post(`/api/projects/${projectId}/rule-pack/trial`, { rulePack: p, sample, now: today() })
      .then((r) => { setResult(r); setError(null); })
      .catch((e) => setError(e?.message || '试算失败'))
      .finally(() => setCalculating(false));
  }, [projectId]);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => runTrial(pack, rows), 400);
    return () => debounce.current && clearTimeout(debounce.current);
  }, [pack, rows, runTrial]);

  const setRow = (i: number, key: keyof InspRow, val: any) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [key]: val } : r)));
  const addRow = () => setRows((rs) => [...rs, { id: `r${Date.now()}`, 检查类型: '日常', 检查日期: today(), 缺陷数: 0, 严重缺陷数: 0 }]);
  const delRow = (i: number) => setRows((rs) => rs.filter((_, j) => j !== i));
  const setRuleWhen = (i: number, when: string) =>
    setPack((p) => ({ ...p, rules: p.rules.map((r, j) => (j === i ? { ...r, when } : r)) }));
  const setFormulaExpr = (i: number, expression: string) =>
    setPack((p) => ({ ...p, formulas: p.formulas.map((f, j) => (j === i ? { ...f, expression } : f)) }));

  // 可选积木：可引用的指标/公式（下拉用）
  const refs = [
    ...pack.metrics.map((m: any) => ({ id: m.id, label: m.label || m.id })),
    ...pack.formulas.map((f) => ({ id: f.id, label: f.label || f.id })),
  ];
  // 公式权重积木：改一项权重/指标 → 重新序列化回 expression
  const patchWeightTerm = (fi: number, ti: number, patch: Partial<{ ref: string; weight: number }>) => {
    const ws = parseWeightedSum(pack.formulas[fi].expression);
    setFormulaExpr(fi, serializeWeightedSum(ws.terms.map((t, j) => (j === ti ? { ...t, ...patch } : t))));
  };
  const addWeightTerm = (fi: number) => {
    const ws = parseWeightedSum(pack.formulas[fi].expression);
    setFormulaExpr(fi, serializeWeightedSum([...ws.terms, { ref: refs[0]?.id || 'M_x', weight: 1 }]));
  };
  const delWeightTerm = (fi: number, ti: number) => {
    const ws = parseWeightedSum(pack.formulas[fi].expression);
    setFormulaExpr(fi, serializeWeightedSum(ws.terms.filter((_, j) => j !== ti)));
  };
  // 规则条件积木：改一条条件/连接词 → 重新序列化回 when
  const patchCond = (ri: number, ci: number, patch: Partial<{ left: string; op: string; right: string }>) => {
    const c = parseConditions(pack.rules[ri].when);
    setRuleWhen(ri, serializeConditions(c.join, c.conds.map((x, j) => (j === ci ? { ...x, ...patch } : x))));
  };
  const setCondJoin = (ri: number, join: 'AND' | 'OR') => {
    const c = parseConditions(pack.rules[ri].when);
    setRuleWhen(ri, serializeConditions(join, c.conds));
  };
  const addCond = (ri: number) => {
    const c = parseConditions(pack.rules[ri].when);
    setRuleWhen(ri, serializeConditions(c.join, [...c.conds, { left: refs[0]?.id || 'F_x', op: '>=', right: '0' }]));
  };
  const delCond = (ri: number, ci: number) => {
    const c = parseConditions(pack.rules[ri].when);
    setRuleWhen(ri, serializeConditions(c.join, c.conds.filter((_, j) => j !== ci)));
  };

  const save = () => {
    const toSave = { ...pack, meta: { ...pack.meta, project_id: projectId } };
    api.put(`/api/projects/${projectId}/rule-pack`, { rulePack: toSave })
      .then(() => { setSaved(true); setTimeout(() => setSaved(false), 2000); })
      .catch((e) => setError(e?.message || '保存失败'));
  };

  const grade = result?.finalConclusions?.[0]?.value;
  const riskScore = result?.formulas?.['F_风险指数'];

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar />
      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900">规则配置 · 即时试算</h1>
            <p className="text-sm text-gray-500 mt-0.5">{pack.meta.name}（{pack.meta.industry_tag}）— 改阈值/权重/样例，右侧结论实时变（像 Excel）</p>
          </div>
          <button onClick={save} className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">
            {saved ? '✓ 已保存' : '保存规则包'}
          </button>
        </div>

        {error && <div className="mb-4 px-4 py-2 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>}

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
          {/* 左：编辑区 */}
          <div className="lg:col-span-3 space-y-5">
            {/* 样例案例 */}
            <section className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-2">
                <h2 className="font-semibold text-gray-800">样例案例 · 一家企业的检查记录</h2>
                <button onClick={addRow} className="text-xs px-2 py-1 rounded bg-gray-100 hover:bg-gray-200">+ 加一条</button>
              </div>
              <table className="w-full text-sm">
                <thead><tr className="text-left text-gray-400 text-xs">
                  <th className="py-1">检查类型</th><th>检查日期</th><th className="w-20">缺陷数</th><th className="w-20">严重缺陷</th><th></th>
                </tr></thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.id} className="border-t border-gray-100">
                      <td className="py-1">
                        <select value={r.检查类型} onChange={(e) => setRow(i, '检查类型', e.target.value)} className="border rounded px-1 py-0.5">
                          <option>飞检</option><option>日常</option><option>专项</option>
                        </select>
                      </td>
                      <td><input value={r.检查日期} onChange={(e) => setRow(i, '检查日期', e.target.value)} className="border rounded px-1 py-0.5 w-28" /></td>
                      <td><input type="number" value={r.缺陷数} onChange={(e) => setRow(i, '缺陷数', Number(e.target.value))} className="border rounded px-1 py-0.5 w-16" /></td>
                      <td><input type="number" value={r.严重缺陷数} onChange={(e) => setRow(i, '严重缺陷数', Number(e.target.value))} className="border rounded px-1 py-0.5 w-16" /></td>
                      <td><button onClick={() => delRow(i)} className="text-gray-300 hover:text-red-500">✕</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-xs text-gray-400 mt-2">试试把某条的「严重缺陷」从 0 改成 1 —— 右侧分级会立刻跳变。</p>
            </section>

            {/* 公式（权重积木：选指标 + 调权重；解析不了则回退文本） */}
            <section className="bg-white rounded-xl border border-gray-200 p-4">
              <h2 className="font-semibold text-gray-800 mb-2">评分公式</h2>
              {pack.formulas.map((f, i) => {
                const ws = parseWeightedSum(f.expression);
                return (
                  <div key={f.id} className="mb-3">
                    <label className="text-xs text-gray-500">{f.label || f.id} = 各项加权和</label>
                    {ws.ok ? (
                      <div className="mt-1 space-y-1">
                        {ws.terms.map((t, ti) => (
                          <div key={ti} className="flex items-center gap-2">
                            <select value={t.ref} onChange={(e) => patchWeightTerm(i, ti, { ref: e.target.value })} className="border rounded px-1 py-1 text-sm flex-1">
                              {refs.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                            </select>
                            <span className="text-gray-400 text-sm">× 权重</span>
                            <input type="number" value={t.weight} onChange={(e) => patchWeightTerm(i, ti, { weight: Number(e.target.value) })} className="border rounded px-1 py-1 text-sm w-20" />
                            <button onClick={() => delWeightTerm(i, ti)} className="text-gray-300 hover:text-red-500">✕</button>
                          </div>
                        ))}
                        <button onClick={() => addWeightTerm(i)} className="text-xs px-2 py-1 rounded bg-gray-100 hover:bg-gray-200">+ 加一项</button>
                      </div>
                    ) : (
                      <input value={f.expression} onChange={(e) => setFormulaExpr(i, e.target.value)} className="w-full border rounded px-2 py-1 text-sm font-mono" />
                    )}
                  </div>
                );
              })}
            </section>

            {/* 规则 */}
            <section className="bg-white rounded-xl border border-gray-200 p-4">
              <h2 className="font-semibold text-gray-800 mb-2">分级规则（裁决：{pack.conflict_policy.strategy === 'most_severe' ? '取最严' : pack.conflict_policy.strategy}）</h2>
              {pack.rules.map((r, i) => {
                const c = parseConditions(r.when);
                return (
                  <div key={r.id} className="flex items-start gap-2 mb-3">
                    <span className={`mt-1 text-xs px-2 py-0.5 rounded font-bold ${GRADE_STYLE[r.then[0]?.value] || 'bg-gray-200'}`}>{r.then[0]?.value}</span>
                    <span className="mt-1.5 text-xs text-gray-400">当</span>
                    {c.ok ? (
                      <div className="flex-1 space-y-1">
                        {c.conds.map((cond, ci) => (
                          <div key={ci} className="flex items-center gap-1">
                            {ci > 0 && (
                              <select value={c.join} onChange={(e) => setCondJoin(i, e.target.value as 'AND' | 'OR')} className="border rounded px-1 py-1 text-xs">
                                <option value="AND">且</option><option value="OR">或</option>
                              </select>
                            )}
                            <select value={cond.left} onChange={(e) => patchCond(i, ci, { left: e.target.value })} className="border rounded px-1 py-1 text-sm flex-1">
                              {refs.map((rf) => <option key={rf.id} value={rf.id}>{rf.label}</option>)}
                            </select>
                            <select value={cond.op} onChange={(e) => patchCond(i, ci, { op: e.target.value })} className="border rounded px-1 py-1 text-sm">
                              {['>=', '>', '<=', '<', '=', '!='].map((o) => <option key={o} value={o}>{o}</option>)}
                            </select>
                            <input value={cond.right} onChange={(e) => patchCond(i, ci, { right: e.target.value })} className="border rounded px-1 py-1 text-sm w-20" />
                            <button onClick={() => delCond(i, ci)} className="text-gray-300 hover:text-red-500">✕</button>
                          </div>
                        ))}
                        <button onClick={() => addCond(i)} className="text-xs px-2 py-1 rounded bg-gray-100 hover:bg-gray-200">+ 加条件</button>
                      </div>
                    ) : (
                      <input value={r.when} onChange={(e) => setRuleWhen(i, e.target.value)} className="flex-1 border rounded px-2 py-1 text-sm font-mono" />
                    )}
                  </div>
                );
              })}
              <p className="text-xs text-gray-400 mt-1">从指标/公式里选、配比较和阈值搭出条件；复杂条件（含括号/混合且或）自动回退为表达式编辑，不会注入。</p>
            </section>
          </div>

          {/* 右：即时试算结果（粘性） */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-xl border border-gray-200 p-5 sticky top-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-gray-800">试算结果</h2>
                <span className={`text-xs ${calculating ? 'text-indigo-500' : 'text-gray-300'}`}>{calculating ? '计算中…' : '已同步'}</span>
              </div>

              <div className="flex items-center gap-4 mb-4">
                <div className={`w-20 h-20 rounded-2xl flex items-center justify-center text-4xl font-extrabold ${GRADE_STYLE[grade || ''] || 'bg-gray-100 text-gray-300'}`}>
                  {grade || '—'}
                </div>
                <div>
                  <div className="text-xs text-gray-400">风险指数</div>
                  <div className="text-3xl font-bold text-gray-900">{riskScore ?? '—'}</div>
                  <div className="mt-1">
                    <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600">{result?.status || '—'}</span>
                  </div>
                </div>
              </div>

              {result?.needsVerification && (
                <div className="mb-3 px-3 py-2 rounded-lg bg-amber-50 text-amber-700 text-xs">
                  ⚠ 关键证据缺失 → 待核实，绝不自动下结论
                </div>
              )}

              <div className="mb-3">
                <div className="text-xs text-gray-400 mb-1">指标</div>
                {result?.metrics?.map((m) => (
                  <div key={m.id} className="flex justify-between text-sm py-0.5">
                    <span className="text-gray-600">{m.label}</span>
                    <span className={`font-mono ${m.evidenceComplete ? 'text-gray-900' : 'text-amber-600'}`}>{String(m.value)}</span>
                  </div>
                ))}
              </div>

              <div className="border-t border-gray-100 pt-2">
                <div className="text-xs text-gray-400 mb-1">证据链（{Math.round((result?.evidenceCompleteness ?? 0) * 100)}% 完整）</div>
                <div className="flex flex-wrap gap-1">
                  {(result?.evidenceChain || []).map((e) => (
                    <span key={e} className="text-xs px-2 py-0.5 rounded bg-indigo-50 text-indigo-600">{e}</span>
                  ))}
                  {(!result?.evidenceChain || result.evidenceChain.length === 0) && <span className="text-xs text-gray-300">无</span>}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
