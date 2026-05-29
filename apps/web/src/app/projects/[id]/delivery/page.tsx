'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import { useToast } from '@/lib/toast';
import NavBar from '@/lib/nav-bar';

const EXPORT_BUTTONS = [
  { key: 'source-download', label: '下载源码', endpoint: 'request-source-download' },
  { key: 'package-export', label: '导出项目包', endpoint: 'request-package-export' },
  { key: 'repository-transfer', label: '交付到我的代码仓库', endpoint: 'request-repository-transfer' },
  { key: 'database-export', label: '导出数据库结构', endpoint: 'request-database-export' },
  { key: 'deployment-config', label: '导出部署配置', endpoint: 'request-deployment-config' },
];

const EXPORT_FIELD_MAP: Record<string, string> = {
  'source-download': 'sourceZipUrl',
  'package-export': 'packageZipUrl',
  'repository-transfer': 'repositoryUrl',
  'database-export': 'databaseSchemaUrl',
  'deployment-config': 'deploymentConfigUrl',
};

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
  const [exportStates, setExportStates] = useState<Record<string, { loading: boolean; done: boolean; url?: string }>>({});
  const [caseReview, setCaseReview] = useState<any>(null);
  const [recommendations, setRecommendations] = useState<any[]>([]);

  // 轮询交付进度
  const pollInterval = 5000;

  const fetchReviewAndRecs = async () => {
    try {
      const [review, recs] = await Promise.all([
        api.get(`/api/projects/${projectId}/case-review`),
        api.get(`/api/projects/${projectId}/experience-recommendations`),
      ]);
      setCaseReview(review);
      setRecommendations(recs || []);
    } catch {
      // Review/recommendations may not exist yet (being generated async)
    }
  };

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
          if (d.status === 'completed') {
            fetchReviewAndRecs();
          }
        })
        .catch((err) => {
          setLoading(false);
          setError(err.message || '加载失败');
        });

    fetchDelivery();

    // 如果项目正在交付中，轮询状态变化
    const timer = setInterval(() => {
      api.get(`/api/projects/${projectId}/delivery`).then((d) => {
        setDelivery(d);
        if (d.status === 'completed' || d.status === 'build_failed') {
          clearInterval(timer);
        }
        if (d.status === 'completed') {
          fetchReviewAndRecs();
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

  const handleExport = async (buttonKey: string, endpoint: string) => {
    if (!delivery?.isPro) {
      toast('高级交付服务需升级套餐，请联系平台顾问。', 'info');
      return;
    }

    setExportStates(prev => ({ ...prev, [buttonKey]: { loading: true, done: false } }));

    try {
      const result = await api.post(`/api/projects/${projectId}/delivery/${endpoint}`);
      if (result.upgradeRequired) {
        toast(result.message, 'info');
        setExportStates(prev => ({ ...prev, [buttonKey]: { loading: false, done: false } }));
        return;
      }

      toast('导出任务已启动...', 'success');

      // 轮询等待导出完成（最多等 30 秒）
      let attempts = 0;
      const maxAttempts = 10;
      const pollForExport = async (): Promise<void> => {
        attempts++;
        try {
          const d = await api.get(`/api/projects/${projectId}/delivery`);
          setDelivery(d);
          const field = EXPORT_FIELD_MAP[buttonKey];
          const url = d?.latestBuild?.[field];
          if (url) {
            setExportStates(prev => ({
              ...prev,
              [buttonKey]: { loading: false, done: true, url },
            }));
            toast('导出完成', 'success');
            return;
          }
        } catch {
          // 继续轮询
        }
        if (attempts < maxAttempts) {
          setTimeout(pollForExport, 3000);
        } else {
          setExportStates(prev => ({
            ...prev,
            [buttonKey]: { loading: false, done: false },
          }));
          toast('导出处理中，请稍后刷新页面查看', 'info');
        }
      };
      setTimeout(pollForExport, 3000);
    } catch (err: any) {
      toast(err.message || '导出失败', 'error');
      setExportStates(prev => ({ ...prev, [buttonKey]: { loading: false, done: false } }));
    }
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

          {/* ─── 交付进度 ─── */}
          {isDelivering && (
            <section className="mb-6 rounded-xl bg-blue-50 p-6 shadow-sm border border-blue-200">
              <h2 className="mb-3 text-lg font-semibold text-blue-800">交付进行中</h2>
              <div className="flex items-center gap-3">
                <div className="h-2 w-full rounded-full bg-blue-200">
                  <div
                    className="h-2 animate-pulse rounded-full bg-blue-600 transition-all duration-700"
                    style={{ width: `${delivery?.latestBuild?.status === 'building' ? 60 : delivery?.latestBuild?.status === 'success' ? 90 : 35}%` }}
                  ></div>
                </div>
                <span className="text-sm text-blue-600 shrink-0">
                  {delivery?.latestBuild?.status === 'building' ? '正在打包生成...' : '正在分析处理...'}
                </span>
              </div>
              <div className="mt-2 text-sm text-blue-600 space-y-1">
                <p>系统正在自动处理交付流程，请耐心等待。页面将自动刷新进度。</p>
                {delivery?.latestBuild?.version && (
                  <p className="text-xs text-blue-400">构建版本 #{delivery.latestBuild.version}</p>
                )}
              </div>
            </section>
          )}

          {/* ─── 交付失败 ─── */}
          {isFailed && (
            <section className="mb-6 rounded-xl bg-red-50 p-6 shadow-sm border border-red-200">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <h2 className="text-lg font-semibold text-red-800">交付失败</h2>
                  {error && (
                    <p className="mt-1 text-sm text-red-600">{error}</p>
                  )}
                  {!error && (
                    <p className="mt-1 text-sm text-red-600">
                      交付过程中出现异常，请重试或联系平台。
                    </p>
                  )}
                  {delivery?.latestBuild?.testReport?.error && (
                    <p className="mt-2 text-xs text-red-500 font-mono bg-red-100 rounded p-2">
                      {delivery.latestBuild.testReport.error}
                    </p>
                  )}
                  {delivery?.latestBuild && !delivery.latestBuild.testReport?.error && (
                    <p className="mt-2 text-xs text-red-400">
                      构建版本 #{delivery.latestBuild.version} — 状态: {delivery.latestBuild.status}
                    </p>
                  )}
                </div>
                <button
                  onClick={handleRetry}
                  disabled={starting}
                  className="ml-4 shrink-0 rounded-lg bg-red-600 px-4 py-2 text-white hover:bg-red-700 disabled:bg-red-300 transition-colors"
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

            {/* 项目评估数据 */}
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
          <section className="mb-6 rounded-xl bg-white p-6 shadow-sm">
            <h2 className="mb-3 text-lg font-semibold text-gray-800">高级交付服务</h2>
            <div className="grid grid-cols-2 gap-3">
              {EXPORT_BUTTONS.map((item) => {
                const state = exportStates[item.key];
                const isLoading = state?.loading;
                const isDone = state?.done;
                const downloadUrl = state?.url;

                return (
                  <button
                    key={item.key}
                    onClick={() => handleExport(item.key, item.endpoint)}
                    disabled={isLoading || isDelivering || !delivery?.isPro}
                    className={`rounded-lg border p-4 text-left text-sm transition-colors ${
                      isDone
                        ? 'border-green-300 bg-green-50'
                        : isLoading
                        ? 'border-blue-200 bg-blue-50'
                        : 'text-gray-700 hover:bg-gray-50'
                    } disabled:opacity-60 disabled:cursor-not-allowed`}
                  >
                    <div className="flex items-center gap-2">
                      {isLoading && <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />}
                      {isDone && <span className="text-green-600">✅</span>}
                      <span className={isDone ? 'text-green-700' : ''}>{item.label}</span>
                    </div>
                    {isDone && downloadUrl && (
                      <a
                        href={downloadUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="mt-1 inline-block text-xs text-blue-600 hover:underline"
                      >
                        下载文件 ↗
                      </a>
                    )}
                    {isDone && !downloadUrl && (
                      <p className="mt-1 text-xs text-green-600">已完成</p>
                    )}
                    {isLoading && (
                      <p className="mt-1 text-xs text-blue-600">处理中...</p>
                    )}
                    {!isLoading && !isDone && !delivery?.isPro && (
                      <p className="mt-1 text-xs text-gray-400">这是高级交付服务，如需开通请联系平台顾问。</p>
                    )}
                  </button>
                );
              })}
            </div>
          </section>

          {/* ─── 复盘报告 ─── */}
          {caseReview && (
            <section className="mb-6 rounded-xl bg-white p-6 shadow-sm">
              <h2 className="mb-3 text-lg font-semibold text-gray-800">📋 项目复盘</h2>
              <div className="space-y-3 text-sm text-gray-700">
                {caseReview.summary && (
                  <p className="text-gray-600">{caseReview.summary}</p>
                )}
                {caseReview.appType && (
                  <p><span className="font-medium text-gray-500">项目类型：</span>{caseReview.appType}</p>
                )}
                {caseReview.mainErrors?.length > 0 && (
                  <div>
                    <p className="font-medium text-gray-500 mb-1">主要问题：</p>
                    <ul className="list-disc pl-4 space-y-1">
                      {caseReview.mainErrors.map((e: any, i: number) => (
                        <li key={i} className={e.severity === 'high' ? 'text-red-600' : 'text-yellow-600'}>
                          [{e.stage}] {e.description}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {caseReview.reusableLessons?.length > 0 && (
                  <div>
                    <p className="font-medium text-gray-500 mb-1">可复用经验：</p>
                    <ul className="list-disc pl-4">
                      {caseReview.reusableLessons.map((l: string, i: number) => (
                        <li key={i}>{l}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* ─── 经验推荐 ─── */}
          {recommendations.length > 0 && (
            <section className="rounded-xl bg-white p-6 shadow-sm">
              <h2 className="mb-3 text-lg font-semibold text-gray-800">💡 经验推荐</h2>
              <div className="space-y-3">
                {recommendations.map((rec: any, i: number) => (
                  <div key={i} className="rounded-lg bg-gray-50 p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-700">
                        {rec.recommendationType}
                      </span>
                      <span className="text-xs text-gray-400">{rec.stage}</span>
                    </div>
                    {rec.recommendation?.title && (
                      <p className="text-sm font-medium text-gray-800">{rec.recommendation.title}</p>
                    )}
                    {rec.recommendation?.content && (
                      <p className="text-sm text-gray-600 mt-1">{rec.recommendation.content}</p>
                    )}
                    {rec.recommendation?.tags?.length > 0 && (
                      <div className="flex gap-1 mt-1">
                        {rec.recommendation.tags.map((tag: string, j: number) => (
                          <span key={j} className="rounded bg-gray-200 px-1.5 py-0.5 text-xs text-gray-500">{tag}</span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
