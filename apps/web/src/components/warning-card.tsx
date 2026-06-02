'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface Warning {
  patternKey: string;
  publicName: string;
  description: string;
  recommendations: string[];
  severity: 'high' | 'medium' | 'low';
}

interface Props {
  projectId: string;
  refreshKey?: string | number;
  title?: string;
  description?: string;
}

export default function WarningCard({ projectId, refreshKey, title, description }: Props) {
  const [warnings, setWarnings] = useState<Warning[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    api.get(`/api/projects/${projectId}/warnings`)
      .then(setWarnings)
      .catch(() => setWarnings([]))
      .finally(() => setLoading(false));
  }, [projectId, refreshKey]);

  if (loading || warnings.length === 0) return null;

  const highCount = warnings.filter(w => w.severity === 'high').length;

  return (
    <div className="border border-amber-200 bg-amber-50 rounded-xl overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-amber-100/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-lg">⚠️</span>
          <span className="text-sm font-semibold text-amber-800">
            {title || '系统提醒你注意的地方'}
          </span>
          <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-200 text-amber-700 font-medium">
            {warnings.length} 条
          </span>
        </div>
        <span className="text-xs text-amber-500">{collapsed ? '展开 ▼' : '收起 ▲'}</span>
      </button>

      {/* Description */}
      {description && (
        <div className="px-4 pb-2">
          <p className="text-xs text-amber-700">{description}</p>
        </div>
      )}

      {/* Body */}
      {!collapsed && (
        <div className="px-4 pb-4 space-y-2">
          {warnings.map((w, i) => (
            <div
              key={w.patternKey || i}
              className={`p-3 rounded-lg border text-sm ${
                w.severity === 'high'
                  ? 'border-red-200 bg-red-50'
                  : 'border-amber-100 bg-white'
              }`}
            >
              <div className="flex items-start gap-2">
                <span className="mt-0.5">
                  {w.severity === 'high' ? '🔴' : '🟡'}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900">{w.publicName}</p>
                  {w.description && (
                    <p className="text-xs text-gray-500 mt-0.5">{w.description}</p>
                  )}
                  {w.recommendations.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {w.recommendations.map((r, j) => (
                        <span
                          key={j}
                          className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200"
                        >
                          {r}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
