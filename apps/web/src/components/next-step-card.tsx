'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

interface CompletenessBreakdown {
  descriptionLevel: string;
  prdLevel: string;
  planLevel: string;
  featuresLevel: string;
  pagesLevel: string;
  specLevel: string;
  demoLevel: string;
  score: number;
}

interface NextStepData {
  action: string;
  title: string;
  description: string;
  reasons: string[];
  nextSteps: string[];
  confidence: number;
  severity: 'info' | 'warning' | 'danger';
  completeness: number;
  completenessBreakdown?: CompletenessBreakdown;
  actionLinks?: Record<string, string>;
}

interface Props {
  projectId: string;
  refreshKey?: string;
}

const SEVERITY_STYLES: Record<string, string> = {
  info: 'border-l-4 border-blue-500 bg-gradient-to-r from-blue-50 to-white',
  warning: 'border-l-4 border-amber-500 bg-gradient-to-r from-amber-50 to-white',
  danger: 'border-l-4 border-red-500 bg-gradient-to-r from-red-50 to-white',
};

const SEVERITY_ICON: Record<string, string> = { info: '💡', warning: '⚠️', danger: '🚨' };

const LEVEL_META: Record<string, { icon: string; color: string }> = {
  missing: { icon: '✗', color: 'text-gray-300' },
  partial: { icon: '~', color: 'text-amber-500' },
  good: { icon: '✓', color: 'text-green-500' },
  complete: { icon: '✓✓', color: 'text-green-600' },
  draft: { icon: '~', color: 'text-amber-500' },
  frozen: { icon: '✓✓', color: 'text-green-600' },
  generated: { icon: '✓✓', color: 'text-green-600' },
};

const BREAKDOWN_ITEMS = [
  { key: 'descriptionLevel', label: '项目描述', weight: 10 },
  { key: 'prdLevel', label: '需求文档', weight: 20 },
  { key: 'planLevel', label: '方案计划', weight: 15 },
  { key: 'featuresLevel', label: '功能清单', weight: 15 },
  { key: 'pagesLevel', label: '页面规划', weight: 10 },
  { key: 'specLevel', label: '规格确认', weight: 20 },
  { key: 'demoLevel', label: 'Demo', weight: 10 },
] as const;

export default function NextStepCard({ projectId, refreshKey }: Props) {
  const router = useRouter();
  const [data, setData] = useState<NextStepData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    api.get(`/api/projects/${projectId}/next-step`)
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [projectId, refreshKey]);

  if (loading) {
    return (
      <div className="p-5 border border-gray-200 rounded-xl bg-white animate-pulse shadow-sm">
        <div className="h-5 bg-gray-200 rounded w-2/3 mb-3" />
        <div className="h-3 bg-gray-200 rounded w-full mb-2" />
        <div className="h-3 bg-gray-200 rounded w-3/4" />
      </div>
    );
  }

  if (!data) return null;

  const style = SEVERITY_STYLES[data.severity] || SEVERITY_STYLES.info;
  const breakdown = data.completenessBreakdown;

  return (
    <div className={`p-5 rounded-xl shadow-sm ${style}`}>
      {/* Header */}
      <div className="flex items-start gap-3 mb-4">
        <span className="text-2xl">{SEVERITY_ICON[data.severity]}</span>
        <div className="flex-1">
          <h3 className="text-base font-bold text-gray-900">{data.title}</h3>
          <p className="text-sm text-gray-600 mt-1">{data.description}</p>
        </div>
        <span className="text-xs px-2 py-1 rounded-full bg-white border border-gray-300 text-gray-600 font-medium whitespace-nowrap">
          置信度 {data.confidence}%
        </span>
      </div>

      {/* Completeness Bar */}
      {data.completeness !== undefined && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-semibold text-gray-700">
              需求完整度
            </span>
            <span className={`text-sm font-bold ${
              data.completeness >= 70 ? 'text-green-600' :
              data.completeness >= 40 ? 'text-amber-600' : 'text-red-600'
            }`}>
              {data.completeness}%
            </span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2.5">
            <div
              className={`h-2.5 rounded-full transition-all duration-700 ${
                data.completeness >= 70 ? 'bg-green-500' :
                data.completeness >= 40 ? 'bg-amber-500' : 'bg-red-500'
              }`}
              style={{ width: `${Math.max(data.completeness, 5)}%` }}
            />
          </div>

          {/* Breakdown details */}
          {breakdown && (
            <div className="mt-2 grid grid-cols-7 gap-0.5">
              {BREAKDOWN_ITEMS.map(({ key, label, weight }) => {
                const level = (breakdown as any)[key] as string;
                const meta = LEVEL_META[level] || { icon: '?', color: 'text-gray-400' };
                const faded = level === 'missing' || level === undefined;
                return (
                  <div key={key} className={`text-center ${faded ? 'opacity-50' : ''}`}>
                    <div className={`text-xs font-medium ${meta.color}`}>
                      {meta.icon}
                    </div>
                    <div className="text-[10px] text-gray-400 leading-tight">{label}</div>
                    <div className="text-[9px] text-gray-300">{weight}%</div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Confidence explanation */}
          <p className="text-[10px] text-gray-400 mt-1.5">
            置信度 = 已填写数据维度 × 15 + 10（维度越多越可靠）
          </p>
        </div>
      )}

      {/* Next Steps — 改进建议 */}
      {data.nextSteps.length > 0 && (
        <div className="mb-3">
          <p className="text-xs font-semibold text-blue-700 mb-2 uppercase tracking-wide">
            💬 你可以这样完善
          </p>
          <div className="space-y-2">
            {data.nextSteps.map((s, i) => (
              <div key={i} className="flex items-start gap-2 p-2.5 bg-blue-50 border border-blue-200 rounded-lg">
                <span className="text-blue-500 font-bold text-sm mt-0.5">{i + 1}.</span>
                <span className="text-sm text-blue-800">{s}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Reasons */}
      {data.reasons.length > 0 && (
        <div className="mb-3">
          <p className="text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">判定依据</p>
          <div className="flex flex-wrap gap-1.5">
            {data.reasons.map((r, i) => (
              <span key={i} className="text-xs px-2 py-1 bg-white rounded-full border border-gray-200 text-gray-700">
                {r}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex flex-wrap gap-2">
        {data.actionLinks && Object.entries(data.actionLinks).map(([label, route]) => (
          <button
            key={label}
            onClick={() => router.push(route)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all shadow-sm hover:shadow ${
              data.severity === 'danger' ? 'bg-red-600 text-white hover:bg-red-700' :
              data.severity === 'warning' ? 'bg-amber-600 text-white hover:bg-amber-700' :
              'bg-blue-600 text-white hover:bg-blue-700'
            }`}
          >
            {label} →
          </button>
        ))}
        {(!data.actionLinks || Object.keys(data.actionLinks).length === 0) && data.nextSteps.length > 0 && (
          data.nextSteps.map((s, i) => (
            <span key={i} className="text-xs px-3 py-1.5 bg-white rounded-full border border-gray-300 text-gray-600">
              {s}
            </span>
          ))
        )}
      </div>
    </div>
  );
}
