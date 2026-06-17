'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useToast } from '@/lib/toast';
import NavBar from '@/lib/nav-bar';
import PhaseTreeView, { PhaseState } from '@/components/phase-tree-view';
import ScoreGauge from '@/components/score-gauge';

interface RoundResult {
 round: number;
 score: number;
 overallScore?: number;
 completeness: number;
 qualityScore: number;
 quality?: { passed: boolean; score: number; checks: any[]; categoryScores?: Record<string,number> };
 featureScore: number;
 l1Score?: number;
 l2Score?: number;
 l3Score?: number;
 coverage?: number;
 missingRequirements?: string[];
 risks: any[];
 recommendations: string[];
 allChecksPassed: boolean;
 details: any[];
}

export default function EvaluationPage() {
 const router = useRouter();
 const params = useParams();
 const projectId = params.id as string;
 const { token, isLoading } = useAuth();
 const { toast } = useToast();

 const [projectName, setProjectName] = useState('');
 const [iterating, setIterating] = useState(false);
 const [rounds, setRounds] = useState<RoundResult[]>([]);
 const [currentScore, setCurrentScore] = useState(0);
 const [statusText, setStatusText] = useState('就绪');
 const [stuckModal, setStuckModal] = useState<any>(null);
 const [perfectModal, setPerfectModal] = useState<any>(null);
 const [doneModal, setDoneModal] = useState<any>(null);  // 迭代完成（非达标）面板
 const [delivering, setDelivering] = useState(false);
 const [taskId, setTaskId] = useState<string | null>(null);
 const [phaseStates, setPhaseStates] = useState<PhaseState[]>([
 { id: 'sense-l1', label: 'L1 静态分析', status: 'pending', color: '#3b82f6' },
 { id: 'sense-l2', label: 'L2 运行时', status: 'pending', color: '#22c55e' },
 { id: 'sense-l3', label: 'L3 语义评估', status: 'pending', color: '#a855f7' },
 { id: 'fix', label: '定向修复', status: 'pending', color: '#f97316' },
 { id: 'decide', label: '达标判定', status: 'pending', color: '#14b8a6' },
 ]);
 const [currentRound, setCurrentRound] = useState(0);
 const [blockedByProject, setBlockedByProject] = useState<string | null>(null);
 const [connectionLost, setConnectionLost] = useState(false);
 const esRef = useRef<EventSource | null>(null);
 const hasAutoChecked = useRef(false);
 const completedRef = useRef(false);
 const retryCountRef = useRef(0);
 const tidRef = useRef<string | null>(null);

 // ── 对账：以服务端持久状态为真相，重建运行/终态 UI（流断/过期也不会无限挂起） ──
 const applyStatus = useCallback((res: any): 'running' | 'terminal' | 'idle' | 'other' => {
  if (Array.isArray(res?.rounds) && res.rounds.length) setRounds(res.rounds);
  if (Array.isArray(res?.phases) && res.phases.length) setPhaseStates(res.phases);
  if (typeof res?.score === 'number') setCurrentScore(res.score);
  if (typeof res?.round === 'number') setCurrentRound(res.round);

  if (res?.otherProjectActive && !res?.active) {
   setBlockedByProject(res.currentProjectName || res.currentProjectId || '其他项目');
   return 'other';
  }

  const t = res?.terminal || {};
  switch (res?.status) {
   case 'running':
    return 'running';
   case 'needs_human':
    completedRef.current = true; setConnectionLost(false); setIterating(false);
    setStuckModal({ ...t, needsHuman: true });
    setStatusText(t.message || '需要人工介入');
    return 'terminal';
   case 'awaiting_decision':
    completedRef.current = true; setConnectionLost(false); setIterating(false);
    setStuckModal(t);
    setStatusText(t.message || '请决策');
    return 'terminal';
   case 'done':
    completedRef.current = true; setConnectionLost(false); setIterating(false);
    if (t.reason === '达标' && (t.score ?? 0) >= 90) setPerfectModal(t);
    else { setDoneModal(t); setStatusText(`已完成 ${t.rounds ?? ''} 轮（最终评分 ${t.score ?? ''}）`); }
    return 'terminal';
   case 'error':
   case 'interrupted':
    completedRef.current = true; setConnectionLost(false); setIterating(false);
    setStatusText(res.status === 'interrupted' ? '上次迭代已中断，可重新启动' : `错误: ${t.message || ''}`);
    return 'terminal';
   default:
    setIterating(false);
    return 'idle';
  }
 }, []);

 // ── SSE 订阅逻辑（可复用：手动启动 + 自动重连） ──
 const subscribeToIteration = useCallback((tid: string) => {
 esRef.current?.close();
 completedRef.current = false;
 retryCountRef.current = 0;
 tidRef.current = tid;
 setConnectionLost(false);
 setBlockedByProject(null);

 const es = new EventSource(
 `http://localhost:3001/api/projects/${projectId}/delivery/auto-iterate/stream/${tid}?token=${encodeURIComponent(token || '')}`
 );
 esRef.current = es;

 es.onmessage = (e) => {
 try {
 const data = JSON.parse(e.data);

 switch (data.type) {
 case 'round':
 setStatusText(data.message);
 setCurrentRound(data.round || 0);
 break;

 case 'round_result':
 setRounds(prev => [...prev, data]);
 setCurrentScore(data.overallScore ?? data.score ?? 0);
 break;

 case 'phase_update':
 if (data.phases) setPhaseStates(data.phases);
 break;

 case 'stuck':
 completedRef.current = true;
 setStuckModal(data);
 setStatusText(data.message || '连续3轮无改善，请选择下一步');
 setIterating(false);
 break;

 case 'fix_failed':
 setStatusText(`第${data.round}轮: 自动修复失败 (${data.fixFailCount}/3)`);
 break;

 case 'needs_human':
 completedRef.current = true;
 setStuckModal({ ...data, needsHuman: true });
 setStatusText(data.message || '需要人工介入');
 setIterating(false);
 toast('自动修复连续失败，需要人工介入', 'error');
 break;

 case 'stuck_progress':
 setStatusText(`第${data.round}轮: 连续${data.stuckCount}轮无改善`);
 break;

 case 'done':
 completedRef.current = true;
 if (data.reason === '达标' && (data.score ?? 0) >= 90) {
 setPerfectModal(data);
 } else {
 setDoneModal(data);
 setStatusText(`已完成 ${data.rounds} 轮（最终评分 ${data.score}）`);
 }
 setIterating(false);
 break;

 case 'complete':
 completedRef.current = true;
 break;

 case 'error':
 completedRef.current = true;
 setStatusText(`错误: ${data.message}`);
 toast(data.message, 'error');
 setIterating(false);
 break;
 }
 } catch {}
 };

 es.onerror = () => {
 console.log('[auto-iterate] SSE disconnected');
 es.close();
 // 收到过 terminal 事件 → 正常断开，不重连
 if (completedRef.current) return;
 // task 已被清理 → 不重连
 if (tidRef.current !== tid) return;
 // 最多重试 3 次
 if (retryCountRef.current >= 3) {
 console.log('[auto-iterate] Max retries reached, reconciling via durable status');
 // 不再干转：用服务端持久状态对账——终态则重建结果 UI；仍在跑则提示可手动重连（心跳兜底）
 api.get(`/api/projects/${projectId}/delivery/auto-iterate/status`)
 .then((res) => { if (applyStatus(res) === 'running') setConnectionLost(true); })
 .catch(() => { setStatusText('连接已断开'); setConnectionLost(true); });
 return;
 }
 retryCountRef.current++;
 const delay = Math.min(1000 * Math.pow(2, retryCountRef.current), 8000);
 console.log(`[auto-iterate] Retry ${retryCountRef.current}/3 in ${delay}ms`);
 setTimeout(() => {
 subscribeToIteration(tid);
 }, delay);
 };
 }, [projectId, token, toast, applyStatus]);

 // ── 手动启动 ──
 const startIterate = useCallback(async () => {
 setIterating(true);
 setRounds([]);
 setCurrentScore(0);
 setStuckModal(null);
 setPerfectModal(null);
 setDoneModal(null);
 setPhaseStates([]);
 setCurrentRound(0);
 completedRef.current = false;
 retryCountRef.current = 0;
 setStatusText('⏳ 启动自迭代评估...');
 setBlockedByProject(null);
 setConnectionLost(false);

 try {
 const result = await api.post(`/api/projects/${projectId}/delivery/auto-iterate/start`);
 const tid = result.taskId;
 setTaskId(tid);
 if (result.replaced) {
 toast('已有运行中的迭代，已替换为新任务', 'info');
 }
 subscribeToIteration(tid);
 } catch (e: any) {
 if (e?.status === 409) {
 setBlockedByProject(e?.message || '其他项目正在迭代中');
 } else {
 toast(e?.message || '启动失败', 'error');
 }
 setIterating(false);
 }
 }, [projectId, subscribeToIteration, toast]);

 // ── 重连：连接断开后手动恢复 ──
 const reconnectToIteration = useCallback(async () => {
 setConnectionLost(false);
 setIterating(true);
 setStatusText('🔄 重新连接...');
 try {
 const res = await api.get(`/api/projects/${projectId}/delivery/auto-iterate/status`);
 const kind = applyStatus(res);
 if (kind === 'running' && res.taskId) {
 setTaskId(res.taskId);
 subscribeToIteration(res.taskId);
 }
 } catch {
 setStatusText('无法连接');
 setConnectionLost(true);
 setIterating(false);
 }
 }, [projectId, subscribeToIteration, applyStatus]);

 // ── 自动连接：页面加载时检查全局锁状态 ──
 useEffect(() => {
 if (isLoading || !token || !projectId || hasAutoChecked.current) return;
 hasAutoChecked.current = true;

 api.get(`/api/projects/${projectId}`).then(p => setProjectName(p?.name || '')).catch(() => {});

 api.get(`/api/projects/${projectId}/delivery/auto-iterate/status`)
 .then(res => {
 // 对账重建：running→恢复 SSE；终态→直接显示结果；其他项目→阻止横幅（均不挂起）
 const kind = applyStatus(res);
 if (kind === 'running' && res.taskId) {
 console.log('[auto-iterate] Auto-connecting to existing task:', res.taskId);
 setTaskId(res.taskId);
 setIterating(true);
 setStatusText('🔄 恢复连接...');
 subscribeToIteration(res.taskId);
 }
 })
 .catch(() => {});
 }, [isLoading, token, projectId, subscribeToIteration, applyStatus]);

 // ── 心跳对账：迭代进行中定期拉取持久状态兜底，SSE 静默失效也能自愈到终态 ──
 useEffect(() => {
 if (!iterating || !token) return;
 const h = setInterval(() => {
 api.get(`/api/projects/${projectId}/delivery/auto-iterate/status`).then(applyStatus).catch(() => {});
 }, 6000);
 return () => clearInterval(h);
 }, [iterating, token, projectId, applyStatus]);
 
 // 页面卸载时清理 SSE
 useEffect(() => {
 return () => {
 esRef.current?.close();
 };
 }, []);

 // ── 决策 ──
 const handleDecide = useCallback(async (decision: 'accept' | 'continue' | 'view_demo') => {
 try {
 await api.post(`/api/projects/${projectId}/delivery/auto-iterate/decide`, { decision });
 setStuckModal(null);
 if (decision === 'accept') {
 setStatusText('✓ 已采纳当前结果');
 toast('已采纳', 'success');
 } else if (decision === 'view_demo') {
 router.push(`/projects/${projectId}/demo`);
 } else {
 startIterate();
 }
 } catch (e: any) {
 toast(e?.message || '操作失败', 'error');
 }
 }, [projectId, router, startIterate, toast]);

 // 一键交付: 直接触发代码生成
 const handleQuickDeliver = useCallback(async () => {
 setStuckModal(null); setDoneModal(null);
 try {
 const proj = await api.get(`/api/projects/${projectId}`);
 await api.post(`/api/projects/${projectId}/delivery/deliver`, {
 projectName: proj.name || 'app',
 planSummary: proj.planSummary,
 demoHtml: proj.demoHtml,
 });
 toast('终稿交付已启动！', 'success');
 router.push(`/projects/${projectId}/delivery`);
 } catch (e: any) {
 toast(e?.message || '交付启动失败', 'error');
 }
 }, [projectId, router, toast]);

 const handlePerfectDeliver = useCallback(async () => {
 setDelivering(true);
 setPerfectModal(null);
 try {
 await api.post(`/api/projects/${projectId}/delivery/production-deliver`, {});
 toast('全栈交付已启动', 'success');
 router.push(`/projects/${projectId}/delivery`);
 } catch (e: any) {
 toast(e?.message || '交付启动失败', 'error');
 setDelivering(false);
 }
 }, [projectId, router, toast]);

 // ── 渲染 ──
 if (isLoading) return <div className="p-8 text-gray-400">加载中...</div>;
 if (!token) { router.push('/'); return null; }
 if (!projectId) return <div className="p-8 text-gray-400">无法识别项目ID</div>;

 const latest = rounds[rounds.length - 1];
 const progressColor = currentScore >= 80 ? 'bg-green-500' : currentScore >= 50 ? 'bg-yellow-500' : 'bg-red-500';

 return (
 <div className="min-h-screen bg-gray-50">
 <NavBar projectId={projectId} projectName={projectName} />
 <div className="px-6 py-8 max-w-7xl mx-auto">

 {/* ─── 迭代进行中横幅 ─── */}
 {iterating && !stuckModal && !perfectModal && !doneModal && (
 <div className="mb-6 rounded-xl bg-gradient-to-r from-indigo-500 to-blue-600 p-5 text-gray-900 shadow-lg">
 <div className="flex items-center gap-3">
 <span className="inline-flex h-4 w-4 rounded-full bg-white animate-ping" />
 <span className="inline-block h-3 w-3 rounded-full bg-white" />
 <span className="text-lg font-bold">
 {currentRound > 0 ? `自迭代进行中 — 第 ${currentRound} 轮` : '自迭代进行中'}
 </span>
 <span className="text-sm opacity-80 ml-auto">{statusText}</span>
 </div>
 <div className="mt-2 flex gap-2">
 <div className="h-1.5 flex-1 rounded-full bg-white/30 overflow-hidden">
 <div className="h-full rounded-full bg-white transition-all duration-700" style={{ width: `${currentScore}%` }} />
 </div>
 <span className="text-sm font-mono">{currentScore}%</span>
 </div>
 <p className="text-xs text-gray-900/60 mt-2">迭代自动进行中，无需手动操作</p>
 </div>
 )}

 {/* ─── 被其他项目阻止横幅 ─── */}
 {blockedByProject && (
 <div className="mb-6 rounded-xl bg-amber-50 border border-amber-200 p-5 shadow-sm">
 <div className="flex items-center gap-3">
 <span className="text-2xl">⏸️</span>
 <div>
 <p className="font-semibold text-amber-800">另一个项目正在迭代中</p>
 <p className="text-sm text-amber-700 mt-1">
 项目「{blockedByProject}」正在进行自迭代评估。同一时间仅允许一个项目运行迭代，请等待其完成。
 </p>
 </div>
 </div>
 </div>
 )}

 {/* ─── 头部控制 ─── */}
 <div className="flex items-center justify-between mb-4">
 <h1 className="text-2xl font-bold">自迭代评估</h1>
 <div className="flex items-center gap-3">
 <span className="text-sm text-gray-500">{statusText}</span>
 <button onClick={connectionLost ? reconnectToIteration : startIterate}
 disabled={iterating && !connectionLost}
 className="rounded-lg bg-indigo-600 px-5 py-2 text-sm text-gray-900 hover:bg-indigo-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
 {blockedByProject ? '重试启动' : connectionLost ? '重连' : iterating ? '运行中...' : '启动自迭代'}
 </button>
 </div>
 </div>

 {/* ─── 生成树 ─── */}
 <div className="mb-6 bg-white rounded-xl p-6 shadow-sm">
 <div className="flex items-center gap-2 mb-3">
 <span className="text-xl">🌳</span>
 <h2 className="text-base font-semibold text-gray-700">生成树</h2>
 {!iterating && phaseStates.length === 0 && (
 <span className="text-xs text-gray-400 ml-2">— 启动自迭代后将在此展示实时进度</span>
 )}
 </div>
 <PhaseTreeView phases={phaseStates} />
 </div>

 {/* ─── 综合评分 ─── */}
 <ScoreGauge
   score={currentScore}
   l1Score={latest?.l1Score}
   l2Score={latest?.l2Score}
   l3Score={latest?.l3Score}
   rounds={rounds.length}
   coverage={latest?.coverage}
   missingCount={latest?.missingRequirements?.length}
 />

{/* ─── 技术门禁 ─── */}
{latest?.quality && latest.quality.checks && (
 <div className="mb-6 bg-white rounded-xl p-5 shadow-sm">
  <div className="flex items-center justify-between mb-3">
   <div className="flex items-center gap-2">
    <span className="text-lg">🛡️</span>
    <h2 className="text-sm font-semibold text-gray-700">技术门禁</h2>
    <span className={`text-xs px-1.5 py-0.5 rounded-full ${
     latest.quality.passed ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
    }`}>
     {latest.quality.passed ? '全部通过' : `${latest.quality.checks.filter((c:any) => !c.passed).length} 项未通过`}
    </span>
   </div>
   <span className="text-xs text-gray-400">{latest.quality.checks.length} 项检查</span>
  </div>

  {/* Category scores */}
  {latest.quality.categoryScores && (
   <div className="flex gap-2 mb-3">
    {Object.entries(latest.quality.categoryScores).map(([cat, score]: [string, any]) => (
     <div key={cat} className="flex-1 text-center p-2 rounded-lg border"
      style={{ borderColor: score >= 80 ? '#22c55e40' : score >= 50 ? '#eab30840' : '#ef444440',
               background: score >= 80 ? '#f0fdf4' : score >= 50 ? '#fefce8' : '#fef2f2' }}>
      <p className="text-xs text-gray-500">{cat === 'structure' ? '结构' : cat === 'security' ? '安全' : cat === 'ux' ? '体验' : cat === 'code' ? '代码' : cat}</p>
      <p className={`text-sm font-bold ${score >= 80 ? 'text-green-600' : score >= 50 ? 'text-amber-600' : 'text-red-600'}`}>{score}</p>
     </div>
    ))}
   </div>
  )}

  {/* Check items */}
  <div className="grid grid-cols-2 gap-1.5 max-h-60 overflow-y-auto">
   {latest.quality.checks.map((c: any, i: number) => (
    <div key={i} className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs ${
     c.passed ? 'bg-gray-50' : 'bg-red-50 border border-red-100'
    }`} title={c.recommendation || c.detail}>
     <span>{c.passed ? '✅' : '❌'}</span>
     <span className="text-gray-700 truncate">{c.name}</span>
     <span className="text-gray-400 ml-auto">{c.score}</span>
    </div>
   ))}
  </div>
 </div>
)}

{/* ─── 空闲提示 ─── */}
 {!iterating && currentScore === 0 && rounds.length === 0 && (
 <div className="mb-4 space-y-2">
 <div className="rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-700">
 💡 自迭代是<strong>可选</strong>的质量优化步骤。你也可以跳过此步，直接去
 <a href={`/projects/${projectId}/demo`} className="underline font-medium">生成预览</a> 或
 <a href={`/projects/${projectId}/delivery`} className="underline font-medium">终稿交付</a>。
 </div>
 <div className="rounded-lg bg-gray-50 border border-gray-200 px-4 py-3 text-sm text-gray-600">
 点击右上角「启动自迭代」开始自动评估。系统将循环进行传感器分析、定向修复，直到达标或需要人工决策。
 </div>
 </div>
 )}

 {/* ─── 迭代记录 ─── */}
 {rounds.length > 0 && (
 <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
 <div className="lg:col-span-3 space-y-3">
 <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">迭代记录</h2>
 {[...rounds].reverse().map((r, idx) => (
 <div key={idx} className="bg-white rounded-xl p-4 shadow-sm border-l-4"
 style={{ borderColor: (r.overallScore ?? r.score ?? 0) >= 80 ? '#22c55e' : (r.overallScore ?? r.score ?? 0) >= 50 ? '#eab308' : '#ef4444' }}>
 <div className="flex items-center justify-between mb-2">
 <span className="font-medium text-sm">第 {r.round} 轮</span>
 <span className="text-lg font-bold">{r.overallScore ?? r.score ?? '?'}</span>
 </div>
 <div className="flex gap-4 text-xs text-gray-500">
 <span>L1 {r.l1Score ?? 0}</span>
 <span>L2 {r.l2Score ?? 0}</span>
 <span>L3 {r.l3Score ?? 0}</span>
 <span>覆盖 {r.coverage ?? '?'}%</span>
 </div>
 {r.risks?.length > 0 && (
 <div className="mt-2 space-y-1">
 {r.risks.slice(0, 2).map((risk: any, i: number) => (
 <div key={i} className="text-xs px-2 py-1 rounded"
 style={{ background: risk.severity === 'high' ? '#fef2f2' : '#f9fafb',
 color: risk.severity === 'high' ? '#dc2626' : '#6b7280' }}>
 {risk.description?.slice(0, 80)}
 </div>
 ))}
 </div>
 )}
 </div>
 ))}
 </div>

 <div className="lg:col-span-2">
 <div className="bg-white rounded-xl p-4 shadow-sm sticky top-4">
 {/* 风险项 */}
 {latest?.risks?.length > 0 && (
   <>
   <h2 className="font-semibold text-sm mb-3 text-red-600">⚠️ 风险项 ({latest.risks.length}项)</h2>
   <div className="space-y-2 mb-4">
   {(latest.risks || []).map((r: any, i: number) => (
   <div key={i} className="text-xs px-3 py-2 rounded border-l-2"
   style={{ borderColor: r.severity === 'high' ? '#ef4444' : '#f59e0b',
   background: r.severity === 'high' ? '#fef2f2' : '#fffbeb' }}>
   {r.description}
   </div>
   ))}
   </div>
   </>
 )}
 {/* 优化建议 */}
 {latest?.recommendations?.length > 0 && (
   <>
   <h2 className="font-semibold text-sm mb-3 text-blue-600">💡 优化建议 ({latest.recommendations.length}条)</h2>
   <div className="space-y-2">
   {latest.recommendations.map((rec: string, i: number) => (
   <div key={`rec-${i}`} className="text-xs px-3 py-2 rounded bg-blue-50 text-blue-700 border-l-2 border-blue-400">
   {rec}
   </div>
   ))}
   </div>
   </>
 )}
 {/* 无风险也无建议 */}
 {(!latest?.risks || latest.risks.length === 0) && (!latest?.recommendations || latest.recommendations.length === 0) && (
   <p className="text-xs text-gray-400">暂无风险和建议</p>
 )}
 </div>
 </div>
 </div>
 )}

 {/* ─── 迭代完成弹窗（非达标） ─── */}
 {doneModal && (
 <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-50/40">
 <div className="bg-white rounded-2xl p-8 max-w-md w-full mx-4 shadow-2xl">
 <div className="text-center mb-6">
 <div className="text-4xl mb-3">📊</div>
 <h2 className="text-xl font-bold text-gray-800">迭代完成</h2>
 <p className="text-sm text-gray-500 mt-2">
  已完成 {doneModal.rounds} 轮迭代，最终评分 {doneModal.score} 分。
 </p>
 <p className="text-sm text-gray-600 mt-1">Demo 已自动优化，可以预览或进入终稿交付。</p>
 </div>
 <div className="space-y-3">
 <button onClick={() => { setDoneModal(null); router.push(`/projects/${projectId}/demo`); }}
 className="w-full rounded-xl bg-indigo-600 px-6 py-3 text-white font-medium hover:bg-indigo-700">
  查看 Demo 预览
 </button>
 <button onClick={handleQuickDeliver}
 className="w-full rounded-xl bg-green-600 px-6 py-3 text-white font-medium hover:bg-green-700">
  开始终稿交付
 </button>
 <button onClick={() => setDoneModal(null)}
 className="w-full rounded-xl border border-gray-200 px-6 py-3 text-gray-500 text-sm hover:bg-gray-50">
  关闭
 </button>
 </div>
 </div>
 </div>
 )}

 {/* ─── 达标弹窗 ─── */}
 {perfectModal && (
 <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-50/40">
 <div className="bg-white rounded-2xl p-8 max-w-md w-full mx-4 shadow-2xl">
 <div className="text-center mb-6">
 <div className="text-4xl mb-3">🎉</div>
 <h2 className="text-xl font-bold text-green-700">方案完美达标</h2>
 <p className="text-sm text-gray-500 mt-2">
 综合评分 {currentScore}%，{perfectModal.rounds} 轮迭代完成。
 </p>
 <p className="text-sm text-gray-600 mt-1 font-medium">是否开始终稿全栈交付？</p>
 </div>
 <div className="space-y-3">
 <button onClick={handlePerfectDeliver} disabled={delivering}
 className="w-full rounded-xl bg-green-600 px-6 py-3 text-gray-900 font-medium hover:bg-green-700 disabled:opacity-50">
 {delivering ? '启动中...' : '开始终稿交付'}
 </button>
 <button onClick={() => { setPerfectModal(null); router.push(`/projects/${projectId}/demo`); }}
 className="w-full rounded-xl border border-gray-300 px-6 py-3 text-gray-700 font-medium hover:bg-gray-50">
 先看 Demo 预览
 </button>
 <button onClick={() => setPerfectModal(null)}
 className="w-full rounded-xl border border-gray-200 px-6 py-3 text-gray-500 text-sm hover:bg-gray-50">
 稍后再说
 </button>
 </div>
 </div>
 </div>
 )}

 {/* ─── 卡住弹窗 ─── */}
 {stuckModal && (
 <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-50/40">
 <div className="bg-white rounded-2xl p-8 max-w-md w-full mx-4 shadow-2xl">
 <div className="text-center mb-6">
 <div className="text-3xl mb-2">{stuckModal.needsHuman ? '🆘' : '🤔'}</div>
 <h2 className="text-lg font-bold text-gray-900">{stuckModal.needsHuman ? '需要人工介入' : '迭代遇到瓶颈'}</h2>
 <p className="text-sm text-gray-500 mt-1">
  {stuckModal.needsHuman
   ? `自动修复已连续失败 3 次，平台无法自动恢复。建议人工检查问题后重试。`
   : `连续3轮评分没有提升（当前 ${stuckModal.score} 分）`}
 </p>
 </div>
 <div className="space-y-3">
 {stuckModal.needsHuman ? (
  <>
   <button onClick={() => { setStuckModal(null); router.push(`/projects/${projectId}/demo`); }}
   className="w-full rounded-xl bg-amber-600 px-6 py-3 text-white font-medium hover:bg-amber-700">
    查看 Demo 手动修复
   </button>
   <button onClick={handleQuickDeliver}
   className="w-full rounded-xl bg-green-600 px-6 py-3 text-white font-medium hover:bg-green-700">
    开始终稿交付
   </button>
   <button onClick={() => { setStuckModal(null); }}
   className="w-full rounded-xl border border-gray-300 px-6 py-3 text-gray-700 font-medium hover:bg-gray-50">
    关闭
   </button>
  </>
 ) : (
  <>
 <button onClick={() => handleDecide('accept')}
 className="w-full rounded-xl bg-blue-600 px-6 py-3 text-white font-medium hover:bg-blue-700">
 方案A：采纳当前结果
 </button>
 <button onClick={() => handleDecide('continue')}
 className="w-full rounded-xl border border-blue-300 px-6 py-3 text-blue-700 font-medium hover:bg-blue-50">
 方案B：继续迭代
 </button>
 <button onClick={() => handleDecide('view_demo')}
 className="w-full rounded-xl border border-gray-300 px-6 py-3 text-gray-700 font-medium hover:bg-gray-50">
 查看当前 Demo
 </button>
 <button onClick={handleQuickDeliver}
 className="w-full rounded-xl bg-green-600 px-6 py-3 text-white font-medium hover:bg-green-700">
 开始终稿交付
 </button>
  </>
 )}
 </div>
 </div>
 </div>
 )}
 </div>
 </div>
 );
}
