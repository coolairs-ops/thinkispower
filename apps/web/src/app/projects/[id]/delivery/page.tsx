'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import { useToast } from '@/lib/toast';
import NavBar from '@/lib/nav-bar';
import DeliveryStatusCard from '@/components/delivery-status-card';
import DeliveryProgressBar from '@/components/delivery-progress-bar';
import ServiceCard from '@/components/service-card';
import GuardianCard from '@/components/guardian-card';

const PREMIUM_SERVICES = [
  { key: 'code-review',     icon: '🔍', label: '代码审查报告',       desc: 'AI 深度审查 + 安全扫描 + 性能分析', price: '¥299/次' },
  { key: 'deploy-online',   icon: '☁️',  label: '一键云部署',         desc: '自动部署到阿里云/腾讯云，含域名+HTTPS', price: '¥599/次' },
  { key: 'custom-domain',   icon: '🔗',  label: '自定义域名绑定',     desc: '绑定你自己的域名，自动配置 SSL 证书', price: '¥199/年' },
  { key: 'data-migration',  icon: '🗄️',  label: '数据迁移服务',       desc: '帮你把现有数据迁移到新系统', price: '¥399/次' },
  { key: 'tech-support',    icon: '🎧',  label: '技术顾问支持',       desc: '专属技术顾问 7×12 小时在线答疑', price: '¥999/月' },
  { key: 'custom-dev',      icon: '🛠️',  label: '定制开发',           desc: 'AI 覆盖不了的特殊需求，工程师接手开发', price: '¥1,500/人天' },
];

const DELIVERY_STEPS = [
  { id: 'schema',  label: '数据库 Schema',  icon: '🗄️' },
  { id: 'backend', label: '后端 API',        icon: '⚙️' },
  { id: 'frontend',label: '前端页面',        icon: '🎨' },
  { id: 'deploy',  label: '部署上线',        icon: '🚀' },
];

// 上线门失败态（ADR-0009 D5）：均非"已上线"，前端据实显示卡在哪门
const GATE_FAIL_STATUSES = ['build_failed', 'contract_violation', 'smoke_failed', 'deploy_failed'];
// 任一终态都应停止本次交付的进度动画（含成功/降级/失败）
const TERMINAL_STATUSES = ['completed', 'preview_only', ...GATE_FAIL_STATUSES];

const CHECK_STATUS_LABEL: Record<string, string> = {
  pass: '通过',
  warn: '关注',
  fail: '阻断',
  unknown: '未知',
};

