'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import NavBar from '@/lib/nav-bar';
import { parseWeightedSum, serializeWeightedSum, parseConditions, serializeConditions } from '@/lib/expr-blocks';

// ── 类型（与后端 rule-pack.types 对齐的前端子集）──
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
type Row = Record<string, any>;
interface Sample { subject: Row; related: Record<string, Row[]>; manualInputs?: Record<string, number> }
interface TemplateMeta { id: string; name: string; industryTag: string; description: string }
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

const GRADE_STYLE: Record<string, string> = {
  D: 'bg-red-600 text-white', C: 'bg-amber-500 text-white', B: 'bg-blue-500 text-white', A: 'bg-green-600 text-white',
  预警: 'bg-red-600 text-white', 不通过: 'bg-red-600 text-white', 通过: 'bg-green-600 text-white',
};
const today = () => new Date().toISOString().slice(0, 10);

export default function RulesConfigPage() {
  const params = useParams();
  const projectId = params.id as string;

  const [templates, setTemplates] = useState<TemplateMeta[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [pack, setPack] = useState<RulePack | null>(null);
  const [sample, setSample] = useState<Sample>({ subject: {}, related: {} });
  const [result, setResult] = useState<TrialResult | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounce = useRef<any>(null);

  const loadTemplate = useCallback(async (id: string) => {
    const t = await api.get(`/api/rule-templates/${id}`).catch(() => null);
    if (!t?.rulePack) return;
    setPack(t.rulePack);
    setSample(t.sample || { subject: {}, related: {} });
    setSelectedId(id);
  }, []);

  // 载入：已存规则包优先；否则用行业模板库第一个起手
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const tplRes = await api.get('/api/rule-templates').catch(() => ({ templates: [] }));
      const tpls: TemplateMeta[] = tplRes?.templates || [];
      if (cancelled) return;
      setTemplates(tpls);
      const savedPack = await api.get(`/api/projects/${projectId}/rule-pack`).catch(() => null);
      if (cancelled) return;
      if (savedPack?.rulePack) {
        setPack(savedPack.rulePack);
        const match = tpls.find((t) => t.industryTag === savedPack.rulePack.meta?.industry_tag) || tpls[0];
        if (match) { const full = await api.get(`/api/rule-templates/${match.id}`).catch(() => null); if (full && !cancelled) setSample(full.sample); }
      } else if (tpls[0]) {
        await loadTemplate(tpls[0].id);
      }
    })();
    return () => { cancelled = true; };
  }, [projectId, loadTemplate]);

  // 即时试算：pack / 样例变 → 防抖 → 跑引擎
  const runTrial = useCallback((p: RulePack, s: Sample) => {
    setCalculating(true);
    api.post(`/api/projects/${projectId}/rule-pack/trial`, { rulePack: p, sample: s, now: today() })
      .then((r) => { setResult(r); setError(null); })
      .catch((e) => setError(e?.message || '试算失败'))
      .finally(() => setCalculating(false));
  }, [projectId]);

  useEffect(() => {
    if (!pack) return;
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => runTrial(pack, sample), 400);
    return () => debounce.current && clearTimeout(debounce.current);
  }, [pack, sample, runTrial]);

  // ── 样例编辑（通用：subject + related，按 data_bindings 字段渲染）──
  const subjectEntity = pack?.data_bindings.find((b) => !(b.entity in sample.related))?.entity;
  const fieldsFor = (entity: string) =>
    pack?.data_bindings.find((b) => b.entity === entity)?.fields ?? Object.keys(sample.related[entity]?.[0] ?? {}).filter((k) => k !== 'id');
  const coerce = (entity: string, field: string, v: string) => {
    const ex = sample.related[entity]?.[0]?.[field];
    return typeof ex === 'number' ? Number(v) : v;
  };
  const setSubjectField = (field: string, v: any) => setSample((s) => ({ ...s, subject: { ...s.subject, [field]: v } }));
  const setCell = (entity: string, i: number, field: string, v: any) =>
    setSample((s) => ({ ...s, related: { ...s.related, [entity]: s.related[entity].map((r, j) => (j === i ? { ...r, [field]: v } : r)) } }));
  const addRow = (entity: string) => setSample((s) => {
    const fields = fieldsFor(entity);
    const blank: Row = { id: `r${Date.now()}` };
    for (const f of fields) blank[f] = typeof s.related[entity]?.[0]?.[f] === 'number' ? 0 : '';
    return { ...s, related: { ...s.related, [entity]: [...(s.related[entity] || []), blank] } };
  });
  const delRow = (entity: string, i: number) =>
    setSample((s) => ({ ...s, related: { ...s.related, [entity]: s.related[entity].filter((_, j) => j !== i) } }));

  // ── 规则/公式积木（不变）──
  const setFormulaExpr = (i: number, expression: string) => setPack((p) => p && ({ ...p, formulas: p.formulas.map((f, j) => (j === i ? { ...f, expression } : f)) }));
  const setRuleWhen = (i: number, when: string) => setPack((p) => p && ({ ...p, rules: p.rules.map((r, j) => (j === i ? { ...r, when } : r)) }));
  const refs = pack ? [...pack.metrics.map((m: any) => ({ id: m.id, label: m.label || m.id })), ...pack.formulas.map((f) => ({ id: f.id, label: f.label || f.id }))] : [];
  const patchWeightTerm = (fi: number, ti: number, patch: any) => { if (!pack) return; const ws = parseWeightedSum(pack.formulas[fi].expression); setFormulaExpr(fi, serializeWeightedSum(ws.terms.map((t, j) => (j === ti ? { ...t, ...patch } : t)))); };
  const addWeightTerm = (fi: number) => { if (!pack) return; const ws = parseWeightedSum(pack.formulas[fi].expression); setFormulaExpr(fi, serializeWeightedSum([...ws.terms, { ref: refs[0]?.id || 'M_x', weight: 1 }])); };
  const delWeightTerm = (fi: number, ti: number) => { if (!pack) return; const ws = parseWeightedSum(pack.formulas[fi].expression); setFormulaExpr(fi, serializeWeightedSum(ws.terms.filter((_, j) => j !== ti))); };
  const patchCond = (ri: number, ci: number, patch: any) => { if (!pack) return; const c = parseConditions(pack.rules[ri].when); setRuleWhen(ri, serializeConditions(c.join, c.conds.map((x, j) => (j === ci ? { ...x, ...patch } : x)))); };
  const setCondJoin = (ri: number, join: 'AND' | 'OR') => { if (!pack) return; const c = parseConditions(pack.rules[ri].when); setRuleWhen(ri, serializeConditions(join, c.conds)); };
  const addCond = (ri: number) => { if (!pack) return; const c = parseConditions(pack.rules[ri].when); setRuleWhen(ri, serializeConditions(c.join, [...c.conds, { left: refs[0]?.id || 'F_x', op: '>=', right: '0' }])); };
  const delCond = (ri: number, ci: number) => { if (!pack) return; const c = parseConditions(pack.rules[ri].when); setRuleWhen(ri, serializeConditions(c.join, c.conds.filter((_, j) => j !== ci))); };

  const save = () => {
    if (!pack) return;
    api.put(`/api/projects/${projectId}/rule-pack`, { rulePack: { ...pack, meta: { ...pack.meta, project_id: projectId } } })
      .then(() => { setSaved(true); setTimeout(() => setSaved(false), 2000); })
      .catch((e) => setError(e?.message || '保存失败'));
  };

  const grade = result?.finalConclusions?.[0]?.value;
  const scoreKey = pack?.formulas?.[0]?.id;
  const score = scoreKey ? result?.formulas?.[scoreKey] : undefined;

  if (!pack) return (<div className="min-h-screen bg-gray-50"><NavBar /><div className="max-w-6xl mx-auto px-4 py-10 text-gray-400">加载规则配置…</div></div>);

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar />
      <div className="max-w-6xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-4 gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-bold text-gray-900">规则配置 · 即时试算</h1>
            <p className="text-sm text-gray-500 mt-0.5">通用规则引擎 — 改阈值/权重/样例，右侧结论实时变（像 Excel）</p>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-400">行业模板</label>
            <select value={selectedId} onChange={(e) => loadTemplate(e.target.value)} className="border rounded-lg px-2 py-2 text-sm bg-white">
              <option value="" disabled>选择行业模板…</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <button onClick={save} className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">
              {saved ? '✓ 已保存' : '保存规则包'}
            </button>
          </div>
        </div>

        {error && <div className="mb-4 px-4 py-2 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>}

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
          {/* 左：编辑区 */}
          <div className="lg:col-span-3 space-y-5">
            {/* 样例案例（通用渲染） */}
            <section className="bg-white rounded-xl border border-gray-200 p-4">
              <h2 className="font-semibold text-gray-800 mb-2">样例案例 <span className="text-xs text-gray-400 font-normal">— 改一个数字，右侧分级立刻跳变</span></h2>
              {subjectEntity && (
                <div className="flex flex-wrap gap-3 mb-3">
                  {fieldsFor(subjectEntity).map((f) => (
                    <div key={f} className="flex items-center gap-1">
                      <label className="text-xs text-gray-500">{f}</label>
                      <input value={sample.subject[f] ?? ''} onChange={(e) => setSubjectField(f, coerce(subjectEntity, f, e.target.value))} className="border rounded px-1 py-1 text-sm w-28" />
                    </div>
                  ))}
                </div>
              )}
              {Object.keys(sample.related).map((entity) => (
                <div key={entity} className="mb-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-gray-600">{entity}</span>
                    <button onClick={() => addRow(entity)} className="text-xs px-2 py-1 rounded bg-gray-100 hover:bg-gray-200">+ 加一条</button>
                  </div>
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-gray-400 text-xs">
                      {fieldsFor(entity).map((f) => <th key={f} className="py-1 pr-2">{f}</th>)}<th></th>
                    </tr></thead>
                    <tbody>
                      {(sample.related[entity] || []).map((row, i) => (
                        <tr key={row.id ?? i} className="border-t border-gray-100">
                          {fieldsFor(entity).map((f) => (
                            <td key={f} className="py-1 pr-2">
                              <input type={typeof row[f] === 'number' ? 'number' : 'text'} value={row[f] ?? ''} onChange={(e) => setCell(entity, i, f, coerce(entity, f, e.target.value))} className="border rounded px-1 py-0.5 w-24" />
                            </td>
                          ))}
                          <td><button onClick={() => delRow(entity, i)} className="text-gray-300 hover:text-red-500">✕</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </section>

            {/* 公式（权重积木） */}
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

            {/* 规则（条件积木） */}
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
                <div className={`w-20 h-20 rounded-2xl flex items-center justify-center text-4xl font-extrabold ${GRADE_STYLE[grade || ''] || 'bg-gray-100 text-gray-300'}`}>{grade || '—'}</div>
                <div>
                  <div className="text-xs text-gray-400">{pack.formulas[0]?.label || '评分'}</div>
                  <div className="text-3xl font-bold text-gray-900">{score ?? '—'}</div>
                  <div className="mt-1"><span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600">{result?.status || '—'}</span></div>
                </div>
              </div>
              {result?.needsVerification && (
                <div className="mb-3 px-3 py-2 rounded-lg bg-amber-50 text-amber-700 text-xs">⚠ 关键证据缺失 → 待核实，绝不自动下结论</div>
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
                  {(result?.evidenceChain || []).map((e) => <span key={e} className="text-xs px-2 py-0.5 rounded bg-indigo-50 text-indigo-600">{e}</span>)}
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
