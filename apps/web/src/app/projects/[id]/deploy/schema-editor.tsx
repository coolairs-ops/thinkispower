'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';

/**
 * 页面 Schema 编辑面板（Schema 驱动 S4 前端）。
 * 改的是结构化 AppSchema（加删改块、改 bind），不碰 HTML；保存走 PUT .../demo/app-schema
 * （后端 coerceSchema 校验门 + renderSchema 重渲染 demoHtml）。bind 的资源/字段下拉只取数据契约
 * = 可引用、不臆造（前端先挡一道，后端校验门兜底）。
 */

const BLOCK_TYPES = ['kpi', 'table', 'detail', 'form', 'generate', 'richtext'] as const;
const BLOCK_LABEL: Record<string, string> = { kpi: '指标卡', table: '数据表格', detail: '详情', form: '表单', generate: '生成框', richtext: '富文本' };
const DATA_BLOCKS = new Set(['kpi', 'table', 'detail', 'form', 'generate']);

type Block = { type: string; bind?: { resource?: string; fields?: string[] }; props?: Record<string, any> };
type Page = { key: string; title: string; nav?: { icon?: string; label?: string }; blocks: Block[] };
type Schema = { appName: string; themeId?: string; pages: Page[] };
type Contract = { resources: { name: string; fields: string[] }[] };

