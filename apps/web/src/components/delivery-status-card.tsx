'use client';

/**
 * 交付状态卡片 — 三态（准备/进行中/已完成/失败）
 */
export default function DeliveryStatusCard({
  isGenerating,
  isFailed,
  isCompleted,
  hasFiles,
  elapsed,
  currentStep,
  steps,
}: {
  isGenerating: boolean;
  isFailed: boolean;
  isCompleted: boolean;
  hasFiles: boolean;
  elapsed: number;
  currentStep: number;
  steps: Array<{ id: string; label: string; icon: string }>;
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

  if (isFailed) {
    return (
      <section className="mb-6 rounded-xl bg-red-50 p-5 border border-red-200">
        <h2 className="text-base font-semibold text-red-800">交付失败</h2>
        <p className="text-sm text-red-600 mt-1">AI 代码生成未成功，请重试或联系平台。</p>
      </section>
    );
  }

  if (isCompleted) {
    return (
      <section className="mb-6 rounded-xl bg-green-50 p-5 border border-green-200">
        <h2 className="text-base font-semibold text-green-800">已交付</h2>
        <p className="text-sm text-green-600 mt-1">
          {hasFiles ? `代码已生成，可下载源码或在线访问。` : '交付完成，产物如下'}
        </p>
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
