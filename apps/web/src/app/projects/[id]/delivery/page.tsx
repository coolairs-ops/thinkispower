'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import { useToast } from '@/lib/toast';
import NavBar from '@/lib/nav-bar';

export default function DeliveryPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;
  const { token, isLoading } = useAuth();
  const { toast } = useToast();

  const [delivery, setDelivery] = useState<any>(null);
  const [projectName, setProjectName] = useState('');
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 状态观测器 — 轮询交付状态
  const pollInterval = 5000; // 5 秒

  useEffect(() => {
    if (isLoading) return;
    if (!token) { router.push('/'); return; }

    const fetchDelivery = () =>
      Promise.all([
        api.get(`/api/projects/${projectId}/delivery`),
        api.get(`/api/projects/${projectId}`),
      ])
        .then(([d, proj]) => {
          setDelivery(d);
          setProjectName(proj.name || '');
          setLoading(false);
          setError(null);
        })
        .catch((err) => {
          setLoading(false);
          setError(err.message || '加载失败');
        });

    fetchDelivery();

    // 如果项目正在交付中，轮询状态变化
    const timer = setInterval(() => {
      // 只当状态是 exporting 或 deploying 时继续轮询
      api.get(`/api/projects/${projectId}/delivery`).then((d) => {
        setDelivery(d);
        if (d.status === 'completed' || d.status === 'build_failed') {
          clearInterval(timer);
        }
      }).catch(() => {});
    }, pollInterval);

    return () => clearInterval(timer);
  }, [projectId, token, isLoading, router]);

  const handleStartDelivery = async () => {
    if (starting) return;
    setStarting(true);
    setError(null);
    try {
      const result = await api.post(`/api/projects/${projectId}/delivery/confirm`);
      setDelivery((prev: any) => ({ ...prev, status: 'exporting' }));
      toast('交付流程已启动，正在分析项目...', 'success');

      // 如果分析报告中有风险提示，展示给用户
      if (result.analysis?.risks?.length > 0) {
        const highRisks = result.analysis.risks.filter((r: any) => r.severity === 'high');
        if (highRisks.length > 0) {
          toast(`发现 ${highRisks.length} 个高风险项，请关注交付进度`, 'info');
        }
      }
    } catch (err: any) {
      toast(err.message || '启动交付失败，请重试', 'error');
      setError(err.message || '启动交付失败');
    }
    setStarting(false);
  };

  const handleRetry = () => {
    setError(null);
    handleStartDelivery();
  };

  if (isLoading) return null;
  if (loading) return <div className="p-8 text-gray-500">加载中...</div>;

  const status = delivery?.status;
  const isDelivering = status === 'exporting' || status === 'deploying';
  const isCompleted = status === 'completed';
  const isFailed = status === 'build_failed';

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar projectId={projectId} projectName={projectName} />

      <div className="px-6 py-8">
        <div className="mx-auto max-w-3xl">
          <h1 className="mb-6 text-2xl font-bold text-gray-900">交付</h1>

          {/* ─── 状态观测器：交付进度 ─── */}
          {isDelivering && (
            <section className="mb-6 rounded-xl bg-blue-50 p-6 shadow-sm border border-blue-200">
              <h2 className="mb-3 text-lg font-semibold text-blue-800">交付进行中</h2>
              <div className="flex items-center gap-3">
                <div className="h-2 w-full rounded-full bg-blue-200">
                  <div className="h-2 w-1/2 animate-pulse rounded-full bg-blue-600"></div>
                </div>
                <span className="text-sm text-blue-600 shrink-0">
                  {status === 'exporting' ? '正在打包导出...' : '正在上线...'}
                </span>
              </div>
              <p className="mt-2 text-sm text-blue-600">
                系统正在自动处理交付流程，请耐心等待。页面将自动刷新进度。
              </p>
            </section>
          )}

          {/* ─── 交付失败 ─── */}
          {isFailed && (
            <section className="mb-6 rounded-xl bg-red-50 p-6 shadow-sm border border-red-200">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-red-800">❌ 交付失败</h2>
                  <p className="mt-1 text-sm text-red-600">
                    {delivery?.latestBuild?.testReport?.error || '交付过程中出现异常，请重试或联系平台。'}
                  </p>
                </div>
                <button
                  onClick={handleRetry}
                  disabled={starting}
                  className="rounded-lg bg-red-600 px-4 py-2 text-white hover:bg-red-700 disabled:bg-red-300 transition-colors"
                >
                  {starting ? '重试中...' : '重新交付'}
                </button>
              </div>
            </section>
          )}

          {/* ─── 已完成 ─── */}
          {isCompleted && (
            <section className="mb-6 rounded-xl bg-green-50 p-6 shadow-sm border border-green-200">
              <h2 className="mb-3 text-lg font-semibold text-green-800">✅ 已交付</h2>
              {delivery?.productionUrl && (
                <div className="space-y-2">
                  <p className="text-sm text-green-700">软件已上线，可通过以下地址访问：</p>
                  <a
                    href={delivery.productionUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block rounded-lg bg-green-600 px-4 py-2 text-white hover:bg-green-700 transition-colors"
                  >
                    打开软件
                  </a>
                </div>
              )}
              {/* 展示交付分析结果 */}
              {delivery?.deliveryAnalysis && (
                <div className="mt-3 text-sm text-green-700">
                  <p>完整度评估：{delivery.deliveryAnalysis.completeness}%</p>
                  {delivery.deliveryAnalysis.recommendations?.length > 0 && (
                    <ul className="mt-1 list-disc pl-4">
                      {delivery.deliveryAnalysis.recommendations.map((r: string, i: number) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </section>
          )}

          {/* ─── 在线访问 ─── */}
          <section className="mb-6 rounded-xl bg-white p-6 shadow-sm">
            <h2 className="mb-3 text-lg font-semibold text-gray-800">在线访问</h2>
            {delivery?.productionUrl ? (
              <div>
                <a
                  href={delivery.productionUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline"
                >
                  {delivery.productionUrl}
                </a>
                <p className="mt-2 text-sm text-gray-500">
                  管理员账号：{delivery.adminEmail || 'admin@example.com'} / 密码请联系平台
                </p>
              </div>
            ) : (
              <p className="text-gray-400">尚未部署</p>
            )}
          </section>

          {/* ─── 操作 ─── */}
          <section className="mb-6 rounded-xl bg-white p-6 shadow-sm">
            <h2 className="mb-3 text-lg font-semibold text-gray-800">操作</h2>
            <div className="flex flex-wrap gap-3">
              {delivery?.productionUrl && (
                <a
                  href={delivery.productionUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
                >
                  打开软件
                </a>
              )}
              <button
                onClick={handleStartDelivery}
                disabled={starting || isDelivering || isCompleted}
                className={`rounded-lg border px-4 py-2 transition-colors ${
                  isCompleted
                    ? 'border-green-300 bg-green-50 text-green-700 cursor-default'
                    : isDelivering
                    ? 'border-blue-300 bg-blue-50 text-blue-700 cursor-wait'
                    : starting
                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    : 'text-gray-700 hover:bg-gray-50 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed'
                }`}
              >
                {isCompleted
                  ? '✅ 已交付'
                  : isDelivering
                  ? '交付中...'
                  : starting
                  ? '启动中...'
                  : '开始交付'}
              </button>
              <button
                onClick={() => router.push(`/projects/${projectId}/demo`)}
                className="rounded-lg border px-4 py-2 text-gray-700 hover:bg-gray-50"
              >
                继续修改
              </button>
            </div>

            {/* 工程控制论信息展示 — 状态观测器数据 */}
            {delivery?.deliveryAnalysis && !isCompleted && (
              <div className="mt-4 rounded-lg bg-gray-50 p-4">
                <h3 className="text-sm font-semibold text-gray-700">项目评估报告</h3>
                <div className="mt-2 space-y-2 text-sm text-gray-600">
                  <p>完整度：{delivery.deliveryAnalysis.completeness}%</p>
                  {delivery.deliveryAnalysis.risks?.length > 0 && (
                    <div>
                      <p className="font-medium">风险提示：</p>
                      <ul className="list-disc pl-4">
                        {delivery.deliveryAnalysis.risks.map((r: any, i: number) => (
                          <li key={i} className={r.severity === 'high' ? 'text-red-600' : r.severity === 'medium' ? 'text-yellow-600' : 'text-gray-600'}>
                            [{r.severity === 'high' ? '高风险' : r.severity === 'medium' ? '中风险' : '低风险'}] {r.description}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>

          {/* ─── 高级交付服务 ─── */}
          <section className="rounded-xl bg-white p-6 shadow-sm">
            <h2 className="mb-3 text-lg font-semibold text-gray-800">高级交付服务</h2>
            <div className="grid grid-cols-2 gap-3">
              {[
                { key: 'source-download', label: '下载源码' },
                { key: 'package-export', label: '导出项目包' },
                { key: 'repository-transfer', label: '交付到我的代码仓库' },
                { key: 'database-export', label: '导出数据库结构' },
                { key: 'deployment-config', label: '导出部署配置' },
              ].map((item) => (
                <button
                  key={item.key}
                  onClick={() => {/* keep existing handler */}}
                  className="rounded-lg border p-4 text-left text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  {item.label}
                  {!delivery?.isPro && (
                    <p className="mt-1 text-xs text-gray-400">这是高级交付服务，如需开通请联系平台顾问。</p>
                  )}
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