export default function SchemaEditor({ projectId }: { projectId: string }) {
  const [schema, setSchema] = useState<Schema | null>(null);
  const [contract, setContract] = useState<Contract>({ resources: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true); setErr(null); setMsg(null);
    api.get(`/api/projects/${projectId}/demo/app-schema`)
      .then((r) => { setSchema(r.schema || null); setContract(r.contract || { resources: [] }); })
      .catch((e) => setErr(e?.message || '加载失败'))
      .finally(() => setLoading(false));
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  const mutate = (fn: (s: Schema) => void) => setSchema((prev) => { if (!prev) return prev; const next = structuredClone(prev); fn(next); return next; });
  const fieldsOf = (res?: string) => contract.resources.find((r) => r.name === res)?.fields ?? [];
  const firstResource = () => contract.resources[0]?.name;

  const save = async () => {
    if (!schema) return;
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await api.put(`/api/projects/${projectId}/demo/app-schema`, { schema });
      setSchema(r.schema);
      setMsg(`已保存并重渲染：${r.schema.pages.length} 页` + (r.dropped?.length ? ` · 校验门丢弃越界项 ${r.dropped.length}（${r.dropped.slice(0, 2).join('；')}${r.dropped.length > 2 ? '…' : ''}）` : ''));
    } catch (e: any) {
      setErr(e?.message || '保存失败');
    } finally { setBusy(false); }
  };

  if (loading) return <div className="rounded-xl border border-gray-200 bg-white p-4 mb-4 text-sm text-gray-400">加载页面结构…</div>;

  if (!schema) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-4 mb-4">
        <div className="font-semibold text-gray-800">页面结构编辑</div>
        <p className="text-xs text-gray-500 mt-1">本项目还没有可编辑的页面结构。先在上方「用模板生成预览」生成一次（会产出可编辑的 schema），再回来这里加删改块。</p>
        <button onClick={load} className="mt-2 px-3 py-1.5 rounded-lg text-sm border border-gray-300 text-gray-700 hover:bg-gray-50">刷新</button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 mb-4">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-3">
        <div>
          <div className="font-semibold text-gray-800">页面结构编辑（改 schema，不碰 HTML）</div>
          <p className="text-xs text-gray-500 mt-0.5">加删改「块」、改数据绑定；保存即按数据契约校验并重渲染预览。资源/字段只能选契约内的（不会臆造）。</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button onClick={load} className="px-3 py-1.5 rounded-lg text-sm border border-gray-300 text-gray-700 hover:bg-gray-50">放弃改动</button>
          <button onClick={save} disabled={busy} className={`px-4 py-1.5 rounded-lg text-sm font-medium ${busy ? 'bg-gray-200 text-gray-400' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}>{busy ? '保存中…' : '保存并重渲染'}</button>
        </div>
      </div>

      {msg && <div className="mb-3 p-2.5 rounded-lg text-sm bg-green-50 text-green-700 border border-green-200">{msg} · <a href={`/projects/${projectId}/demo`} className="underline">去预览看 →</a></div>}
      {err && <div className="mb-3 p-2.5 rounded-lg text-sm bg-red-50 text-red-700 border border-red-200">{err}</div>}
      {!contract.resources.length && <div className="mb-3 p-2.5 rounded-lg text-sm bg-amber-50 text-amber-700 border border-amber-200">该项目没有数据契约（数据模型为空），数据块无资源可绑，仅能用富文本块。</div>}

      <input
        value={schema.appName}
        onChange={(e) => mutate((s) => { s.appName = e.target.value; })}
        className="w-full mb-3 px-3 py-2 rounded-lg border border-gray-200 text-sm font-medium"
        placeholder="应用名"
      />

      <div className="space-y-3">
        {schema.pages.map((page, pi) => (
          <div key={pi} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs text-gray-400 shrink-0">页 {pi + 1}</span>
              <input value={page.title} onChange={(e) => mutate((s) => { s.pages[pi].title = e.target.value; })} className="flex-1 px-2 py-1 rounded border border-gray-200 text-sm" placeholder="页标题（侧栏名）" />
              <button onClick={() => mutate((s) => { s.pages.splice(pi, 1); })} className="text-xs text-red-500 hover:text-red-700 shrink-0">删页</button>
            </div>

            <div className="space-y-2">
              {page.blocks.map((block, bi) => (
                <div key={bi} className="rounded border border-gray-200 bg-white p-2.5">
                  <div className="flex items-center gap-2 mb-2">
                    <select
                      value={block.type}
                      onChange={(e) => mutate((s) => {
                        const t = e.target.value; const b = s.pages[pi].blocks[bi]; b.type = t;
                        if (DATA_BLOCKS.has(t)) { b.bind = b.bind || { resource: firstResource() }; if (!b.bind.resource) b.bind.resource = firstResource(); } else { delete b.bind; }
                        if (t === 'richtext') { b.props = { html: b.props?.html || '<p>说明文字</p>' }; }
                      })}
                      className="px-2 py-1 rounded border border-gray-200 text-sm"
                    >
                      {BLOCK_TYPES.map((t) => <option key={t} value={t}>{BLOCK_LABEL[t]}</option>)}
                    </select>

                    {DATA_BLOCKS.has(block.type) && (
                      <select
                        value={block.bind?.resource || ''}
                        onChange={(e) => mutate((s) => { const b = s.pages[pi].blocks[bi]; b.bind = b.bind || {}; b.bind.resource = e.target.value; b.bind.fields = []; })}
                        className="px-2 py-1 rounded border border-gray-200 text-sm"
                      >
                        <option value="">选资源…</option>
                        {contract.resources.map((r) => <option key={r.name} value={r.name}>{r.name}</option>)}
                      </select>
                    )}
                    <span className="ml-auto" />
                    <button onClick={() => mutate((s) => { s.pages[pi].blocks.splice(bi, 1); })} className="text-xs text-red-500 hover:text-red-700">删块</button>
                  </div>

                  {/* 字段多选（table/detail/form/generate）：只列契约字段 */}
                  {['table', 'detail', 'form', 'generate'].includes(block.type) && block.bind?.resource && (
                    <div className="flex flex-wrap gap-1.5 mb-1.5">
                      {fieldsOf(block.bind.resource).map((f) => {
                        const on = block.bind?.fields?.includes(f);
                        return (
                          <button
                            key={f}
                            onClick={() => mutate((s) => { const b = s.pages[pi].blocks[bi]; b.bind = b.bind || {}; const arr = b.bind.fields || []; b.bind.fields = on ? arr.filter((x) => x !== f) : [...arr, f]; })}
                            className={`px-2 py-0.5 rounded text-xs border ${on ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}
                          >{f}</button>
                        );
                      })}
                    </div>
                  )}

                  {/* 每类块的轻量 props */}
                  {block.type === 'kpi' && (
                    <input value={block.props?.label || ''} onChange={(e) => mutate((s) => { const b = s.pages[pi].blocks[bi]; b.props = { ...b.props, label: e.target.value }; })} placeholder="指标标签" className="w-full px-2 py-1 rounded border border-gray-200 text-xs" />
                  )}
                  {block.type === 'richtext' && (
                    <textarea value={block.props?.html || ''} onChange={(e) => mutate((s) => { s.pages[pi].blocks[bi].props = { html: e.target.value }; })} placeholder="HTML 片段" className="w-full px-2 py-1 rounded border border-gray-200 text-xs font-mono" rows={2} />
                  )}
                  {(block.type === 'table' || block.type === 'detail' || block.type === 'form' || block.type === 'generate') && (
                    <div className="flex flex-wrap items-center gap-2">
                      <input value={block.props?.title || ''} onChange={(e) => mutate((s) => { const b = s.pages[pi].blocks[bi]; b.props = { ...b.props, title: e.target.value }; })} placeholder="标题" className="px-2 py-1 rounded border border-gray-200 text-xs" />
                      {block.type === 'table' && (
                        <label className="flex items-center gap-1 text-xs text-gray-500">
                          <input type="checkbox" checked={!!block.props?.searchable} onChange={(e) => mutate((s) => { const b = s.pages[pi].blocks[bi]; b.props = { ...b.props, searchable: e.target.checked }; })} />可搜索
                        </label>
                      )}
                      {block.type === 'generate' && (
                        <input value={block.props?.button || ''} onChange={(e) => mutate((s) => { const b = s.pages[pi].blocks[bi]; b.props = { ...b.props, button: e.target.value }; })} placeholder="按钮文字" className="px-2 py-1 rounded border border-gray-200 text-xs" />
                      )}
                      {block.type === 'form' && (
                        <input value={block.props?.submitLabel || ''} onChange={(e) => mutate((s) => { const b = s.pages[pi].blocks[bi]; b.props = { ...b.props, submitLabel: e.target.value }; })} placeholder="提交按钮文字" className="px-2 py-1 rounded border border-gray-200 text-xs" />
                      )}
                    </div>
                  )}
                </div>
              ))}

              <button
                onClick={() => mutate((s) => { s.pages[pi].blocks.push(contract.resources.length ? { type: 'table', bind: { resource: firstResource(), fields: [] }, props: {} } : { type: 'richtext', props: { html: '<p>说明文字</p>' } }); })}
                className="w-full py-1.5 rounded border border-dashed border-gray-300 text-xs text-gray-500 hover:bg-gray-50"
              >+ 加块</button>
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={() => mutate((s) => { s.pages.push({ key: `page-${s.pages.length + 1}`, title: `新页面 ${s.pages.length + 1}`, nav: { icon: 'square', label: `新页面 ${s.pages.length + 1}` }, blocks: [] }); })}
        className="mt-3 w-full py-2 rounded-lg border border-dashed border-gray-300 text-sm text-gray-500 hover:bg-gray-50"
      >+ 加页面</button>
    </div>
  );
}
