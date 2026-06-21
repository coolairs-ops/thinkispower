'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface ThemeMeta { id: string; name: string; dark: boolean; primary: string }

/**
 * 内置模板出页入口（① 接进 serve 链的前端触发）：选主题 → 用模板生成预览（替代 DeepSeek 即兴）。
 * 调 GET .../demo/themes + POST .../demo/from-template。
 */
export default function TemplateGenerator({ projectId }: { projectId: string }) {
  const [themes, setThemes] = useState<ThemeMeta[]>([]);
  const [sel, setSel] = useState('gov-blue');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get(`/api/projects/${projectId}/demo/themes`).then((r) => {
      const t: ThemeMeta[] = r?.themes || [];
      setThemes(t);
      if (t[0]) setSel(t[0].id);
    }).catch(() => {});
  }, [projectId]);

  const generate = async () => {
    setBusy(true); setError(null); setDone(false);
    try {
      await api.post(`/api/projects/${projectId}/demo/from-template`, { themeId: sel });
      setDone(true);
    } catch (e: any) {
      setError(e?.message || '生成失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 mb-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="font-semibold text-gray-800">用内置模板出页（政企风，替代 AI 即兴）</div>
          <p className="text-xs text-gray-500 mt-0.5">选一套主题皮肤，平台据本项目数据模型确定性套模板出预览——风格稳定、不跑偏。</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mt-3">
        {themes.map((t) => (
          <button
            key={t.id}
            onClick={() => setSel(t.id)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm ${sel === t.id ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
          >
            <span className="w-3 h-3 rounded-full" style={{ background: t.primary }} />
            {t.name}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-3 mt-3">
        <button onClick={generate} disabled={busy} className={`px-4 py-2 rounded-lg text-sm font-medium ${busy ? 'bg-gray-200 text-gray-400' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}>
          {busy ? '生成中…' : '用模板生成预览'}
        </button>
        {done && <a href={`/projects/${projectId}/demo`} className="text-sm text-indigo-600">✓ 已生成,去预览看 →</a>}
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>
    </div>
  );
}
