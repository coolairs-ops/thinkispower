'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

/**
 * 规则定义子环节（接入主生成流程，交接说明 形态A：①需求采集→②设计确认 之间）。
 * 一道选择题"这系统要不要风险评分/自动定级？"——开关绑在项目上（rulePack.meta.enabled）。
 * 关 = 纯 CRUD（不生成规则产物）；开 = 露出 配置规则 + 可溯源知识库 两个入口。
 */
export default function RuleEngineEntry({ projectId }: { projectId: string }) {
  const [pack, setPack] = useState<any>(null);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get(`/api/projects/${projectId}/rule-pack`).then((r) => {
      setPack(r?.rulePack ?? null);
      setEnabled(!!r?.rulePack?.meta?.enabled);
    }).catch(() => {});
  }, [projectId]);

  const setOn = async (on: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      let p = pack;
      if (on && !p) {
        // 首次开启：从行业模板库取第一个起手（药监）
        const list = await api.get('/api/rule-templates').catch(() => ({ templates: [] }));
        const first = list?.templates?.[0];
        if (first) { const full = await api.get(`/api/rule-templates/${first.id}`); p = full?.rulePack; }
      }
      if (!p) { setEnabled(on); setBusy(false); return; }
      const next = { ...p, meta: { ...p.meta, project_id: projectId, enabled: on } };
      await api.put(`/api/projects/${projectId}/rule-pack`, { rulePack: next });
      setPack(next);
      setEnabled(on);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="font-semibold text-gray-800">这个系统需要风险评分 / 自动定级吗？</div>
          <p className="text-xs text-gray-500 mt-0.5">
            如药监风险画像、信用评级、设备健康、安全分级。开启后系统在 CRUD 之上带一个可配置的规则引擎 +
            可溯源知识库；关闭则是纯 CRUD（表单/列表/台账），不生成任何规则产物。
          </p>
        </div>
        <button
          onClick={() => setOn(!enabled)}
          disabled={busy}
          className={`relative shrink-0 w-12 h-7 rounded-full transition-colors ${enabled ? 'bg-indigo-600' : 'bg-gray-300'} ${busy ? 'opacity-60' : ''}`}
          aria-pressed={enabled}
        >
          <span className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white transition-transform ${enabled ? 'translate-x-5' : ''}`} />
        </button>
      </div>

      {enabled && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href={`/projects/${projectId}/rules`} className="px-3 py-1.5 text-sm rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">
            配置规则 · 即时试算 →
          </Link>
          <Link href={`/projects/${projectId}/knowledge`} className="px-3 py-1.5 text-sm rounded-lg border border-indigo-300 text-indigo-600 hover:bg-indigo-50">
            可溯源知识库（上传材料）→
          </Link>
          <span className="self-center text-xs text-gray-400">配好的规则随生成的后端一起交付，每查一个对象跑一次评分，守护天然覆盖。</span>
        </div>
      )}
    </div>
  );
}
