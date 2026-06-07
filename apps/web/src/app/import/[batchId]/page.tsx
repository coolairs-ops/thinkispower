'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

interface MergedItem { name: string; sources: string[] }
interface ParseSummary { status: 'parsed' | 'skipped' | 'error'; reason?: string }
interface Asset { id: string; fileName: string; category: string; parsedAt: string | null; parseSummary: ParseSummary | null }
interface ConflictStatement { source: string; claim: string }
interface Conflict { topic: string; kind: string; severity: 'high' | 'medium' | 'low'; statements: ConflictStatement[]; suggestion: string }
interface Question { id: string; question: string; severity: string | null; answer: string | null; resolved: boolean }
interface Understanding {
  positioning: string | null;
  features: MergedItem[] | null;
  pages: MergedItem[] | null;
  roles: MergedItem[] | null;
  suggestions: string[] | null;
  confidenceScore: number | null;
  conflicts: Conflict[] | null;
  questions?: Question[];
}
interface Batch { id: string; projectId: string | null; status: string; assets: Asset[]; understanding: Understanding | null }

function assetState(a: Asset): { label: string; cls: string } {
  if (!a.parsedAt) return { label: '处理中…', cls: 'text-blue-600' };
  const s = a.parseSummary?.status;
  if (s === 'parsed') return { label: '已理解', cls: 'text-green-600' };
  if (s === 'skipped') return { label: '已跳过', cls: 'text-gray-400' };
  if (s === 'error') return { label: '理解失败', cls: 'text-red-500' };
  return { label: '已处理', cls: 'text-gray-500' };
}

function SourceTags({ sources }: { sources: string[] }) {
  return (
    <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
      {sources.map((s, i) => (
        <span key={i} className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-500" title={`来源：${s}`}>{s}</span>
      ))}
    </span>
  );
}

