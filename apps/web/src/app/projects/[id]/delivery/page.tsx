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
  const [genFiles, setGenFiles] = useState<string[]>([]);
  const [activeDeliveryId, setActiveDeliveryId] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [currentStep, setCurrentStep] = useState(0);
  const genTimer = useRef<ReturnType<typeof setInterval>>();

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
        // Check if delivery completed
        if (d.status === 'completed' && (d.latestBuild || d.generatedFiles?.length)) {
          setActiveDeliveryId(null);
          if (genTimer.current) clearInterval(genTimer.current);
        }
        if (d.status === 'build_failed') {
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

  if (isLoading) return null;
  if (loading) return <div className="p-8 text-gray-500">加载中...</div>;

  const status = delivery?.status;
  const isCompleted = status === 'completed' && !activeDeliveryId;
  const isFailed = status === 'build_failed';
  const isGenerating = !!activeDeliveryId || starting;
  const hasBuild = !!delivery?.latestBuild;
  const hasFiles = genFiles.length > 0;
  const sourceZipUrl = delivery?.latestBuild?.sourceZipUrl;
  const productionUrl = delivery?.productionUrl;

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar projectId={projectId} projectName={projectName} />

      <div className="px-6 py-8">
        <div className="mx-auto max-w-4xl">
          <h1 className="mb-6 text-2xl font-bold text-gray-900">交付</h1>

          {/* ═══ 状态卡片 ═══ */}
          <DeliveryStatusCard
            isGenerating={isGenerating}
            isFailed={isFailed}
            isCompleted={isCompleted}
            hasFiles={hasFiles}
            elapsed={elapsed}
            currentStep={currentStep}
            steps={DELIVERY_STEPS}
          />

          {/* ═══ 操作按钮 ═══ */}
          <section className="mb-6 flex flex-wrap gap-3">
            <button onClick={handleStartDelivery} disabled={starting || isGenerating}
              className={`rounded-lg px-5 py-2.5 text-sm font-medium transition-colors ${
                isGenerating ? 'bg-indigo-400 text-white cursor-wait animate-pulse' :
                isCompleted ? 'bg-blue-600 text-white hover:bg-blue-700' :
                isFailed ? 'bg-red-600 text-white hover:bg-red-700' :
                'bg-indigo-600 text-white hover:bg-indigo-700'
              } disabled:opacity-50`}>
              {isGenerating ? '生成中...' : starting ? '启动中...' : isCompleted ? '重新交付' : isFailed ? '重新交付' : '开始交付'}
            </button>
            <button onClick={() => router.push(`/projects/${projectId}/demo`)}
              className="rounded-lg border px-5 py-2.5 text-sm text-gray-700 hover:bg-gray-50">查看 Demo</button>
            <button onClick={() => router.push(`/projects/${projectId}/evaluation`)}
              className="rounded-lg border px-5 py-2.5 text-sm text-gray-700 hover:bg-gray-50">自迭代评估</button>
          </section>

          {/* ═══ 实时进度 ═══ */}
          {isGenerating && <DeliveryProgressBar currentStep={currentStep} steps={DELIVERY_STEPS} />}

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
              </>}
              unavailableContent={<>
                <p className="text-xs text-gray-400">代码生成后将自动部署</p>
                <p className="text-xs text-gray-300 mt-1">点击「开始交付」生成</p>
              </>}
            />
            <ServiceCard icon="🚀" title="在线部署" available={!!productionUrl}
              availableContent={<>
                <p className="text-xs text-green-600 mb-2">已部署到生产环境</p>
                <a href={productionUrl} target="_blank" rel="noopener noreferrer"
                  className="rounded bg-green-600 px-3 py-1.5 text-xs text-white hover:bg-green-700">打开应用</a>
              </>}
              unavailableContent={<>
                <p className="text-xs text-gray-400">需 Docker 环境支持</p>
                <p className="text-xs text-gray-300 mt-1">或使用「一键云部署」服务</p>
              </>}
            />
            <ServiceCard icon="📦" title="源码下载" available={!!sourceZipUrl}
              availableContent={<>
                <p className="text-xs text-gray-500 mb-2">全栈项目源码包</p>
                <a href={`${sourceZipUrl}${sourceZipUrl?.includes('?') ? '&' : '?'}token=${encodeURIComponent(token || '')}`} target="_blank" rel="noopener noreferrer"
                  className="rounded bg-green-600 px-3 py-1.5 text-xs text-white hover:bg-green-700">下载源码</a>
              </>}
              unavailableContent={<>
                <p className="text-xs text-gray-400">代码生成后将自动打包</p>
                <p className="text-xs text-gray-300 mt-1">包含完整项目结构</p>
              </>}
            />
          </section>

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

