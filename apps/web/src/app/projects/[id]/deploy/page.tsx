'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import NavBar from '@/lib/nav-bar';
import TemplateGenerator from './template-generator';
import SchemaEditor from './schema-editor';

interface StepLog {
  step: string;
  status: string;
  message: string;
  ts: string;
}

interface DeployData {
  exists: boolean;
  id?: string;
  status?: string;
  testUrl?: string;
  adminUser?: string;
  port?: number;
  progress?: number;
  currentStep?: string;
  stepsLog?: StepLog[];
  healthStatus?: string;
  errorMessage?: string;
  startedAt?: string;
  readyAt?: string;
  message?: string;
}

const STATUS_LABELS: Record<string, string> = {
  preparing: '准备中',
  building: '构建中',
  deploying: '部署中',
  ready: '已就绪',
  failed: '部署失败',
  destroyed: '已销毁',
};

const STATUS_COLORS: Record<string, string> = {
  preparing: 'text-blue-600 bg-blue-50',
  building: 'text-purple-600 bg-purple-50',
  deploying: 'text-amber-600 bg-amber-50',
  ready: 'text-green-600 bg-green-50',
  failed: 'text-red-600 bg-red-50',
  destroyed: 'text-gray-400 bg-gray-100',
};

export default function TestDeployPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;
  const { token, isLoading: authLoading } = useAuth();
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  const [data, setData] = useState<DeployData | null>(null);
  const [loading, setLoading] = useState(true);
  const [deploying, setDeploying] = useState(false);
  const [message, setMessage] = useState('');
  const [showPass, setShowPass] = useState(false);

  // 若依真后端：enabled=平台是否接了若依实例；be=项目当前后端 {kind,status,resources}
  const [ruoyi, setRuoyi] = useState<{ enabled: boolean; be: any } | null>(null);
  const [provisioning, setProvisioning] = useState(false);
  const ruoyiPollRef = useRef<NodeJS.Timeout | null>(null);

  const fetchRuoyi = useCallback(async () => {
    if (!token || authLoading) return;
    try {
      const r = await api.get(`/api/projects/${projectId}/ruoyi`);
      setRuoyi({ enabled: r.enabled, be: r.backendRuntime });
    } catch { /* 未接若依实例时端点可能 400/404，静默 */ }
  }, [token, authLoading, projectId]);

  useEffect(() => { fetchRuoyi(); }, [fetchRuoyi]);

  // 置备中轮询若依状态
  useEffect(() => {
    if (ruoyi?.be?.status === 'provisioning') {
      ruoyiPollRef.current = setInterval(fetchRuoyi, 5000);
      return () => { if (ruoyiPollRef.current) clearInterval(ruoyiPollRef.current); };
    }
    if (ruoyiPollRef.current) { clearInterval(ruoyiPollRef.current); ruoyiPollRef.current = null; }
  }, [ruoyi?.be?.status, fetchRuoyi]);

  const handleProvisionRuoyi = async () => {
    if (!confirm('用若依做真后端：平台将据本项目数据模型自动建表、生成 RBAC/数据权限的真后端（约需几分钟编译重启）。继续？')) return;
    setProvisioning(true);
    setMessage('');
    try {
      const r = await api.post(`/api/projects/${projectId}/ruoyi/provision`);
      setRuoyi((p) => ({ enabled: true, be: { kind: 'ruoyi', status: 'provisioning', resources: r.entities } }));
      setMessage(`已开始用若依做真后端（${(r.entities || []).join('、')}），后台置备中…`);
    } catch (e: any) {
      setMessage('启动失败: ' + (e?.message || ''));
    } finally {
      setProvisioning(false);
    }
  };

  const fetchStatus = useCallback(async () => {
    if (!token || authLoading) return;
    try {
      const result = await api.get(`/api/projects/${projectId}/test-deploy`);
      setData(result);
    } catch (e: any) {
      setMessage('加载失败: ' + (e?.message || ''));
    } finally {
      setLoading(false);
    }
  }, [token, authLoading, projectId]);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  // 轮询部署进度
  useEffect(() => {
    if (data?.status && ['preparing', 'building', 'deploying'].includes(data.status)) {
      pollingRef.current = setInterval(fetchStatus, 3000);
      return () => {
        if (pollingRef.current) clearInterval(pollingRef.current);
      };
    } else {
      if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
    }
  }, [data?.status, fetchStatus]);

  const handleDeploy = async () => {
    setDeploying(true);
    setMessage('');
    try {
      const result = await api.post(`/api/projects/${projectId}/test-deploy`);
      if (result.alreadyDeployed) {
        setData(result);
        setMessage('已有活跃的测试环境');
      } else {
        setData({ exists: true, status: 'preparing', progress: 0, ...result });
        setMessage('部署已启动');
      }
    } catch (e: any) {
      setMessage('部署失败: ' + (e?.message || ''));
    } finally {
      setDeploying(false);
    }
  };

  const handleDestroy = async () => {
    if (!confirm('确定要销毁测试环境吗？')) return;
    try {
      await api.delete(`/api/projects/${projectId}/test-deploy`);
      setData({ exists: false, message: '已销毁' });
      setMessage('测试环境已销毁');
    } catch (e: any) {
      setMessage('销毁失败: ' + (e?.message || ''));
    }
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <NavBar />
        <div className="flex items-center justify-center h-64 text-gray-500">加载中...</div>
      </div>
    );
  }

  const hasDeploy = data?.exists && data?.status && data.status !== 'destroyed';
  const isActive = ['preparing', 'building', 'deploying'].includes(data?.status || '');
  const isReady = data?.status === 'ready';
  const isFailed = data?.status === 'failed';

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar />
      <div className="max-w-3xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">测试环境部署</h1>
            <p className="text-sm text-gray-500 mt-1">
              将产品部署到可访问的测试环境，在线验收功能
            </p>
          </div>
          <div className="flex gap-2">
            {!hasDeploy && (
              <button
                onClick={handleDeploy}
                disabled={deploying}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
              >
                {deploying ? '启动中...' : '部署测试环境'}
              </button>
            )}
            {isReady && (
              <>
                <button onClick={handleDestroy} className="px-4 py-2 border border-red-300 text-red-600 rounded-lg hover:bg-red-50 text-sm">
                  销毁环境
                </button>
                <button
                  onClick={handleDeploy}
                  disabled={deploying}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm"
                >
                  重新部署
                </button>
              </>
            )}
            {isFailed && (
              <button onClick={handleDeploy} disabled={deploying} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm">
                重试部署
              </button>
            )}
          </div>
        </div>

        <TemplateGenerator projectId={projectId} />

        <SchemaEditor projectId={projectId} />

        {message && (
          <div className={`mb-4 p-3 rounded-lg text-sm ${message.includes('失败') ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-blue-50 text-blue-700 border border-blue-200'}`}>
            {message}
          </div>
        )}

        {/* 真后端：若依 */}
        {ruoyi?.enabled && (
          <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-gray-900">真后端（若依）</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  把演示升级为带 RBAC、数据权限、级联的真后端；升级后预览/部署自动显示真数据。
                </p>
              </div>
              <div className="shrink-0">
                {ruoyi.be?.kind === 'ruoyi' && ruoyi.be?.status === 'ready' ? (
                  <span className="text-xs px-2.5 py-1 rounded-full font-medium text-green-700 bg-green-50">✅ 若依真后端已就绪</span>
                ) : ruoyi.be?.status === 'provisioning' ? (
                  <span className="text-xs px-2.5 py-1 rounded-full font-medium text-amber-700 bg-amber-50 animate-pulse">🔄 正在构建真后端…</span>
                ) : (
                  <button
                    onClick={handleProvisionRuoyi}
                    disabled={provisioning}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 text-sm font-medium"
                  >
                    {provisioning ? '启动中...' : '用若依做真后端'}
                  </button>
                )}
              </div>
            </div>
            {ruoyi.be?.status === 'provisioning' && (
              <p className="mt-3 text-xs text-amber-600">后台建表→生成代码→编译→重启中，约需几分钟，可离开本页，完成后预览自动切真数据。</p>
            )}
            {ruoyi.be?.kind === 'ruoyi' && ruoyi.be?.status === 'ready' && Array.isArray(ruoyi.be?.resources) && (
              <p className="mt-3 text-xs text-gray-500">真后端资源：{ruoyi.be.resources.join('、')}　·　<button onClick={() => router.push(`/projects/${projectId}/demo`)} className="text-indigo-600 hover:underline">去预览看真数据</button></p>
            )}
            {ruoyi.be?.status === 'error' && (
              <div className="mt-3">
                <p className="text-xs text-red-600 font-mono">{ruoyi.be?.error || '构建失败'}</p>
                <button onClick={handleProvisionRuoyi} disabled={provisioning} className="mt-2 px-3 py-1.5 border border-indigo-300 text-indigo-600 rounded-lg hover:bg-indigo-50 text-xs">重试</button>
              </div>
            )}
          </div>
        )}

        {/* Status Card */}
        {hasDeploy && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-6">
            {/* Status Bar */}
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <span className={`text-sm px-2.5 py-1 rounded-full font-medium ${STATUS_COLORS[data.status!] || ''}`}>
                  {STATUS_LABELS[data.status!] || data.status}
                </span>
                {data.healthStatus && (
                  <span className={`text-xs ${data.healthStatus === 'healthy' ? 'text-green-600' : 'text-red-500'}`}>
                    {data.healthStatus === 'healthy' ? '🟢 健康' : '🔴 异常'}
                  </span>
                )}
              </div>

              {/* Progress Bar */}
              {isActive && (
                <div className="mb-4">
                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span>{data.currentStep || '处理中...'}</span>
                    <span>{data.progress || 0}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-blue-600 h-2 rounded-full transition-all duration-500"
                      style={{ width: `${data.progress || 0}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Ready Info */}
              {isReady && data.testUrl && (
                <div className="space-y-3">
                  <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                    <p className="text-sm font-medium text-green-800 mb-2">✅ 测试环境已就绪</p>
                    <div className="space-y-1.5 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-500 w-20">访问地址</span>
                        <a
                          href={data.testUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline font-mono text-xs"
                        >
                          {data.testUrl}
                        </a>
                      </div>
                      {data.adminUser && (
                        <div className="flex items-center gap-2">
                          <span className="text-gray-500 w-20">管理员账号</span>
                          <span className="font-mono text-xs">{data.adminUser}</span>
                        </div>
                      )}
                      {data.port && (
                        <div className="flex items-center gap-2">
                          <span className="text-gray-500 w-20">端口</span>
                          <span className="font-mono text-xs">{data.port}</span>
                        </div>
                      )}
                    </div>
                    <div className="mt-3 flex gap-2">
                      <a
                        href={data.testUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-medium"
                      >
                        打开测试环境
                      </a>
                      <button
                        onClick={() => router.push(`/projects/${projectId}/demo`)}
                        className="px-3 py-1.5 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 text-sm"
                      >
                        提交反馈
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Error Info */}
              {isFailed && data.errorMessage && (
                <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm font-medium text-red-800">部署失败</p>
                  <p className="text-xs text-red-600 mt-1 font-mono">{data.errorMessage}</p>
                </div>
              )}
            </div>

            {/* Steps Log */}
            {data.stepsLog && data.stepsLog.length > 0 && (
              <div className="border-t border-gray-100 bg-gray-50 p-4">
                <p className="text-xs font-medium text-gray-500 mb-2">部署日志</p>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {data.stepsLog.map((step, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <span className={
                        step.status === 'done' ? 'text-green-500' :
                        step.status === 'failed' ? 'text-red-500' :
                        step.status === 'running' ? 'text-blue-500 animate-pulse' :
                        'text-gray-400'
                      }>
                        {step.status === 'done' ? '✅' :
                         step.status === 'failed' ? '❌' :
                         step.status === 'running' ? '🔄' :
                         step.status === 'skipped' ? '⏭️' : '⏳'}
                      </span>
                      <span className="text-gray-600">{step.message}</span>
                      <span className="text-gray-400 ml-auto">{new Date(step.ts).toLocaleTimeString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Empty State */}
        {!hasDeploy && (
          <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
            <div className="text-5xl mb-4">🚀</div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">还没有测试环境</h3>
            <p className="text-sm text-gray-500 mb-6">
              点击上方按钮，平台将自动构建 Docker 镜像并部署到测试环境
            </p>
            <button
              onClick={handleDeploy}
              disabled={deploying}
              className="px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
            >
              部署测试环境
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
