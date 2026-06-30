'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

/**
 * 需求完备度进度条 + 缺口清单（ADR-0016 切片2）。
 * 消费 GET /api/projects/:id/coverage（若依交付 7 槽覆盖度 + 缺口）。
 * 让业务人当场看见"还差什么"——一次问清，而非来回拉扯。
 */
type SlotState = 'known' | 'partial' | 'missing';
interface Coverage {
  coverage: number;
  perSlot: Record<string, SlotState>;
  gaps: string[];
}

const SLOT_LABELS: Record<string, string> = {
  entities: '业务对象',
  fields: '字段',
  relations: '关系',
  roles: '角色',
  dataScope: '数据权限',
  menus: '菜单',
  businessRules: '业务规则',
  acceptanceScenarios: '验收场景',
};

export default function CoverageProgress({
  projectId,
  refreshKey = 0,
  onComplete,
  completing = false,
}: {
  projectId: string;
  refreshKey?: number; // 关系检测/追加问答后 +1 触发重取，进度条随之前进
  onComplete?: () => void;
  completing?: boolean;
}) {
  const [data, setData] = useState<Coverage | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    api
      .get(`/api/projects/${projectId}/coverage`)
      .then((r: any) => setData(r))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [projectId, refreshKey]);

  if (loading || !data) return null;

  const pct = Math.max(0, Math.min(100, Math.round(data.coverage)));
  const gapCount = data.gaps?.length ?? 0;
  const barColor = pct >= 70 ? 'bg-green-500' : pct >= 40 ? 'bg-amber-500' : 'bg-red-400';
  const headColor = pct >= 70 ? 'text-green-700' : pct >= 40 ? 'text-amber-700' : 'text-red-600';

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <span className="text-sm font-semibold text-gray-800">需求完备度</span>
          <span className={`ml-3 text-sm font-bold ${headColor}`}>
            {pct}%{gapCount > 0 && <span className="ml-1 font-normal text-gray-500">· 还差 {gapCount} 项</span>}
          </span>
        </div>
        {gapCount > 0 && onComplete && (
          <button
            onClick={onComplete}
            disabled={completing}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:bg-gray-300"
          >
            {completing ? '补齐中...' : '补齐缺口'}
          </button>
        )}
      </div>

      <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
        <div className={`h-full ${barColor} transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {Object.entries(data.perSlot || {}).map(([slot, state]) => (
          <span
            key={slot}
            className={`rounded-full border px-2 py-0.5 text-xs ${
              state === 'known'
                ? 'border-green-200 bg-green-50 text-green-700'
                : state === 'partial'
                  ? 'border-amber-200 bg-amber-50 text-amber-700'
                  : 'border-gray-200 bg-gray-50 text-gray-400'
            }`}
          >
            {state === 'known' ? '✓' : state === 'partial' ? '◐' : '○'} {SLOT_LABELS[slot] || slot}
          </span>
        ))}
      </div>

      {gapCount > 0 ? (
        <ul className="mt-3 space-y-1">
          {data.gaps.map((g, i) => (
            <li key={i} className="flex items-start gap-2 text-xs text-gray-600">
              <span className="mt-0.5 text-amber-500">•</span>
              <span>{g}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-xs text-green-600">✓ 交付槽位已基本完备，可进入下一步。</p>
      )}
    </div>
  );
}