export default function ImportWizardPage() {
  const router = useRouter();
  const { batchId } = useParams<{ batchId: string }>();
  const { token, isLoading } = useAuth();
  const [batch, setBatch] = useState<Batch | null>(null);
  const [understanding, setUnderstanding] = useState<Understanding | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [answering, setAnswering] = useState<string | null>(null);
  const summarizing = useRef(false);

  useEffect(() => {
    if (isLoading) return;
    if (!token) { router.push('/'); return; }

    let stop = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      try {
        const b: Batch = await api.get(`/api/import/batches/${batchId}`);
        if (stop) return;
        setBatch(b);

        if (b.understanding) { setUnderstanding(b.understanding); return; }

        const done = b.assets.length > 0 && b.assets.every((a) => a.parsedAt);
        if (done && !summarizing.current) {
          summarizing.current = true;
          const u: Understanding = await api.post(`/api/import/batches/${batchId}/understand`);
          if (!stop) setUnderstanding(u);
          return;
        }
        if (!done) timer = setTimeout(tick, 3000);
      } catch (e) {
        if (!stop) setError(e instanceof Error ? e.message : '加载失败');
      }
    };
    tick();
    return () => { stop = true; clearTimeout(timer); };
  }, [token, isLoading, batchId, router]);

  const handleAnswer = async (qid: string) => {
    setAnswering(qid);
    setError('');
    try {
      await api.post(`/api/import/batches/questions/${qid}/answer`, { answer: answers[qid] || '' });
      const b: Batch = await api.get(`/api/import/batches/${batchId}`);
      setBatch(b);
      if (b.understanding) setUnderstanding(b.understanding);
    } catch (e) {
      setError(e instanceof Error ? e.message : '提交失败');
    } finally {
      setAnswering(null);
    }
  };

  const handleGenerate = async () => {
    // 已物化过：直接去规格页
    if (batch?.status === 'confirmed' && batch.projectId) {
      router.push(`/projects/${batch.projectId}/spec`);
      return;
    }
    setGenerating(true);
    setError('');
    try {
      const r = await api.post(`/api/import/batches/${batchId}/materialize-spec`);
      router.push(`/projects/${r.projectId}/spec`);
    } catch (e) {
      setError(e instanceof Error ? e.message : '生成规格失败');
      setGenerating(false);
    }
  };

  if (isLoading) return null;

  const confidence = understanding?.confidenceScore != null ? Math.round(understanding.confidenceScore * 100) : null;
  const confCls = confidence == null ? '' : confidence >= 80 ? 'text-green-600' : confidence >= 50 ? 'text-amber-600' : 'text-red-500';
  const conflicts = understanding?.conflicts ?? [];
  const questions = understanding?.questions ?? [];
  const blockingCount = questions.filter((q) => q.severity === 'high' && !q.resolved).length;

  return (
    <div className="min-h-screen bg-gray-50 px-6 py-12">
      <div className="mx-auto max-w-2xl">
        {!understanding ? (
          // ── 步骤一：正在理解资料 ──
          <div className="rounded-2xl border border-gray-200 bg-white p-8">
            <h1 className="mb-1 text-xl font-bold text-blue-700">正在理解你的资料</h1>
            <p className="mb-6 text-sm text-gray-500">逐份阅读上传的资料，提取功能、页面与角色，请稍候…</p>

            <ul className="space-y-2">
              {(batch?.assets ?? []).map((a) => {
                const st = assetState(a);
                return (
                  <li key={a.id} className="flex items-center justify-between rounded-lg bg-gray-50 px-4 py-2.5 text-sm">
                    <span className="truncate text-gray-700">{a.fileName}</span>
                    <span className={`ml-2 shrink-0 ${st.cls}`}>{st.label}</span>
                  </li>
                );
              })}
              {!batch && <li className="text-sm text-gray-400">加载中…</li>}
            </ul>

            {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
          </div>
        ) : (
          // ── 步骤二：需求理解确认 ──
          <div className="rounded-2xl border border-gray-200 bg-white p-8">
            <div className="mb-4 flex items-baseline justify-between">
              <h1 className="text-xl font-bold text-blue-700">需求理解确认</h1>
              {confidence != null && (
                <span className="text-sm text-gray-500">理解完整度 <span className={`font-semibold ${confCls}`}>{confidence}%</span></span>
              )}
            </div>
            <p className="mb-6 text-sm text-gray-500">以下是从你的资料中理解到的内容，每一项都标注了来源。请核对，确认后生成产品规格。</p>

            {understanding.positioning && (
              <section className="mb-5">
                <h2 className="mb-1.5 text-sm font-semibold text-gray-900">产品定位</h2>
                <p className="rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-700">{understanding.positioning}</p>
              </section>
            )}

            <Section title="核心功能" items={understanding.features} />
            <Section title="页面" items={understanding.pages} />
            <Section title="用户角色" items={understanding.roles} />

            {understanding.suggestions && understanding.suggestions.length > 0 && (
              <section className="mb-5">
                <h2 className="mb-1.5 text-sm font-semibold text-gray-900">
                  建议补充
                  <span className="ml-1 text-xs font-normal text-gray-400">（专业视角的待完善点，可按需补充）</span>
                </h2>
                <ul className="space-y-1.5">
                  {understanding.suggestions.map((s, i) => (
                    <li key={i} className="rounded-lg border border-dashed border-amber-300 bg-amber-50/50 px-4 py-2 text-sm text-gray-700">
                      {s}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {conflicts.length > 0 && (
              <section className="mb-5">
                <h2 className="mb-1.5 text-sm font-semibold text-gray-900">
                  需核对的冲突
                  <span className="ml-1 text-xs font-normal text-gray-400">（多份资料之间的矛盾/不一致）</span>
                </h2>
                <ul className="space-y-2">
                  {conflicts.map((c, i) => (
                    <li key={i} className={`rounded-lg border px-4 py-2.5 text-sm ${c.severity === 'high' ? 'border-red-200 bg-red-50' : c.severity === 'medium' ? 'border-amber-200 bg-amber-50/60' : 'border-gray-200 bg-gray-50'}`}>
                      <div className="flex items-center gap-2">
                        <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${c.severity === 'high' ? 'bg-red-200 text-red-800' : c.severity === 'medium' ? 'bg-amber-200 text-amber-800' : 'bg-gray-200 text-gray-600'}`}>
                          {c.severity === 'high' ? '高' : c.severity === 'medium' ? '中' : '低'}
                        </span>
                        <span className="font-medium text-gray-900">{c.topic}</span>
                      </div>
                      <ul className="mt-1.5 space-y-0.5 text-xs text-gray-600">
                        {c.statements.map((s, j) => (
                          <li key={j}><span className="text-gray-400">{s.source}：</span>{s.claim}</li>
                        ))}
                      </ul>
                      {c.suggestion && <p className="mt-1 text-xs text-blue-600">建议：{c.suggestion}</p>}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {questions.length > 0 && (
              <section className="mb-5">
                <h2 className="mb-1.5 text-sm font-semibold text-gray-900">
                  待确认问题
                  <span className="ml-1 text-xs font-normal text-gray-400">（标「高」的需回答后才能生成规格）</span>
                </h2>
                <ul className="space-y-2">
                  {questions.map((q) => (
                    <li key={q.id} className="rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm">
                      <p className="text-gray-800">{q.question}</p>
                      {q.resolved ? (
                        <p className="mt-1 text-xs text-green-600">✓ 已确认：{q.answer}</p>
                      ) : (
                        <div className="mt-2 flex gap-2">
                          <input
                            value={answers[q.id] ?? ''}
                            onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                            placeholder="填写你的澄清/决定…"
                            className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                          />
                          <button
                            onClick={() => handleAnswer(q.id)}
                            disabled={answering === q.id || !(answers[q.id] ?? '').trim()}
                            className="shrink-0 rounded-lg bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700 disabled:opacity-50"
                          >
                            {answering === q.id ? '提交中…' : '确认'}
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

            <div className="mt-6 flex items-center gap-3">
              <button
                onClick={handleGenerate}
                disabled={generating || (blockingCount > 0 && batch?.status !== 'confirmed')}
                className="rounded-lg bg-blue-600 px-5 py-2.5 text-white transition-all hover:bg-blue-700 hover:shadow-md active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {generating ? '正在生成…' : batch?.status === 'confirmed' ? '查看产品规格' : '确认无误，生成产品规格'}
              </button>
              <span className="text-xs text-gray-400">
                {blockingCount > 0 && batch?.status !== 'confirmed'
                  ? `请先确认上方 ${blockingCount} 项高冲突后再生成`
                  : '生成后可在规格页继续核对与确认'}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ title, items }: { title: string; items: MergedItem[] | null }) {
  if (!items || items.length === 0) return null;
  return (
    <section className="mb-5">
      <h2 className="mb-1.5 text-sm font-semibold text-gray-900">{title}<span className="ml-1 text-xs font-normal text-gray-400">（{items.length}）</span></h2>
      <ul className="space-y-1.5">
        {items.map((it, i) => (
          <li key={i} className="rounded-lg bg-gray-50 px-4 py-2 text-sm text-gray-700">
            {it.name}
            {it.sources?.length > 0 && <SourceTags sources={it.sources} />}
          </li>
        ))}
      </ul>
    </section>
  );
}
