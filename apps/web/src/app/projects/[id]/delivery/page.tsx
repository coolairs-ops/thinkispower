'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import { useToast } from '@/lib/toast';
import NavBar from '@/lib/nav-bar';

// ─── Types ───

interface ExportState {
  loading: boolean;
  done: boolean;
  failed: boolean;
  url?: string;
  error?: string;
}

// ─── Constants ───

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

/** 将内部错误转换为用户可理解的消息 */
function sanitizeExportError(err: unknown, fallback: string): string {
  if (!err) return fallback;
  const msg = (typeof err === 'string' ? err :
    err instanceof Error ? err.message : '').toLowerCase();

  if (msg.includes('upgrade') || msg.includes('升级套餐')) return '该服务需升级套餐才能使用。';
  if (msg.includes('timeout') || msg.includes('超时')) return '处理超时，请稍后重试。';
  if (msg.includes('network') || msg.includes('fetch') || msg.includes('econnrefused')) return '网络异常，请检查连接后重试。';
  if (msg.includes('429') || msg.includes('rate limit')) return '请求过于频繁，请稍后重试。';
  if (msg.includes('403') || msg.includes('forbidden')) return '暂无权限执行此操作。';
  if (msg.includes('404') || msg.includes('not found')) return '项目数据异常，请刷新页面。';

  return fallback;
}

