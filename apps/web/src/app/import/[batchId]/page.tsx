'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

interface MergedItem { name: string; sources: string[] }
interface ParseSummary { status: 'parsed' | 'skipped' | 'error'; reason?: string }
interface Asset { id: string; fileName: string; category: string; parsedAt: string | null; parseSummary: ParseSummary | null }
interface Understanding {
  positioning: string | null;
  features: MergedItem[] | null;
  pages: MergedItem[] | null;
  roles: MergedItem[] | null;
  suggestions: string[] | null;
  confidenceScore: number | null;
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

            {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

            <div className="mt-6 flex items-center gap-3">
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="rounded-lg bg-blue-600 px-5 py-2.5 text-white transition-all hover:bg-blue-700 hover:shadow-md active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {generating ? '正在生成…' : batch?.status === 'confirmed' ? '查看产品规格' : '确认无误，生成产品规格'}
              </button>
              <span className="text-xs text-gray-400">生成后可在规格页继续核对与确认</span>
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
