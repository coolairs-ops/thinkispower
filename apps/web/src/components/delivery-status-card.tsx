'use client';

/**
 * 交付状态卡片 — 据实呈现上线门结局（ADR-0009 D5：状态诚实，绝不把跑不起来的标成已上线）。
 *
 * 生成中 → 进度动画；否则按服务端 gate status 分态：
 *   completed=已上线 / preview_only=仅预览·未上线 / 四类门失败=卡在哪门 + 怎么补。
 */

// 失败/降级态：卡在哪门 + 怎么补（D5/D6 + ADR-0008 D6 处置）
const GATE_INFO: Record<string, { title: string; gate: string; tone: 'fail' | 'preview'; how: string }> = {
  build_failed:       { title: '编译失败',       gate: 'D2 编译门',       tone: 'fail',    how: '交付代码 3 轮自动修复后仍未通过编译。可查看生成文件/源码定位 TS 错误，或重新交付让 AI 再修；持续失败请提交工单。' },
  contract_violation: { title: '前端契约越界',   gate: 'D3 契约门',       tone: 'fail',    how: '前端调用了后端不存在的资源（上线必 404）。回 Demo/规格收敛数据调用，或补齐后端契约后重新交付。' },
  smoke_failed:       { title: '冒烟未通过',     gate: 'D4 冒烟门',       tone: 'fail',    how: '已部署但真实端点冒烟未通过。检查后端运行日志/接口实现，修复后重新交付。' },
  deploy_failed:      { title: '部署失败',       gate: 'D4 部署健康门',   tone: 'fail',    how: '容器未成功起来或健康检查未通过。确认 Docker/运行环境，或用「一键云部署」服务，修复后重新交付。' },
  preview_only:       { title: '仅预览·未上线', gate: '未过运行时门（降级）', tone: 'preview', how: 'Docker 不可用，只有静态前端、没有在跑的后端，未真正上线。请在支持 Docker 的环境重试，或购买「一键云部署」获得真实上线。' },
};

export default function DeliveryStatusCard({
  isGenerating,
  status,
  hasFiles,
  elapsed,
  currentStep,
  steps,
  publicStatusLabel,
}: {
  isGenerating: boolean;
  status?: string;
  hasFiles: boolean;
  elapsed: number;
  currentStep: number;
  steps: Array<{ id: string; label: string; icon: string }>;
  publicStatusLabel?: string;
}) {
  if (isGenerating) {
    return (
      <section className="mb-6 rounded-xl bg-gradient-to-r from-indigo-500 to-blue-600 p-5 text-white shadow-lg">
        <div className="flex items-center gap-3 mb-4">
          <span className="inline-flex h-3 w-3 rounded-full bg-white animate-ping" />
          <span className="inline-block h-3 w-3 rounded-full bg-white" />
          <h2 className="text-lg font-semibold">代码生成中...</h2>
          <span className="ml-auto text-sm opacity-80">{Math.floor(elapsed / 60)}分{elapsed % 60}秒</span>
        </div>
        <div className="flex gap-2 mb-3">
          {steps.map((step, i) => (
            <div key={step.id} className={`flex-1 text-center transition-all duration-500 ${
              i < currentStep ? 'opacity-100' : i === currentStep ? 'opacity-100 scale-105' : 'opacity-50'
            }`}>
              <div className={`text-xl mb-1 ${i <= currentStep ? '' : 'grayscale'}`}>{step.icon}</div>
              <div className="text-[10px] font-medium">{step.label}</div>
              <div className="mt-1 h-1 rounded-full overflow-hidden bg-white/20">
                <div className={`h-full rounded-full bg-white transition-all duration-1000 ${
                  i < currentStep ? 'w-full' : i === currentStep ? 'animate-pulse w-3/4' : 'w-0'
                }`} />
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs opacity-70">
          {currentStep === 0 ? '启动 AI 引擎...' :
           currentStep === 1 ? '正在设计数据库结构...' :
           currentStep === 2 ? '正在生成后端 API 代码...' :
           currentStep === 3 ? '正在生成前端页面...' :
           '正在部署上线...'}
        </p>
      </section>
    );
  }

  if (status === 'completed') {
    const isFastRuoyiPublish = publicStatusLabel?.includes('复用若依后端') || publicStatusLabel?.includes('快速发布');
    return (
      <section className="mb-6 rounded-xl bg-green-50 p-5 border border-green-200">
        <h2 className="text-base font-semibold text-green-800">{publicStatusLabel || '已上线'}</h2>
        <p className="text-sm text-green-600 mt-1">
          {isFastRuoyiPublish
            ? '已通过上线门。此次交付复用已置备的若依后端，只发布当前项目应用壳和上线记录，所以耗时会明显短于全量代码生成和重编译。'
            : <>通过全部上线门（编译 + 部署健康/后端就绪 + 契约一致 + 冒烟）。{hasFiles ? '可下载源码或在线访问。' : '产物如下。'}</>}
        </p>
      </section>
    );
  }

  // 失败 / 降级态：据实显示卡在哪门 + 怎么补
  const info = status ? GATE_INFO[status] : undefined;
  if (info) {
    const isPreview = info.tone === 'preview';
    const wrap = isPreview ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200';
    const titleColor = isPreview ? 'text-amber-800' : 'text-red-800';
    const bodyColor = isPreview ? 'text-amber-700' : 'text-red-700';
    const chip = isPreview ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700';
    return (
      <section className={`mb-6 rounded-xl p-5 border ${wrap}`}>
        <div className="flex items-center gap-2">
          <h2 className={`text-base font-semibold ${titleColor}`}>{info.title}</h2>
          <span className={`text-xs px-2 py-0.5 rounded-full ${chip}`}>卡在 {info.gate}</span>
        </div>
        <p className={`text-sm mt-2 ${bodyColor}`}>
          <span className="font-medium">怎么补：</span>{info.how}
        </p>
        {!isPreview && (
          <p className="text-xs text-gray-400 mt-1">上线门为确定性二值闸：跑不起来不会标"已上线"。</p>
        )}
      </section>
    );
  }

  return (
    <section className="mb-6 rounded-xl bg-blue-50 p-5 border border-blue-200">
      <h2 className="text-base font-semibold text-blue-800">准备交付</h2>
      <p className="text-sm text-blue-600 mt-1">点击下方按钮，AI 将自动生成全栈项目代码</p>
    </section>
  );
}
