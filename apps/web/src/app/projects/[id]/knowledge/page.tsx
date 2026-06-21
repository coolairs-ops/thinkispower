'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import NavBar from '@/lib/nav-bar';

interface Evidence { evidence_id: string; source_id: string; quote: string; locator?: { page?: number; paragraph?: number }; verified_in_source: boolean }
interface Fact { fact_id: string; name: string; value: any; evidence_refs: string[]; status: 'candidate' | 'confirmed' | 'rejected' | 'missing'; confirmed_by?: string | null }
interface Source { source_id: string; title: string; doc_type?: string; content_hash: string; status: string }
interface KB { sources: Source[]; evidences: Evidence[]; facts: Fact[]; trace?: any[] }

const STATUS_LABEL: Record<string, string> = { candidate: '待确认', confirmed: '已采纳', rejected: '作废', missing: '缺失' };
const STATUS_STYLE: Record<string, string> = {
  candidate: 'bg-amber-50 text-amber-700 border-amber-200',
  confirmed: 'bg-green-50 text-green-700 border-green-200',
  rejected: 'bg-gray-50 text-gray-400 border-gray-200',
  missing: 'bg-red-50 text-red-600 border-red-200',
};

export default function KnowledgePage() {
  const projectId = (useParams().id as string);
  const [kb, setKb] = useState<KB | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    api.get(`/api/projects/${projectId}/knowledge`).then(setKb).catch(() => setKb({ sources: [], evidences: [], facts: [] }));
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true); setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      await api.upload(`/api/projects/${projectId}/knowledge/sources`, fd);
      load();
    } catch (err: any) {
      setError(err?.message || '上传失败');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const act = (factIds: string[], kind: 'confirm' | 'reject') =>
    api.post(`/api/projects/${projectId}/knowledge/${kind}`, { factIds }).then(load).catch((e) => setError(e?.message || '操作失败'));

  const evOf = (f: Fact): Evidence | undefined => kb?.evidences.find((e) => e.evidence_id === f.evidence_refs[0]);
  const srcTitle = (e?: Evidence) => kb?.sources.find((s) => s.source_id === e?.source_id)?.title;

  const facts = kb?.facts ?? [];
  const candidates = facts.filter((f) => f.status === 'candidate');
  const confirmed = facts.filter((f) => f.status === 'confirmed');
  const others = facts.filter((f) => f.status === 'rejected' || f.status === 'missing');

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar />
      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h1 className="text-xl font-bold text-gray-900">可溯源知识库</h1>
            <p className="text-sm text-gray-500 mt-0.5">上传原件 → AI 提取候选 → 机器校验门核对原文 → 你逐条确认。只有确认的事实才进评分。</p>
          </div>
          <label className={`px-4 py-2 rounded-lg text-sm font-medium cursor-pointer ${uploading ? 'bg-gray-200 text-gray-400' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}>
            {uploading ? '提取中…' : '上传原件 (docx/pdf/txt)'}
            <input ref={fileRef} type="file" accept=".docx,.pdf,.txt,.md" onChange={onUpload} disabled={uploading} className="hidden" />
          </label>
        </div>
        {error && <div className="mb-4 px-4 py-2 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>}

        {/* 原件 */}
        {!!kb?.sources.length && (
          <div className="mb-5 flex flex-wrap gap-2">
            {kb.sources.map((s) => (
              <span key={s.source_id} className="text-xs px-2 py-1 rounded bg-white border border-gray-200 text-gray-600" title={`hash ${s.content_hash.slice(0, 12)}…`}>
                📄 {s.title} <span className="text-gray-300">· {s.content_hash.slice(0, 8)}</span>
              </span>
            ))}
          </div>
        )}

        {/* 待确认 */}
        <Section title={`待确认（${candidates.length}）`} hint="逐条看原文、确认才采纳进评分">
          {candidates.length === 0 && <Empty text="无待确认事实。上传一份原件开始。" />}
          {candidates.map((f) => {
            const ev = evOf(f);
            return (
              <div key={f.fact_id} className="border-t border-gray-100 py-3 first:border-t-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="text-sm"><span className="font-medium text-gray-800">{f.name}</span> = <span className="font-mono text-indigo-700">{String(f.value)}</span></div>
                    <div className="mt-1 text-xs text-gray-500">原文：<span className="bg-yellow-50 px-1 rounded">“{ev?.quote}”</span></div>
                    <div className="mt-0.5 text-xs text-gray-400">
                      来源：{srcTitle(ev) || '—'}
                      {ev?.locator?.paragraph != null && ` · 第${ev.locator.paragraph}段`}
                      {ev && (ev.verified_in_source ? <span className="ml-2 text-green-600">✓ 原文已核对</span> : <span className="ml-2 text-red-500">✕ 原文未核对</span>)}
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => act([f.fact_id], 'confirm')} className="text-xs px-3 py-1 rounded bg-green-600 text-white hover:bg-green-700">确认</button>
                    <button onClick={() => act([f.fact_id], 'reject')} className="text-xs px-3 py-1 rounded bg-gray-100 text-gray-600 hover:bg-gray-200">否决</button>
                  </div>
                </div>
              </div>
            );
          })}
          {candidates.length > 1 && (
            <button onClick={() => act(candidates.map((f) => f.fact_id), 'confirm')} className="mt-3 text-xs px-3 py-1 rounded border border-green-600 text-green-700 hover:bg-green-50">全部确认（批量档）</button>
          )}
        </Section>

        {/* 已采纳 + 证据链 */}
        <Section title={`已采纳（${confirmed.length}）`} hint="进评分的事实，每条可溯源到原件">
          {confirmed.length === 0 && <Empty text="尚无已采纳事实。" />}
          {confirmed.map((f) => {
            const ev = evOf(f);
            return (
              <div key={f.fact_id} className="border-t border-gray-100 py-2 first:border-t-0 text-sm flex items-center justify-between">
                <div>
                  <span className="font-medium text-gray-800">{f.name}</span> = <span className="font-mono text-green-700">{String(f.value)}</span>
                  <span className="ml-2 text-xs text-gray-400">← “{ev?.quote?.slice(0, 24)}…” ← {srcTitle(ev)}</span>
                </div>
                <span className="text-xs text-gray-400">{f.confirmed_by}</span>
              </div>
            );
          })}
        </Section>

        {/* 作废/缺失 */}
        {others.length > 0 && (
          <Section title={`作废 / 缺失（${others.length}）`} hint="校验门作废的（编造出处）+ 显式缺失的（绝不静默补0）">
            {others.map((f) => (
              <div key={f.fact_id} className="border-t border-gray-100 py-2 first:border-t-0 text-sm flex items-center gap-2">
                <span className={`text-xs px-2 py-0.5 rounded border ${STATUS_STYLE[f.status]}`}>{STATUS_LABEL[f.status]}</span>
                <span className="text-gray-500">{f.name}{f.value != null && ` = ${f.value}`}</span>
                {f.status === 'rejected' && <span className="text-xs text-red-400">原文核对不通过</span>}
              </div>
            ))}
          </Section>
        )}
      </div>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
      <div className="mb-1"><h2 className="font-semibold text-gray-800 inline">{title}</h2>{hint && <span className="ml-2 text-xs text-gray-400">{hint}</span>}</div>
      {children}
    </section>
  );
}
function Empty({ text }: { text: string }) { return <div className="text-sm text-gray-300 py-3">{text}</div>; }
