'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import NavBar from '@/lib/nav-bar';
import WarningCard from '@/components/warning-card';

interface SpecData {
  exists: boolean;
  status?: string;
  coreFunctions?: { name: string; description: string; priority: string }[];
  pages?: { name: string; route: string; description: string }[];
  roles?: { name: string; permissions: string[] }[];
  estimatedCostRmb?: number;
  estimatedDays?: number;
}

interface PlanData {
  features?: string[];
  pages?: string[];
  estimatedDays?: number;
  estimatedPriceRange?: string;
}

export default function HandoffPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;
  const { token, isLoading } = useAuth();

  const [projectName, setProjectName] = useState('');
  const [spec, setSpec] = useState<SpecData | null>(null);
  const [plan, setPlan] = useState<PlanData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isLoading) return;
    if (!token) { router.push('/'); return; }

    Promise.all([
      api.get(`/api/projects/${projectId}`),
      api.get(`/api/projects/${projectId}/specification`),
      api.get(`/api/projects/${projectId}/plan`),
    ])
      .then(([proj, s, p]) => {
        setProjectName(proj.name || '');
        setSpec(s);
        setPlan(p);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [projectId, token, isLoading, router]);

  if (isLoading) return null;

  const features = spec?.coreFunctions || [];
  const pages = spec?.pages || [];
  const planFeatures = plan?.features || [];
  const planPages = plan?.pages || [];

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar projectId={projectId} projectName={projectName} />

      <div className="px-6 pt-4">
        <WarningCard
          projectId={projectId}
          title="开发前需要特别注意"
          description="这些提醒可以帮助后续开发时少走弯路。"
        />
      </div>

      <div className="px-6 py-8">
        <div className="mx-auto max-w-3xl">
          <h1 className="mb-6 text-2xl font-bold text-gray-900">产品开发包</h1>

          {loading ? (
            <div className="p-8 text-gray-500">加载中...</div>
          ) : (
            <>
              {/* 规格概览 */}
              {spec?.exists && (
                <>
                  <div className="grid grid-cols-2 gap-4 mb-6">
                    <div className="rounded-xl bg-white p-5 shadow-sm border border-gray-200">
                      <p className="text-xs text-gray-500 mb-1">规格状态</p>
                      <p className="text-lg font-bold text-blue-600">
                        {spec.status === 'frozen' ? '已冻结' : spec.status === 'draft' ? '草稿' : '未生成'}
                      </p>
                    </div>
                    <div className="rounded-xl bg-white p-5 shadow-sm border border-gray-200">
                      <p className="text-xs text-gray-500 mb-1">包含功能</p>
                      <p className="text-lg font-bold text-blue-600">
                        {features.length || planFeatures.length} 个
                      </p>
                    </div>
                  </div>

                  {/* 功能清单 */}
                  {(features.length > 0 || planFeatures.length > 0) && (
                    <div className="mb-6 rounded-xl bg-white p-5 shadow-sm border border-gray-200">
                      <h2 className="text-base font-semibold text-gray-800 mb-3">功能清单</h2>
                      <div className="space-y-2">
                        {(features.length > 0 ? features : planFeatures.map((f: any) =>
                          typeof f === 'string' ? { name: f, description: '', priority: 'must' } : f
                        )).map((f: any, i: number) => (
                          <div key={i} className="flex items-start gap-2 p-2.5 rounded-lg bg-gray-50">
                            <span className={`mt-0.5 text-xs px-1.5 py-0.5 rounded font-medium text-white ${
                              (f.priority || 'must') === 'must' ? 'bg-blue-500' : 'bg-gray-400'
                            }`}>
                              {(f.priority || 'must') === 'must' ? '必须' : '可选'}
                            </span>
                            <div>
                              <p className="text-sm font-medium text-gray-800">{f.name}</p>
                              {f.description && (
                                <p className="text-xs text-gray-500 mt-0.5">{f.description}</p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 页面清单 */}
                  {(pages.length > 0 || planPages.length > 0) && (
                    <div className="mb-6 rounded-xl bg-white p-5 shadow-sm border border-gray-200">
                      <h2 className="text-base font-semibold text-gray-800 mb-3">页面清单</h2>
                      <div className="flex flex-wrap gap-2">
                        {(pages.length > 0 ? pages.map((p: any) => p.name || p) : planPages).map((p: string, i: number) => (
                          <span key={i} className="text-sm px-3 py-1.5 bg-gray-100 rounded-full text-gray-700 border border-gray-200">
                            {p}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* 未生成规格 */}
              {(!spec?.exists && planFeatures.length === 0) && (
                <div className="rounded-xl bg-white p-8 shadow-sm border border-gray-200 text-center">
                  <p className="text-gray-400">暂无开发包数据，请先完成需求澄清和方案确认。</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
