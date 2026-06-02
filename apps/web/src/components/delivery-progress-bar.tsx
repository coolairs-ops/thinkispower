'use client';

/**
 * 交付进度条 — 终端风格实时日志
 */
export default function DeliveryProgressBar({
  currentStep,
  steps,
}: {
  currentStep: number;
  steps: Array<{ id: string; label: string; icon: string }>;
}) {
  return (
    <section className="mb-6 rounded-xl bg-white p-5 shadow-sm border border-indigo-100">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">实时进度</h3>
      <div className="bg-gray-900 rounded-lg p-3 font-mono text-xs max-h-32 overflow-y-auto" style={{ color: '#58a6ff' }}>
        <div className="py-0.5">▸ 启动交付流水线... <span className="text-green-400">✅</span></div>
        {currentStep >= 1 && <div className="py-0.5" style={{ color: '#3fb950' }}>▸ Step 1/4: {steps[0]?.label} 生成完成 ✅</div>}
        {currentStep >= 2 && <div className="py-0.5" style={{ color: '#3fb950' }}>▸ Step 2/4: {steps[1]?.label} 生成完成 ✅</div>}
        {currentStep >= 3 && <div className="py-0.5" style={{ color: '#3fb950' }}>▸ Step 3/4: {steps[2]?.label} 生成完成 ✅</div>}
        {currentStep >= 4 && <div className="py-0.5" style={{ color: '#3fb950' }}>▸ Step 4/4: {steps[3]?.label} 完成 ✅</div>}
        {currentStep === 4 && <div className="py-0.5" style={{ color: '#d29922' }}>▸ 注入企业模板... ✅</div>}
        <div className="py-0.5 animate-pulse">▸ {currentStep < 4 ? '正在生成...' : '正在部署...'}<span>█</span></div>
      </div>
    </section>
  );
}
