'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import NavBar from '@/lib/nav-bar';
import WarningCard from '@/components/warning-card';

interface RiskItem {
  name: string; severity: string; description: string;
}

interface EstimateData {
  estimatedCostRmb?: number;
  estimatedDays?: number;
  primaryRisks?: RiskItem[];
  featureCount?: number;
  pageCount?: number;
}

export default function EstimatePage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;
  const { token, isLoading } = useAuth();

  const [projectName, setProjectName] = useState('');
  const [data, setData] = useState<EstimateData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isLoading) return;
    if (!token) { router.push('/'); return; }

    Promise.all([
      api.get(`/api/projects/${projectId}`),
      api.get(`/api/projects/${projectId}/plan`),
      api.get(`/api/projects/${projectId}/specification`),
    ])
      .then(([proj, plan, spec]) => {
        setProjectName(proj.name || '');
        setData({
          estimatedCostRmb: spec?.estimatedCostRmb || plan?.estimatedCostRmb,
          estimatedDays: spec?.estimatedDays || plan?.estimatedDays,
          primaryRisks: spec?.primaryRisks || plan?.risks || [],
          featureCount: plan?.features?.length || 0,
          pageCount: plan?.pages?.length || 0,
        });
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [projectId, token, isLoading, router]);

  if (isLoading) return null;

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar projectId={projectId} projectName={projectName} />

      <div className="px-6 pt-4">
        <WarningCard projectId={projectId} />
      </div>

      <div className="px-6 py-8">
        <div className="mx-auto max-w-3xl">
          <h1 className="mb-6 text-2xl font-bold text-gray-900">开工前预测</h1>

          {loading ? (
            <div className="p-8 text-gray-500">加载中...</div>
          ) : data ? (
            <>
              {/* 概览统计 */}
              <div className="grid grid-cols-3 gap-4 mb-6">
                <div className="rounded-xl bg-white p-5 shadow-sm border border-gray-200">
                  <p className="text-xs text-gray-500 mb-1">预估费用</p>
                  <p className="text-xl font-bold text-green-600">
                    {data.estimatedCostRmb ? `¥${data.estimatedCostRmb.toLocaleString()}` : '待估算'}
                  </p>
                </div>
                <div className="rounded-xl bg-white p-5 shadow-sm border border-gray-200">
                  <p className="text-xs text-gray-500 mb-1">预估周期</p>
                  <p className="text-xl font-bold text-purple-600">
                    {data.estimatedDays ? `${data.estimatedDays} 天` : '待估算'}
                  </p>
                </div>
                <div className="rounded-xl bg-white p-5 shadow-sm border border-gray-200">
                  <p className="text-xs text-gray-500 mb-1">功能数量</p>
                  <p className="text-xl font-bold text-blue-600">
                    {data.featureCount || 0} 个
                  </p>
                </div>
              </div>

              {/* 风险清单 */}
              {data.primaryRisks && data.primaryRisks.length > 0 && (
                <div className="mb-6 rounded-xl bg-white p-5 shadow-sm border border-gray-200">
                  <h2 className="text-base font-semibold text-gray-800 mb-3">已识别的风险</h2>
                  <div className="space-y-2">
                    {data.primaryRisks.map((r, i) => (
                      <div
                        key={i}
                        className={`rounded-lg border p-3 text-sm ${
                          r.severity === 'high' ? 'border-red-200 bg-red-50' :
                          r.severity === 'medium' ? 'border-amber-200 bg-amber-50' :
                          'border-gray-200 bg-gray-50'
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-xs px-1.5 py-0.5 rounded font-medium text-white ${
                            r.severity === 'high' ? 'bg-red-500' :
                            r.severity === 'medium' ? 'bg-amber-500' : 'bg-gray-400'
                          }`}>
                            {r.severity === 'high' ? '高' : r.severity === 'medium' ? '中' : '低'}
                          </span>
                          <span className="font-medium text-gray-800">{r.name}</span>
                        </div>
                        {r.description && (
                          <p className="text-gray-600 text-xs ml-1">{r.description}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="p-8 text-gray-400 text-center">暂无预测数据，请先完成需求澄清。</div>
          )}
        </div>
      </div>
    </div>
  );
}
