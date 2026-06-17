'use client';

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { useToast } from '@/lib/toast';

interface GuardianCheck {
  id: string;
  healthScore: number;
  status: string;
  passRate: number | null;
  total: number;
  passed: number;
  failed: number;
  manual: number;
  trigger: string;
  checkedAt: string;
}

interface GuardianStatus {
  enabled: boolean;
  deployed: boolean;
  latest: GuardianCheck | null;
  history: GuardianCheck[];
}

const STATUS_META: Record<string, { label: string; text: string; bg: string; ring: string }> = {
  healthy: { label: '健康', text: 'text-emerald-600', bg: 'bg-emerald-50', ring: 'ring-emerald-200' },
  degraded: { label: '亚健康', text: 'text-amber-600', bg: 'bg-amber-50', ring: 'ring-amber-200' },
  critical: { label: '告警', text: 'text-red-600', bg: 'bg-red-50', ring: 'ring-red-200' },
  unknown: { label: '待巡检', text: 'text-gray-500', bg: 'bg-gray-50', ring: 'ring-gray-200' },
};

const fmtTime = (s: string) => {
  try { return new Date(s).toLocaleString('zh-CN', { hour12: false }); } catch { return s; }
};

export default function GuardianCard({ projectId }: { projectId: string }) {
  const { toast } = useToast();
  const [data, setData] = useState<GuardianStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);

  const load = useCallback(
    () =>
      api
        .get(`/api/projects/${projectId}/guardian`)
        .then(setData)
        .catch(() => {})
        .finally(() => setLoading(false)),
    [projectId],
  );

  useEffect(() => {
    load();
  }, [load]);

  const runCheck = async () => {
    setChecking(true);
    try {
      await api.post(`/api/projects/${projectId}/guardian/check`);
      toast('巡检已启动，稍后自动刷新结果', 'success');
      // 巡检异步执行，延时轮询两次拉取结果
      setTimeout(load, 8000);
      setTimeout(load, 20000);
    } catch (e: any) {
      toast(e.message || '触发巡检失败', 'error');
    } finally {
      setChecking(false);
    }
  };

  if (loading) return null;

  const latest = data?.latest ?? null;
  const meta = STATUS_META[latest?.status ?? 'unknown'] ?? STATUS_META.unknown;
  const deployed = !!data?.deployed;

  return (
    <section className="mb-6 rounded-xl bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-700">🛡️ 持续守护</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            上线后定时巡检关键验收场景，持续监测产品健康
          </p>
        </div>
        <button
          onClick={runCheck}
          disabled={checking}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-xs text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {checking ? '启动中...' : '立即巡检'}
        </button>
      </div>

      {!latest ? (
        <div className="text-center py-6 text-gray-400 text-sm">
          {deployed
            ? '已进入守护生命周期，尚未巡检 —— 点击「立即巡检」获取首份健康快照'
            : '产品上线后自动进入守护定时巡检；也可点「立即巡检」手动获取一份健康快照'}
        </div>
      ) : (
        <>
          {/* 健康分 + 状态 */}
          <div className={`flex items-center gap-5 rounded-lg ${meta.bg} ring-1 ${meta.ring} p-4 mb-4`}>
            <div className="text-center">
              <div className={`text-4xl font-bold ${meta.text}`}>{latest.healthScore}</div>
              <div className="text-xs text-gray-400 mt-1">健康分</div>
            </div>
            <div className="flex-1">
              <span className={`inline-block rounded-full ${meta.bg} ${meta.text} text-xs font-semibold px-2.5 py-1 ring-1 ${meta.ring}`}>
                {meta.label}
              </span>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2 text-xs text-gray-500">
                {latest.passRate != null && (
                  <span>验收通过率：{Math.round(latest.passRate * 100)}%</span>
                )}
                <span>
                  场景：{latest.passed}/{latest.total} 通过
                  {latest.failed > 0 && <span className="text-red-500"> · {latest.failed} 未通过</span>}
                  {latest.manual > 0 && <span className="text-amber-500"> · {latest.manual} 待人工</span>}
                </span>
                <span className="col-span-2 text-gray-400">
                  上次巡检：{fmtTime(latest.checkedAt)}（{latest.trigger === 'manual' ? '手动' : '定时'}）
                </span>
              </div>
            </div>
          </div>

          {/* 历史 */}
          {data && data.history.length > 1 && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 mb-2">巡检历史</h4>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {data.history.map((h) => {
                  const m = STATUS_META[h.status] ?? STATUS_META.unknown;
                  return (
                    <div key={h.id} className="flex items-center justify-between text-xs py-1 border-b border-gray-50 last:border-0">
                      <span className="text-gray-400">{fmtTime(h.checkedAt)}</span>
                      <span className="flex items-center gap-2">
                        <span className={`font-medium ${m.text}`}>{m.label}</span>
                        <span className="text-gray-500">{h.healthScore} 分</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