// ─── Component ───

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
  const [exportStates, setExportStates] = useState<Record<string, ExportState>>({});
  const [caseReview, setCaseReview] = useState<any>(null);
  const [recommendations, setRecommendations] = useState<any[]>([]);

  const deliveryRef = useRef(delivery);
  deliveryRef.current = delivery;

  // ── 从 delivery.latestBuild 推导各导出项状态 ──
  const syncExportStatesFromDelivery = useCallback((d: any) => {
    if (!d?.latestBuild) return;
    const build = d.latestBuild;
    setExportStates(prev => {
      let changed = false;
      const next: Record<string, ExportState> = {};
      for (const key of Object.keys(prev)) {
        next[key] = { ...prev[key] };
      }
      for (const [key, field] of Object.entries(EXPORT_FIELD_MAP)) {
        const url = build[field];
        if (url && !prev[key]?.loading) {
          next[key] = { loading: false, done: true, failed: false, url };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  // ── 基本面加载 + 轮询 ──
  useEffect(() => {
    if (isLoading) return;
    if (!token) { router.push('/'); return; }

    const initLoading = () =>
      Promise.all([
        api.get(`/api/projects/${projectId}/delivery`),
        api.get(`/api/projects/${projectId}`),
      ])
        .then(([d, proj]) => {
          setDelivery(d);
          setProjectName(proj.name || '');
          setLoading(false);
          setError(null);
          syncExportStatesFromDelivery(d);
          if (d.status === 'completed') {
            fetchReviewAndRecs();
          }
        })
        .catch((err) => {
          setLoading(false);
          setError(err.message || '加载失败');
        });

    initLoading();

    const timer = setInterval(() => {
      api.get(`/api/projects/${projectId}/delivery`).then((d) => {
        setDelivery(d);
        syncExportStatesFromDelivery(d);
        if (d.status === 'completed' || d.status === 'build_failed') {
          clearInterval(timer);
        }
        if (d.status === 'completed') {
          fetchReviewAndRecs();
        }
      }).catch(() => {});
    }, 5000);

    return () => clearInterval(timer);
  }, [projectId, token, isLoading, router, syncExportStatesFromDelivery]);

  // ── 案例复盘 & 经验推荐 ──
  const fetchReviewAndRecs = async () => {
    try {
      const [review, recs] = await Promise.all([
        api.get(`/api/projects/${projectId}/case-review`),
        api.get(`/api/projects/${projectId}/experience-recommendations`),
      ]);
      setCaseReview(review);
      setRecommendations(recs || []);
    } catch {
      // Review/recommendations may not exist yet
    }
  };

  // ── 主交付流程 ──
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

  // ── 单导出项 ──
  const handleExport = async (buttonKey: string, endpoint: string) => {
    if (!delivery?.isPro) {
      toast('高级交付服务需升级套餐，请联系平台顾问。', 'info');
      return;
    }

    setExportStates(prev => ({ ...prev, [buttonKey]: { loading: true, done: false, failed: false } }));

    try {
      const result = await api.post(`/api/projects/${projectId}/delivery/${endpoint}`);
      if (result.upgradeRequired) {
        toast(result.message, 'info');
        setExportStates(prev => ({ ...prev, [buttonKey]: { loading: false, done: false, failed: false } }));
        return;
      }

      toast('导出任务已启动...', 'success');

      // 轮询等待导出完成（最多等 30 秒）
      let attempts = 0;
      const maxAttempts = 10;
      const pollFn = async (): Promise<void> => {
        attempts++;
        try {
          const d = await api.get(`/api/projects/${projectId}/delivery`);
          setDelivery(d);
          const field = EXPORT_FIELD_MAP[buttonKey];
          const url = d?.latestBuild?.[field];
          if (url) {
            setExportStates(prev => ({
              ...prev,
              [buttonKey]: { loading: false, done: true, failed: false, url },
            }));
            toast('导出完成', 'success');
            return;
          }
        } catch {
          // 继续轮询
        }
        if (attempts < maxAttempts) {
          setTimeout(pollFn, 3000);
        } else {
          setExportStates(prev => ({
            ...prev,
            [buttonKey]: { loading: false, done: false, failed: false },
          }));
          toast('导出处理中，请稍后刷新页面查看', 'info');
        }
      };
      setTimeout(pollFn, 3000);
    } catch (err: any) {
      const friendly = sanitizeExportError(err, '导出失败，请稍后重试。');
      toast(friendly, 'error');
      setExportStates(prev => ({
        ...prev,
        [buttonKey]: { loading: false, done: false, failed: true, error: friendly },
      }));
    }
  };

  // ── 复制链接 ──
  const handleCopyUrl = async (url: string, label: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast(`${label} 链接已复制`, 'success');
    } catch {
      toast('复制失败，请手动复制', 'error');
    }
  };

  // ═══════════ 计算导出进度 ═══════════

  const completedCount = EXPORT_BUTTONS.filter(b => exportStates[b.key]?.done).length;
  const totalExportCount = EXPORT_BUTTONS.length;
  const progressPercent = totalExportCount > 0 ? Math.round((completedCount / totalExportCount) * 100) : 0;

  // ═══════════ 渲染 ═══════════

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

          {/* ─── 交付进度 — 详细状态面板 ─── */}
          {isDelivering && (
            <section className="mb-6 rounded-xl bg-blue-50 p-6 shadow-sm border border-blue-200">
              <h2 className="mb-3 text-lg font-semibold text-blue-800">交付进行中</h2>

              {/* 整体进度条 */}
              <div className="mb-4">
                <div className="flex items-center justify-between text-sm text-blue-700 mb-1">
                  <span>已完成 {completedCount}/{totalExportCount}</span>
                  <span>{progressPercent}%</span>
                </div>
                <div className="h-2.5 w-full rounded-full bg-blue-200">
                  <div
                    className="h-2.5 rounded-full bg-blue-600 transition-all duration-700"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>

              {/* 逐项状态 */}
              <ul className="space-y-2 text-sm">
                {EXPORT_BUTTONS.map((item) => {
                  const state = exportStates[item.key];
                  let indicator: { color: string; label: string };
                  if (state?.done) {
                    indicator = { color: 'text-green-700', label: '已完成' };
                  } else if (state?.loading) {
                    indicator = { color: 'text-blue-700', label: '处理中...' };
                  } else if (state?.failed) {
                    indicator = { color: 'text-red-600', label: '失败' };
                  } else {
                    indicator = { color: 'text-gray-400', label: '等待中' };
                  }
                  return (
                    <li key={item.key} className="flex items-center gap-2">
                      <span className={`inline-block w-1.5 h-1.5 rounded-full ${
                        state?.done ? 'bg-green-500' :
                        state?.loading ? 'bg-blue-500 animate-pulse' :
                        state?.failed ? 'bg-red-500' : 'bg-gray-300'
                      }`} />
                      <span className="text-gray-700">{item.label}</span>
                      <span className={`ml-auto ${indicator.color}`}>{indicator.label}</span>
                    </li>
                  );
                })}
              </ul>

              <div className="mt-3 text-sm text-blue-600">
                <p>系统正在自动处理，页面将实时更新进度。</p>
                {delivery?.latestBuild?.version && (
                  <p className="mt-1 text-xs text-blue-400">构建版本 #{delivery.latestBuild.version}</p>
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
                      构建版本 #{delivery.latestBuild.version}
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
              <h2 className="mb-3 text-lg font-semibold text-green-800">已交付</h2>
              {delivery?.productionUrl && (
                <div className="space-y-2">
                  <p className="text-sm text-green-700">软件已上线，可通过以下地址访问：</p>
                  <div className="flex items-center gap-2">
                    <a
                      href={delivery.productionUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-lg bg-green-600 px-4 py-2 text-white hover:bg-green-700 transition-colors"
                    >
                      打开软件
                    </a>
                    <button
                      onClick={() => handleCopyUrl(delivery.productionUrl, '访问地址')}
                      className="rounded-lg border border-green-400 bg-white px-3 py-2 text-sm text-green-700 hover:bg-green-100 transition-colors"
                    >
                      复制链接
                    </button>
                  </div>
                  {delivery?.productionUrl && (
                    <p className="text-xs text-green-500 break-all">{delivery.productionUrl}</p>
                  )}
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
                <div className="flex items-center gap-2">
                  <a
                    href={delivery.productionUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline"
                  >
                    {delivery.productionUrl}
                  </a>
                  <button
                    onClick={() => handleCopyUrl(delivery.productionUrl, '访问地址')}
                    className="text-xs text-gray-400 hover:text-gray-600 border px-2 py-0.5 rounded transition-colors"
                  >
                    复制
                  </button>
                </div>
                <p className="mt-2 text-sm text-gray-500">
                  管理员账号：{delivery.adminEmail || 'admin@example.com'}
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
                  ? '已交付'
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

          {/* ─── 高级交付服务 — 逐项导出卡片 ─── */}
          <section className="mb-6 rounded-xl bg-white p-6 shadow-sm">
            <h2 className="mb-3 text-lg font-semibold text-gray-800">高级交付服务</h2>
            <div className="grid grid-cols-2 gap-3">
              {EXPORT_BUTTONS.map((item) => {
                const state = exportStates[item.key];
                const isLoading = state?.loading;
                const isDone = state?.done;
                const isFailedState = state?.failed;
                const downloadUrl = state?.url;

                // 已完成 → 显示链接 + 复制按钮
                if (isDone && downloadUrl) {
                  return (
                    <div
                      key={item.key}
                      className="rounded-lg border border-green-300 bg-green-50 p-4"
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-green-700 font-medium">{item.label}</span>
                        <span className="text-xs text-green-600">已完成</span>
                      </div>
                      <div className="flex gap-2">
                        <a
                          href={downloadUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-block rounded bg-green-600 px-3 py-1.5 text-xs text-white hover:bg-green-700 transition-colors"
                        >
                          下载
                        </a>
                        <button
                          onClick={() => handleCopyUrl(downloadUrl, item.label)}
                          className="rounded border border-green-400 bg-white px-3 py-1.5 text-xs text-green-700 hover:bg-green-100 transition-colors"
                        >
                          复制链接
                        </button>
                      </div>
                    </div>
                  );
                }

                // 失败 → 显示错误 + 重试
                if (isFailedState) {
                  return (
                    <div
                      key={item.key}
                      className="rounded-lg border border-red-200 bg-red-50 p-4"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-red-700 font-medium">{item.label}</span>
                        <button
                          onClick={() => handleExport(item.key, item.endpoint)}
                          className="text-xs text-red-600 hover:underline"
                        >
                          重试
                        </button>
                      </div>
                      <p className="text-xs text-red-500">{state?.error || '处理失败'}</p>
                    </div>
                  );
                }

                // 加载中
                if (isLoading) {
                  return (
                    <div
                      key={item.key}
                      className="rounded-lg border border-blue-200 bg-blue-50 p-4"
                    >
                      <div className="flex items-center gap-2">
                        <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
                        <span className="text-blue-700 font-medium">{item.label}</span>
                      </div>
                      <p className="mt-1 text-xs text-blue-600">处理中...</p>
                    </div>
                  );
                }

                // 已完成但无下载链接（边缘情况：show "已完成" 但不提供下载）
                if (isDone && !downloadUrl) {
                  return (
                    <div
                      key={item.key}
                      className="rounded-lg border border-green-200 bg-green-50 p-4"
                    >
                      <span className="text-green-700 font-medium">{item.label}</span>
                      <p className="mt-1 text-xs text-green-600">已完成</p>
                    </div>
                  );
                }

                // 默认：可点击的按钮
                return (
                  <button
                    key={item.key}
                    onClick={() => handleExport(item.key, item.endpoint)}
                    disabled={isLoading || isDelivering || !delivery?.isPro}
                    className={`rounded-lg border p-4 text-left text-sm transition-colors ${
                      'text-gray-700 hover:bg-gray-50'
                    } disabled:opacity-60 disabled:cursor-not-allowed`}
                  >
                    <span>{item.label}</span>
                    {!delivery?.isPro && (
                      <p className="mt-1 text-xs text-gray-400">需升级套餐</p>
                    )}
                    {delivery?.isPro && (
                      <p className="mt-1 text-xs text-gray-400">点击开始导出</p>
                    )}
                  </button>
                );
              })}
            </div>
          </section>

          {/* ─── 复盘报告 ─── */}
          {caseReview && (
            <section className="mb-6 rounded-xl bg-white p-6 shadow-sm">
              <h2 className="mb-3 text-lg font-semibold text-gray-800">项目复盘</h2>
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
              <h2 className="mb-3 text-lg font-semibold text-gray-800">经验推荐</h2>
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