const CHECK_STATUS_CLASS: Record<string, string> = {
  pass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  warn: 'bg-amber-50 text-amber-700 border-amber-200',
  fail: 'bg-red-50 text-red-700 border-red-200',
  unknown: 'bg-gray-50 text-gray-600 border-gray-200',
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
  const [packageChecking, setPackageChecking] = useState(false);
  const [packageReport, setPackageReport] = useState<any>(null);
  const [genFiles, setGenFiles] = useState<string[]>([]);
  const [activeDeliveryId, setActiveDeliveryId] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [currentStep, setCurrentStep] = useState(0);
  const genTimer = useRef<ReturnType<typeof setInterval>>();
  const deliveringRef = useRef(false);

  // Load delivery data
  useEffect(() => {
    if (isLoading) return;
    if (!token) { router.push('/'); return; }

    const load = () => Promise.all([
      api.get(`/api/projects/${projectId}/delivery`),
      api.get(`/api/projects/${projectId}`),
    ]).then(([d, proj]) => {
      setDelivery(d);
      setProjectName(proj.name || '');
      if (d.generatedFiles) setGenFiles(d.generatedFiles);
      setLoading(false);
    }).catch(() => setLoading(false));

    load();

    const timer = setInterval(() => {
      api.get(`/api/projects/${projectId}/delivery`).then((d) => {
        setDelivery(d);
        if (d.generatedFiles) setGenFiles(d.generatedFiles);
        // 本次交付跑到任一上线门终态(成功/降级/失败)即停进度动画——诚实置态由状态卡呈现(ADR-0009 D5)
        if (deliveringRef.current && TERMINAL_STATUSES.includes(d.goLiveStatus)) {
          deliveringRef.current = false;
          setActiveDeliveryId(null);
          if (genTimer.current) clearInterval(genTimer.current);
        }
      }).catch(() => {});
    }, 3000);
    return () => clearInterval(timer);
  }, [projectId, token, isLoading, router]);

  // Cleanup timer
  useEffect(() => () => { if (genTimer.current) clearInterval(genTimer.current); }, []);

  const handleStartDelivery = async () => {
    if (starting) return;
    setStarting(true);
    try {
      const proj = await api.get(`/api/projects/${projectId}`);
      const r = await api.post(`/api/projects/${projectId}/delivery/deliver`, {
        projectName, planSummary: proj.planSummary, demoHtml: proj.demoHtml,
      });
      if (r.deliveryId) {
        deliveringRef.current = true;
        setActiveDeliveryId(r.deliveryId);
        setElapsed(0);
        setCurrentStep(0);
        // Start progress animation
        if (genTimer.current) clearInterval(genTimer.current);
        genTimer.current = setInterval(() => {
          setElapsed(e => e + 1);
          // Simulate step progress based on elapsed time
          const e = elapsed;
          if (e > 120) setCurrentStep(4);
          else if (e > 80) setCurrentStep(3);
          else if (e > 30) setCurrentStep(2);
          else if (e > 8) setCurrentStep(1);
        }, 1000);
        toast('交付已启动，AI 正在生成代码...', 'success');
      }
    } catch (e: any) {
      toast(e.message || '启动失败', 'error');
    }
    setStarting(false);
  };

  const handlePackageCheck = async () => {
    if (packageChecking) return;
    setPackageChecking(true);
    try {
      const report = await api.post(`/api/projects/${projectId}/delivery/package-check`, { mode: 'package' });
      setPackageReport(report);
      const status = report?.overall?.status;
      toast(`交付包验收：${CHECK_STATUS_LABEL[status] || status || '未知'} · ${report?.overall?.summary || ''}`, status === 'fail' ? 'error' : 'success');
    } catch (e: any) {
      toast(e.message || '交付包验收失败', 'error');
    } finally {
      setPackageChecking(false);
    }
  };

  if (isLoading) return null;
  if (loading) return <div className="p-8 text-gray-500">加载中...</div>;

  const status = delivery?.goLiveStatus;  // 上线门结局(ADR-0009)，与生命周期 status 分离；null=未交付
  const isGenerating = !!activeDeliveryId || starting;
  const isCompleted = status === 'completed' && !isGenerating;       // 真上线（过全部门）
  const isPreviewOnly = status === 'preview_only' && !isGenerating;  // 仅预览·未上线（降级）
  const isFailed = GATE_FAIL_STATUSES.includes(status) && !isGenerating;
  const needsRedeliver = isCompleted || isPreviewOnly || isFailed;
  const hasBuild = !!delivery?.latestBuild;
  const hasFiles = genFiles.length > 0;
  const sourceZipUrl = delivery?.latestBuild?.sourceZipUrl;
  const productionUrl = delivery?.productionUrl;
  const consoleLogin = delivery?.consoleLogin; // 若依底座项目：交付应用的业务登录账号

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar projectId={projectId} projectName={projectName} />

      <div className="px-6 py-8">
        <div className="mx-auto max-w-4xl">
          <h1 className="mb-6 text-2xl font-bold text-gray-900">交付</h1>

          {/* ═══ 状态卡片 ═══ */}
          <DeliveryStatusCard
            isGenerating={isGenerating}
            status={status}
            hasFiles={hasFiles}
            elapsed={elapsed}
            currentStep={currentStep}
            steps={DELIVERY_STEPS}
            publicStatusLabel={delivery?.publicStatusLabel}
          />

          {/* ═══ 操作按钮 ═══ */}
          <section className="mb-6 flex flex-wrap gap-3">
            <button onClick={handleStartDelivery} disabled={starting || isGenerating}
              className={`rounded-lg px-5 py-2.5 text-sm font-medium transition-colors ${
                isGenerating ? 'bg-indigo-400 text-white cursor-wait animate-pulse' :
                isCompleted ? 'bg-blue-600 text-white hover:bg-blue-700' :
                isFailed ? 'bg-red-600 text-white hover:bg-red-700' :
                isPreviewOnly ? 'bg-amber-600 text-white hover:bg-amber-700' :
                'bg-indigo-600 text-white hover:bg-indigo-700'
              } disabled:opacity-50`}>
              {isGenerating ? '生成中...' : starting ? '启动中...' : needsRedeliver ? '重新交付' : '开始交付'}
            </button>
            <button onClick={() => router.push(`/projects/${projectId}/demo`)}
              className="rounded-lg border px-5 py-2.5 text-sm text-gray-700 hover:bg-gray-50">查看 Demo</button>
            <button onClick={() => router.push(`/projects/${projectId}/evaluation`)}
              className="rounded-lg border px-5 py-2.5 text-sm text-gray-700 hover:bg-gray-50">自迭代评估</button>
            <button onClick={handlePackageCheck} disabled={packageChecking || isGenerating}
              className="rounded-lg border border-emerald-200 bg-emerald-50 px-5 py-2.5 text-sm font-medium text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50">
              {packageChecking ? '体检中...' : '交付包验收'}
            </button>
          </section>

          {/* ═══ 实时进度 ═══ */}
          {isGenerating && <DeliveryProgressBar currentStep={currentStep} steps={DELIVERY_STEPS} />}

          {packageReport && (
            <section className="mb-6 rounded-xl bg-white p-5 shadow-sm">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-gray-800">交付包验收</h3>
                  <p className="mt-1 text-xs text-gray-500">{packageReport.generatedAt}</p>
                </div>
                <span className={`rounded-full border px-3 py-1 text-xs font-medium ${CHECK_STATUS_CLASS[packageReport.overall?.status] || CHECK_STATUS_CLASS.unknown}`}>
                  {CHECK_STATUS_LABEL[packageReport.overall?.status] || '未知'} · {packageReport.overall?.summary}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {(Object.values(packageReport.gates || {}) as any[]).map((gate) => (
                  <div key={gate.key} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-gray-700">{gate.name}</p>
                      <p className="truncate text-xs text-gray-400">{gate.summary}</p>
                    </div>
                    <span className={`ml-3 shrink-0 rounded-full border px-2 py-0.5 text-[11px] ${CHECK_STATUS_CLASS[gate.status] || CHECK_STATUS_CLASS.unknown}`}>
                      {CHECK_STATUS_LABEL[gate.status] || '未知'}
                    </span>
                  </div>
                ))}
              </div>
              {(packageReport.overall?.blockers?.length > 0 || packageReport.overall?.warnings?.length > 0) && (
                <div className="mt-4 space-y-2 text-xs">
                  {packageReport.overall.blockers?.slice(0, 4).map((item: string, i: number) => (
                    <p key={`b-${i}`} className="rounded border border-red-100 bg-red-50 px-3 py-2 text-red-700">{item}</p>
                  ))}
                  {packageReport.overall.warnings?.slice(0, 4).map((item: string, i: number) => (
                    <p key={`w-${i}`} className="rounded border border-amber-100 bg-amber-50 px-3 py-2 text-amber-700">{item}</p>
                  ))}
                </div>
              )}
              {packageReport.artifacts?.reportMarkdownPath && (
                <p className="mt-4 break-all text-xs text-gray-400">报告已写入：{packageReport.artifacts.reportMarkdownPath}</p>
              )}
            </section>
          )}

          {/* ═══ 交付产物 ═══ */}
          <section className="mb-6 grid grid-cols-1 md:grid-cols-3 gap-4">
            <ServiceCard icon="🌐" title="在线预览" available={!!productionUrl}
              availableContent={<>
                <p className="text-xs text-gray-500 break-all mb-2">{productionUrl}</p>
                <div className="flex gap-2">
                  <a href={productionUrl} target="_blank" rel="noopener noreferrer"
                    className="rounded bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700">打开预览</a>
                  <button onClick={() => navigator.clipboard.writeText(productionUrl!)}
                    className="rounded border px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50">复制</button>
                </div>
                {consoleLogin && (
                  <div className="mt-3 rounded border border-amber-200 bg-amber-50 p-2">
                    {consoleLogin.hasScopedAccount ? (
                      <p className="text-xs text-amber-800">
                        应用账号：<span className="font-mono font-medium">{consoleLogin.username}</span>
                        {consoleLogin.password && <> / <span className="font-mono font-medium">{consoleLogin.password}</span></>}
                      </p>
                    ) : (
                      <p className="text-xs text-amber-800">本项目暂无应用账号，建议重新交付以自动生成业务账号。</p>
                    )}
                    <p className="text-[11px] text-amber-600 mt-1">{consoleLogin.note}</p>
                  </div>
                )}
              </>}
              unavailableContent={<>
                <p className="text-xs text-gray-400">代码生成后将自动部署</p>
                <p className="text-xs text-gray-300 mt-1">点击「开始交付」生成</p>
              </>}
            />
            <ServiceCard icon="🚀" title="在线部署" available={isCompleted}
              availableContent={<>
                <p className="text-xs text-green-600 mb-2">已部署到生产环境</p>
                <a href={productionUrl} target="_blank" rel="noopener noreferrer"
                  className="rounded bg-green-600 px-3 py-1.5 text-xs text-white hover:bg-green-700">打开应用</a>
              </>}
              unavailableContent={<>
                <p className="text-xs text-gray-400">{isPreviewOnly ? '仅静态预览·未真正上线' : '需 Docker / 后端就绪'}</p>
                <p className="text-xs text-gray-300 mt-1">或使用「一键云部署」服务</p>
              </>}
            />
            <ServiceCard icon="📦" title="交付包下载" available={!!sourceZipUrl}
              availableContent={<>
                <p className="text-xs text-gray-500 mb-2">源码与七道门验收报告</p>
                <a href={`${sourceZipUrl}${sourceZipUrl?.includes('?') ? '&' : '?'}token=${encodeURIComponent(token || '')}`} target="_blank" rel="noopener noreferrer"
                  className="rounded bg-green-600 px-3 py-1.5 text-xs text-white hover:bg-green-700">下载交付包</a>
              </>}
              unavailableContent={<>
                <p className="text-xs text-gray-400">代码生成后将自动打包</p>
                <p className="text-xs text-gray-300 mt-1">包含完整项目结构</p>
              </>}
            />
          </section>

          {/* ═══ 持续守护 ═══ */}
          <GuardianCard projectId={projectId} />

          {/* ═══ 生成文件列表 ═══ */}
          <section className="mb-6 rounded-xl bg-white p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">生成文件 {hasFiles ? `(${genFiles.length})` : ''}</h3>
            {hasFiles ? (
              <div className="bg-gray-900 rounded-lg p-3 font-mono text-xs max-h-56 overflow-y-auto" style={{ color: '#3fb950' }}>
                {genFiles.map((f, i) => (
                  <div key={i} className="py-0.5 hover:bg-gray-800 rounded px-1">📄 {f}</div>
                ))}
              </div>
            ) : isGenerating ? (
              <div className="text-center py-6">
                <div className="inline-flex gap-1 mb-2">
                  {[0,1,2].map(i => <span key={i} className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: `${i*0.15}s` }} />)}
                </div>
                <p className="text-sm text-gray-500">AI 正在生成代码文件...</p>
              </div>
            ) : (
              <div className="text-center py-6 text-gray-400 text-sm">
                <p>暂无生成文件</p>
                <p className="text-xs mt-1">点击「开始交付」后，AI 将生成全栈项目代码</p>
              </div>
            )}
          </section>

          {/* ═══ 高级服务 ═══ */}
          <section className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <h3 className="text-sm font-semibold text-gray-700">高级服务</h3>
              <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">付费</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {PREMIUM_SERVICES.map(svc => (
                <div key={svc.key}
                  className="rounded-xl bg-white p-4 shadow-sm border border-gray-100 hover:border-amber-300 hover:shadow-md transition-all cursor-pointer group"
                  onClick={() => toast(`${svc.label} — ${svc.price}，即将上线，敬请期待`, 'info')}>
                  <div className="flex items-start gap-3">
                    <span className="text-2xl">{svc.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 group-hover:text-amber-700">{svc.label}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{svc.desc}</p>
                    </div>
                    <span className="text-xs font-medium text-amber-600 whitespace-nowrap">{svc.price}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

