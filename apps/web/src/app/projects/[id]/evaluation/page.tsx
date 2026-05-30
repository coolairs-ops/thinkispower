'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useToast } from '@/lib/toast';
import NavBar from '@/lib/nav-bar';

export default function EvaluationPage() {
  const router = useRouter();
  const params = useParams();
  const projectId = params.id as string;
  const { token, isLoading } = useAuth();
  const { toast } = useToast();

  const [projectName, setProjectName] = useState('');
  const [analysis, setAnalysis] = useState<any>(null);
  const [evaluating, setEvaluating] = useState(false);
  const [riskEdits, setRiskEdits] = useState<Record<number, string>>({});
  const [queuedRisks, setQueuedRisks] = useState<Set<number>>(new Set());
  const [progressLines, setProgressLines] = useState<string[]>([]);
  const [showProgress, setShowProgress] = useState(false);
  const [polling, setPolling] = useState(false);
  const [fixStatus, setFixStatus] = useState('');
  const hasLoaded = useRef(false);

  // ===== 评估 =====
  const doEvaluate = useCallback(async () => {
    setEvaluating(true);
    setShowProgress(true);
    setProgressLines(['  准备评估...']);
    try {
      const r = await api.post(`/api/projects/${projectId}/delivery/evaluate`);
      if (r?.analysis) {
        setAnalysis(r.analysis);
        setProgressLines(p => [...p, `  ✅ ${r.analysis.risks?.length || 0}项风险, ${r.analysis.completeness}%`]);
        toast('评估完成', 'success');
      } else {
        setProgressLines(p => [...p, `  ❌ 返回数据异常`]);
        toast('评估失败', 'error');
      }
    } catch (e: any) {
      setProgressLines(p => [...p, `  ❌ ${e?.message || '请求失败'}`]);
      toast('评估失败', 'error');
    }
    setEvaluating(false);
  }, [projectId, toast]);

  useEffect(() => {
    if (isLoading || !token || hasLoaded.current) return;
    hasLoaded.current = true;
    api.get(`/api/projects/${projectId}`).then(p => setProjectName(p?.name || '')).catch(() => {});
    doEvaluate();
  }, [isLoading, token, projectId, doEvaluate]);

  // ===== 加入修复队列 =====
  const handleAccept = useCallback(async (index: number) => {
    try {
      await api.post(`/api/projects/${projectId}/delivery/accept-risk-fix`, {
        riskIndex: index, customFix: riskEdits[index] || undefined
      });
      setQueuedRisks(p => new Set(p).add(index));
      toast('已加入队列', 'success');
    } catch (e: any) {
      toast('加入失败', 'error');
    }
  }, [projectId, riskEdits, toast]);

  // ===== 执行修复 =====
  const handleReEvaluate = useCallback(async () => {
    setPolling(true);
    setShowProgress(true);
    setProgressLines([`  提交 ${queuedRisks.size} 项修复...`]);
    try {
      const r = await api.post(`/api/projects/${projectId}/delivery/re-evaluate`);
      setQueuedRisks(new Set());
      setProgressLines(p => [...p, `  ✅ 已启动`]);

      const est = Math.ceil((r.queuedCount || 1) * 0.7);
      setFixStatus(`修复中... ≈${est}分钟`);
      toast('修复已启动', 'success');

      // 轮询
      const poll = setInterval(async () => {
        try {
          const s = await api.get(`/api/projects/${projectId}/delivery/re-evaluate-status`);
          if (s.done) {
            clearInterval(poll);
            setPolling(false);
            setFixStatus('');
            setProgressLines(p => [...p, `  ✅ 修复完成`]);
            doEvaluate();
          }
        } catch {}
      }, 5000);
    } catch (e: any) {
      setPolling(false);
      setProgressLines(p => [...p, `  ❌ ${e?.message}`]);
      toast('提交失败', 'error');
    }
  }, [projectId, queuedRisks, toast, doEvaluate]);

  if (isLoading) return <div className="p-8 text-gray-400">加载中...</div>;
  if (!token) { router.push('/'); return null; }
  if (!projectId) return <div className="p-8 text-gray-400">无法识别项目ID，请从项目列表进入</div>;

  const risks = analysis?.risks || [];
  const disabled = evaluating || polling;

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar projectId={projectId} projectName={projectName} />
      <div className="px-6 py-8 max-w-7xl mx-auto">

        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold">项目评估</h1>
          <div className="flex gap-3">
            {queuedRisks.size > 0 ? (
              <button onClick={handleReEvaluate} disabled={disabled}
                className={`px-4 py-2 rounded text-white ${disabled ? 'bg-gray-300' : 'bg-purple-600 hover:bg-purple-700'}`}>
                {polling ? fixStatus : `执行修复 (${queuedRisks.size}项)`}
              </button>
            ) : (
              <button onClick={doEvaluate} disabled={disabled}
                className={`px-4 py-2 rounded text-white ${disabled ? 'bg-gray-300' : 'bg-indigo-600 hover:bg-indigo-700'}`}>
                {evaluating ? '评估中...' : '重新评估'}
              </button>
            )}
            <button onClick={() => router.push(`/projects/${projectId}/delivery`)} disabled={disabled}
              className={`px-4 py-2 rounded text-white ${disabled ? 'bg-gray-300' : 'bg-green-600 hover:bg-green-700'}`}>
              终稿交付
            </button>
          </div>
        </div>

        {showProgress && (
          <div className="mb-4 rounded-lg overflow-hidden border border-gray-700" style={{ background: '#0d1117' }}>
            <div className="flex items-center gap-2 px-3 py-1.5" style={{ background: '#161b22', borderBottom: '1px solid #30363d' }}>
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: evaluating || polling ? '#f59e0b' : '#3fb950' }}></span>
              <span className="text-xs text-gray-400">{evaluating || polling ? '处理中' : '就绪'}</span>
            </div>
            <div className="px-3 py-2 font-mono text-xs leading-relaxed" style={{ color: '#c9d1d9', maxHeight: '160px', overflowY: 'auto' }}>
              {progressLines.map((l, i) => (
                <div key={i} className={l.includes('✅') ? 'text-green-400' : l.includes('❌') ? 'text-red-400' : 'text-gray-400'}>
                  {l}
                </div>
              ))}
            </div>
          </div>
        )}

        {analysis ? (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            <div className="lg:col-span-3 space-y-4">
              <div className="bg-white rounded-xl p-6 shadow-sm">
                <h2 className="font-semibold mb-3">完整度：{analysis.completeness}%</h2>
                <div className="h-2 bg-gray-200 rounded-full mb-4">
                  <div className="h-2 rounded-full bg-green-500" style={{ width: `${analysis.completeness}%` }} />
                </div>
                {risks.map((r: any, i: number) => (
                  <div key={i} className="text-sm py-2 px-3 rounded mb-1 border-l-4"
                    style={{
                      borderColor: r.severity==='high'?'#ef4444':r.severity==='medium'?'#f59e0b':'#6b7280',
                      background: r.severity==='high'?'#fef2f2':r.severity==='medium'?'#fffbeb':'#f9fafb'
                    }}>
                    [{r.severity==='high'?'高':r.severity==='medium'?'中':'低'}] {r.description}
                  </div>
                ))}
              </div>
              <div className="bg-white rounded-xl p-4 shadow-sm">
                <iframe src={`/projects/${projectId}/demo`} className="w-full border rounded" style={{ height: '400px' }} title="预览" />
              </div>
            </div>

            <div className="lg:col-span-2">
              <div className="bg-white rounded-xl p-6 shadow-sm sticky top-4">
                <h2 className="font-semibold mb-3">修改建议 {queuedRisks.size > 0 && <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded">{queuedRisks.size}项</span>}</h2>
                {risks.map((r: any, i: number) => (
                  <div key={i} className="border rounded p-3 mb-3 text-sm">
                    <p className="font-medium mb-1">{r.fixTitle || `建议 #${i+1}`}</p>
                    <textarea value={riskEdits[i] ?? r.fixContent ?? ''}
                      onChange={e => setRiskEdits(p => ({...p, [i]: e.target.value}))}
                      disabled={disabled} className="w-full p-2 border rounded text-xs resize-y disabled:bg-gray-50" rows={3} />
                    <button onClick={() => handleAccept(i)} disabled={disabled || queuedRisks.has(i)}
                      className={`mt-1 w-full text-xs py-1.5 rounded ${queuedRisks.has(i) ? 'bg-yellow-100 text-yellow-700' : disabled ? 'bg-gray-100 text-gray-400' : 'bg-blue-600 text-white hover:bg-blue-700'}`}>
                      {queuedRisks.has(i) ? '已加入队列' : '加入修复队列'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center py-16 text-gray-400">
            {evaluating ? '正在评估项目...' : '点击上方按钮开始'}
          </div>
        )}
      </div>
    </div>
  );
}
