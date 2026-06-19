'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import NavBar from '@/lib/nav-bar';

interface MonthlyHealthReport {
  period: { month: string; start: string; end: string };
  health: {
    avgScore: number | null;
    currentStatus: string;
    checkCount: number;
    avgPassRate: number | null;
    statusDistribution: { healthy: number; degraded: number; critical: number; unknown: number };
  };
  trend: { label: string; avgScore: number | null }[];
  remediation: {
    total: number;
    byLevel: { alert: number; suggest: number; confirm: number; auto: number };
    outcome: { autoFixed: number; manualFixed: number; rolledBack: number; failed: number; pending: number };
    ledger: { date: string; level: string; issue: string; status: string; before: number | null; after: number | null }[];
  };
  todos: string[];
}

const STATUS_META: Record<string, { label: string; cls: string }> = {
  healthy: { label: '健康', cls: 'bg-green-100 text-green-700' },
  degraded: { label: '亚健康', cls: 'bg-amber-100 text-amber-700' },
  critical: { label: '告警', cls: 'bg-red-100 text-red-700' },
  unknown: { label: '未知', cls: 'bg-gray-100 text-gray-600' },
};

const LEVEL_META: Record<string, { label: string; cls: string }> = {
  alert: { label: '提醒', cls: 'bg-gray-100 text-gray-600' },
  suggest: { label: '建议修复', cls: 'bg-gray-100 text-gray-600' },
  confirm: { label: '确认修复', cls: 'bg-amber-100 text-amber-700' },
  auto: { label: '低风险自动', cls: 'bg-blue-100 text-blue-700' },
};

const REM_STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  applied: { label: '已修复', cls: 'text-green-600' },
  rolled_back: { label: '劣化已回滚', cls: 'text-red-600' },
  failed: { label: '修复失败', cls: 'text-red-600' },
  pending: { label: '待处理', cls: 'text-amber-600' },
};

export default function GuardianReportPage() {
  const params = useParams();
  const projectId = params.id as string;
  const { token, isLoading: authLoading } = useAuth();

  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [report, setReport] = useState<MonthlyHealthReport | null>(null);
  const [projectName, setProjectName] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rep, proj] = await Promise.all([
        api.get(`/api/projects/${projectId}/guardian/report?month=${month}`),
        api.get(`/api/projects/${projectId}`),
      ]);
      setReport(rep);
      setProjectName(proj?.name || '');
    } catch {
      setReport(null);
    }
    setLoading(false);
  }, [projectId, month]);

  useEffect(() => {
    if (authLoading || !token) return;
    load();
  }, [authLoading, token, load]);

  if (authLoading) return null;

  const h = report?.health;
  const status = h?.currentStatus || 'unknown';
  const maxTrend = Math.max(1, ...(report?.trend.map((t) => t.avgScore ?? 0) ?? [1]));

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar projectId={projectId} projectName={projectName} />

      <main className="mx-auto max-w-4xl px-6 py-8">
        <div className="mb-6 flex items-end justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">月度守护健康报告</h1>
            <p className="mt-1 text-sm text-gray-500">
              {projectName} · 报告期 {report?.period.start} ~ {report?.period.end}
            </p>
          </div>
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-700"
          />
        </div>

        {loading ? (
          <p className="text-gray-400">加载中…</p>
        ) : !report ? (
          <p className="text-gray-400">暂无报告数据</p>
        ) : (
          <div className="space-y-6">
            {/* 总评 + 指标卡 */}
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <div className="mb-4 flex items-center gap-3">
                <span className="text-sm text-gray-500">总体状态</span>
                <span className={`rounded-full px-3 py-0.5 text-sm ${STATUS_META[status].cls}`}>
                  {STATUS_META[status].label}
                </span>
                <span className="text-2xl font-bold text-gray-900">{h?.avgScore ?? '—'}</span>
                <span className="text-sm text-gray-400">平均健康分</span>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Metric label="本月巡检" value={`${h?.checkCount ?? 0} 次`} />
                <Metric label="验收通过率" value={h?.avgPassRate != null ? `${Math.round(h.avgPassRate * 100)}%` : '—'} />
                <Metric label="发现问题" value={`${report.remediation.total}`} />
                <Metric label="自动修复" value={`${report.remediation.outcome.autoFixed}`} />
              </div>
            </div>

            {/* 健康分趋势 */}
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <h2 className="mb-4 text-sm font-semibold text-gray-800">健康分趋势（按周）</h2>
              {report.trend.length === 0 ? (
                <p className="text-sm text-gray-400">本月暂无有效巡检</p>
              ) : (
                <div className="flex h-28 items-end gap-4">
                  {report.trend.map((t) => (
                    <div key={t.label} className="flex flex-1 flex-col items-center gap-1.5">
                      <span className="text-xs text-gray-500">{t.avgScore ?? '—'}</span>
                      <div
                        className="w-full rounded-md bg-blue-400"
                        style={{ height: `${Math.round(((t.avgScore ?? 0) / maxTrend) * 80)}px` }}
                      />
                      <span className="text-xs text-gray-400">{t.label}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 分级修复台账 */}
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <h2 className="mb-4 text-sm font-semibold text-gray-800">分级修复台账</h2>
              {report.remediation.ledger.length === 0 ? (
                <p className="text-sm text-gray-400">本月无修复记录</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-400">
                      <th className="py-2 font-normal">日期</th>
                      <th className="py-2 font-normal">级别</th>
                      <th className="py-2 font-normal">问题</th>
                      <th className="py-2 font-normal">处置</th>
                      <th className="py-2 text-right font-normal">前→后分</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.remediation.ledger.map((r, i) => (
                      <tr key={i} className="border-t border-gray-100">
                        <td className="py-2 text-gray-500">{r.date?.slice(5, 10)}</td>
                        <td className="py-2">
                          <span className={`rounded px-2 py-0.5 text-xs ${LEVEL_META[r.level]?.cls || 'bg-gray-100 text-gray-600'}`}>
                            {LEVEL_META[r.level]?.label || r.level}
                          </span>
                        </td>
                        <td className="py-2 text-gray-900">{r.issue}</td>
                        <td className={`py-2 ${REM_STATUS_LABEL[r.status]?.cls || 'text-gray-600'}`}>
                          {REM_STATUS_LABEL[r.status]?.label || r.status}
                        </td>
                        <td className="py-2 text-right text-gray-700">
                          {r.before != null && r.after != null ? `${r.before} → ${r.after}` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* 待办与建议 */}
            {report.todos.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
                <h2 className="mb-2 text-sm font-semibold text-amber-800">待办与风险建议</h2>
                <ul className="list-inside list-disc space-y-1 text-sm text-amber-700">
                  {report.todos.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-gray-50 px-4 py-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-1 text-xl font-semibold text-gray-900">{value}</div>
    </div>
  );
}
