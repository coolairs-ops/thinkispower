'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import NavBar from '@/lib/nav-bar';
import DesignSuggestions from './design-suggestions';
import FollowUpQuestions from './follow-up-questions';
import RuleEngineEntry from './rule-engine-entry';
import NextStepCard from '@/components/next-step-card';
import WarningCard from '@/components/warning-card';

interface PlanData {
 summary: string;
 pages: string[];
 features: string[];
 roles: string[];
 dataObjects: string[];
 estimatedDays: number;
 estimatedPriceRange: string;
 acceptanceChecklist: string[];
}

export default function PlanPage() {
 const params = useParams();
 const router = useRouter();
 const projectId = params.id as string;
 const { token, isLoading } = useAuth();

 const [plan, setPlan] = useState<PlanData | null>(null);
 const [projectName, setProjectName] = useState('');
 const [loading, setLoading] = useState(true);
 const [saving, setSaving] = useState(false);
	const [refreshKey, setRefreshKey] = useState(0);

 const [editing, setEditing] = useState(false);
 const [activeTab, setActiveTab] = useState<'plan' | 'design'>('plan');
 const [editSummary, setEditSummary] = useState('');
 const [editPages, setEditPages] = useState<string[]>([]);
 const [editFeatures, setEditFeatures] = useState<string[]>([]);
 const [editRoles, setEditRoles] = useState<string[]>([]);
 const [editDataObjects, setEditDataObjects] = useState<string[]>([]);
 const [editDays, setEditDays] = useState(0);
 const [editPrice, setEditPrice] = useState('');

 // 关系补录：设计采纳后才开启（顺序：设计→关系）。relKey 触发问答重取。
 const [designReady, setDesignReady] = useState(false);
 const [relKey, setRelKey] = useState(0);
 const [detecting, setDetecting] = useState(false);
 const [useRuoyi, setUseRuoyi] = useState(false);
 const [ruoyiStatus, setRuoyiStatus] = useState<string | null>(null);
 const [togglingBackend, setTogglingBackend] = useState(false);

 useEffect(() => {
 if (isLoading) return;
 if (!token) { router.push('/'); return; }

 Promise.all([
 api.get(`/api/projects/${projectId}/plan`),
 api.get(`/api/projects/${projectId}`),
 ])
 .then(([planData, proj]) => {
 setPlan(planData);
 setProjectName(proj.name || '');
 initEdit(planData);
 setLoading(false);
 })
 .catch(() => setLoading(false));
 }, [projectId, token, isLoading, router]);

 // 兼容两种格式：字符串 或 {name} 对象（导入路径产出 [{name}]）
 const toStr = (x: unknown): string =>
   typeof x === 'string' ? x : x && typeof x === 'object' && 'name' in x ? String((x as { name?: unknown }).name ?? '') : String(x ?? '');

 const initEdit = (data: PlanData) => {
 setEditSummary(data?.summary || '');
 setEditPages((data?.pages || []).map(toStr));
 setEditFeatures((data?.features || []).map(toStr));
 setEditRoles((data?.roles || []).map(toStr));
 setEditDataObjects((data?.dataObjects || []).map(toStr));
 setEditDays(data?.estimatedDays || 0);
 setEditPrice(data?.estimatedPriceRange || '');
 };

 const handleSave = async () => {
 setSaving(true);
 const updatedPlan = {
 summary: editSummary,
 pages: editPages.filter(Boolean),
 features: editFeatures.filter(Boolean),
 roles: editRoles.filter(Boolean),
 dataObjects: editDataObjects.filter(Boolean),
 estimatedDays: editDays,
 estimatedPriceRange: editPrice,
 };

 const saved = await api.put(`/api/projects/${projectId}/plan`, updatedPlan);
 setPlan(saved);
 initEdit(saved);
 setEditing(false);
 setSaving(false);
	setRefreshKey(k => k + 1);
 };

 const handleCancel = () => {
 if (plan) initEdit(plan);
 setEditing(false);
 };

 const handleConfirm = async () => {
 try {
 await api.put(`/api/projects/${projectId}/plan/confirm`);
 router.push(`/projects/${projectId}/demo`);
 } catch (e: any) {
 // 已进入开发/交付阶段(锁定态)等 → 优雅提示，不崩成 Next 未捕获错误浮层
 alert(e?.message || '确认方案失败，请稍后重试');
 }
 };

 // 进页加载"后端底座"意图（kind=ruoyi 即已指定若依）
 useEffect(() => {
   if (!token) return;
   api.get(`/api/projects/${projectId}/ruoyi`)
     .then((r: any) => { const be = r?.backendRuntime; setUseRuoyi(be?.kind === 'ruoyi'); setRuoyiStatus(be?.status ?? null); })
     .catch(() => {});
 }, [projectId, token]);

 const toggleBackend = async () => {
   setTogglingBackend(true);
   try {
     const r: any = await api.post(`/api/projects/${projectId}/ruoyi/designate`, { use: !useRuoyi });
     setUseRuoyi(r.desiredBackend === 'ruoyi');
     setRuoyiStatus(r.status ?? null);
   } catch (e: any) {
     alert(e?.message || '切换后端底座失败');
   } finally {
     setTogglingBackend(false);
   }
 };

 // 进页时若设计已采纳过 → 直接开启关系问答（返场用户也能看到）
 useEffect(() => {
   if (!token) return;
   api.get(`/api/projects/${projectId}/plan/design-suggestions`)
     .then((ds: any) => { if (Array.isArray(ds) && ds.some((s: any) => s?.adopted)) setDesignReady(true); })
     .catch(() => {});
 }, [projectId, token]);

 // 设计采纳保存后：基于已采纳的设计检测实体关系 → 出追加问答
 const handleDesignSaved = async () => {
   setDesignReady(true);
   setDetecting(true);
   // 基于已采纳的设计，并行检测实体关系 + 业务规则 → 一起进追加问答
   try {
     await Promise.all([
       api.post(`/api/projects/${projectId}/requirement/relations/detect`),
       api.post(`/api/projects/${projectId}/requirement/business-rules/detect`),
     ]);
   } catch {}
   setDetecting(false);
   setRelKey(k => k + 1);
 };

 const updateArrayItem = (arr: string[], index: number, value: string, setter: (v: string[]) => void) => {
 const next = [...arr];
 next[index] = value;
 setter(next);
 };
 const addArrayItem = (arr: string[], setter: (v: string[]) => void) => {
 setter([...arr, '']);
 };
 const removeArrayItem = (arr: string[], index: number, setter: (v: string[]) => void) => {
 setter(arr.filter((_, i) => i !== index));
 };

 if (isLoading) return null;
 if (loading) return <div className="p-8 text-gray-500">加载中...</div>;

 return (
 <div className="min-h-screen bg-gray-200">
 <NavBar projectId={projectId} projectName={projectName} />

  <div className="px-6 pt-4 space-y-3">
    <WarningCard projectId={projectId} refreshKey={refreshKey} />
    <NextStepCard projectId={projectId} />
  </div>

  <div className="px-6 py-8">
 <div className="mx-auto max-w-3xl">
 <div className="flex items-center justify-between mb-6">
 <div>
 <h1 className="text-2xl font-bold text-gray-900">方案确认</h1>
 <p className="text-gray-500 mt-1">{editing ? '编辑方案内容，修改后点击保存' : '确认方案无误后点击"确认方案"，平台将开始生成预览'}</p>
 </div>
 <Link
 href={`/projects/${projectId}/spec`}
 className="px-3 py-1.5 text-sm border border-blue-300 text-blue-600 rounded-lg hover:bg-blue-50 transition-colors"
 >
 产品规格 →
 </Link>
 </div>

 {/* 规则定义子环节（形态A）：这系统要不要风险评分/分级 */}
 <RuleEngineEntry projectId={projectId} />

 {/* 后端底座选择（ADR-0005 第2层显式意图）：路B 通用CRUD / 若依政企底座 */}
 <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4 flex items-center justify-between gap-4">
   <div>
     <div className="font-medium text-gray-900">后端底座</div>
     <p className="text-xs text-gray-500 mt-0.5">
       {useRuoyi
         ? '若依政企底座：多角色 + 数据权限（普通用户只看自己/领导看全部），交付时自动置备'
         : '路B 通用 CRUD（默认，开箱即用、轻量）'}
       {useRuoyi && ruoyiStatus && ruoyiStatus !== 'pending' ? `　·　置备状态：${ruoyiStatus}` : ''}
     </p>
   </div>
   <div className="flex rounded-lg border border-gray-300 overflow-hidden text-sm shrink-0">
     <button
       onClick={() => { if (useRuoyi && !togglingBackend) toggleBackend(); }}
       disabled={togglingBackend || (useRuoyi && !!ruoyiStatus && ruoyiStatus !== 'pending')}
       className={`px-4 py-1.5 ${!useRuoyi ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
     >路B</button>
     <button
       onClick={() => { if (!useRuoyi && !togglingBackend) toggleBackend(); }}
       disabled={togglingBackend}
       className={`px-4 py-1.5 border-l border-gray-300 ${useRuoyi ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
     >若依</button>
   </div>
 </div>

 {/* Tab bar */}
 <div className="flex gap-0 mb-6 border-b border-gray-200">
 <button
 onClick={() => setActiveTab('plan')}
 className={`px-5 py-2.5 text-sm font-medium transition-colors ${activeTab === 'plan' ? 'border-b-2 border-blue-500 text-blue-600' : 'text-gray-500 hover:text-gray-900'}`}
 >
 方案内容
 </button>
 <button
 onClick={() => setActiveTab('design')}
 className={`px-5 py-2.5 text-sm font-medium transition-colors ${activeTab === 'design' ? 'border-b-2 border-blue-500 text-blue-600' : 'text-gray-500 hover:text-gray-900'}`}
 >
 设计建议
 </button>
 </div>

 {activeTab === 'plan' ? (plan ? (
 <div className="space-y-6">
 <EditableSection title="项目简介" editing={editing}>
 {editing ? (
 <textarea
 value={editSummary}
 onChange={(e) => setEditSummary(e.target.value)}
 className="w-full rounded-lg border border-gray-200 bg-gray-200 px-3 py-2 text-gray-900 focus:border-blue-500 focus:outline-none"
 rows={2}
 />
 ) : (
 <p className="text-gray-500">{plan.summary || '暂无'}</p>
 )}
 </EditableSection>

 <EditableSection title="页面清单" editing={editing}>
 {editing ? (
 <div className="space-y-2">
 {editPages.map((p, i) => (
 <div key={i} className="flex gap-2">
 <input
 value={p}
 onChange={(e) => updateArrayItem(editPages, i, e.target.value, setEditPages)}
 className="flex-1 rounded-lg border border-gray-200 bg-gray-200 px-3 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none"
 />
 <button onClick={() => removeArrayItem(editPages, i, setEditPages)} className="text-red-500 hover:text-red-700 px-2">✕</button>
 </div>
 ))}
 <button onClick={() => addArrayItem(editPages, setEditPages)} className="text-sm text-blue-600 hover:text-blue-700">+ 添加页面</button>
 </div>
 ) : (
 <ul className="list-inside list-disc text-gray-500">
 {plan.pages?.length > 0 ? plan.pages.map((p, i) => <li key={i}>{toStr(p)}</li>) : <p className="text-gray-500/70">暂无</p>}
 </ul>
 )}
 </EditableSection>

 <EditableSection title="功能清单" editing={editing}>
 {editing ? (
 <div className="space-y-2">
 {editFeatures.map((f, i) => (
 <div key={i} className="flex gap-2">
 <input
 value={f}
 onChange={(e) => updateArrayItem(editFeatures, i, e.target.value, setEditFeatures)}
 className="flex-1 rounded-lg border border-gray-200 bg-gray-200 px-3 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none"
 />
 <button onClick={() => removeArrayItem(editFeatures, i, setEditFeatures)} className="text-red-500 hover:text-red-700 px-2">✕</button>
 </div>
 ))}
 <button onClick={() => addArrayItem(editFeatures, setEditFeatures)} className="text-sm text-blue-600 hover:text-blue-700">+ 添加功能</button>
 </div>
 ) : (
 <ul className="list-inside list-disc text-gray-500">
 {plan.features?.length > 0 ? plan.features.map((f, i) => <li key={i}>{toStr(f)}</li>) : <p className="text-gray-500/70">暂无</p>}
 </ul>
 )}
 </EditableSection>

 <EditableSection title="角色权限" editing={editing}>
 {editing ? (
 <div className="space-y-2">
 {editRoles.map((r, i) => (
 <div key={i} className="flex gap-2">
 <input
 value={r}
 onChange={(e) => updateArrayItem(editRoles, i, e.target.value, setEditRoles)}
 className="flex-1 rounded-lg border border-gray-200 bg-gray-200 px-3 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none"
 />
 <button onClick={() => removeArrayItem(editRoles, i, setEditRoles)} className="text-red-500 hover:text-red-700 px-2">✕</button>
 </div>
 ))}
 <button onClick={() => addArrayItem(editRoles, setEditRoles)} className="text-sm text-blue-600 hover:text-blue-700">+ 添加角色</button>
 </div>
 ) : (
 <ul className="list-inside list-disc text-gray-500">
 {plan.roles?.length > 0 ? plan.roles.map((r, i) => <li key={i}>{toStr(r)}</li>) : <p className="text-gray-500/70">暂无</p>}
 </ul>
 )}
 </EditableSection>

 <EditableSection title="数据对象" editing={editing}>
 {editing ? (
 <div className="space-y-2">
 {editDataObjects.map((d, i) => (
 <div key={i} className="flex gap-2">
 <input
 value={d}
 onChange={(e) => updateArrayItem(editDataObjects, i, e.target.value, setEditDataObjects)}
 className="flex-1 rounded-lg border border-gray-200 bg-gray-200 px-3 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none"
 />
 <button onClick={() => removeArrayItem(editDataObjects, i, setEditDataObjects)} className="text-red-500 hover:text-red-700 px-2">✕</button>
 </div>
 ))}
 <button onClick={() => addArrayItem(editDataObjects, setEditDataObjects)} className="text-sm text-blue-600 hover:text-blue-700">+ 添加数据对象</button>
 </div>
 ) : (
 <ul className="list-inside list-disc text-gray-500">
 {plan.dataObjects?.length > 0 ? plan.dataObjects.map((d, i) => <li key={i}>{toStr(d)}</li>) : <p className="text-gray-500/70">暂无</p>}
 </ul>
 )}
 </EditableSection>

 <EditableSection title="预计周期与费用" editing={editing}>
 {editing ? (
 <div className="space-y-3">
 <div>
 <label className="block text-sm text-gray-500 mb-1">预计开发天数</label>
 <input
 type="number"
 value={editDays}
 onChange={(e) => setEditDays(parseInt(e.target.value) || 0)}
 className="w-32 rounded-lg border border-gray-200 bg-gray-200 px-3 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none"
 min={1}
 />
 </div>
 <div>
 <label className="block text-sm text-gray-500 mb-1">预计费用范围</label>
 <input
 value={editPrice}
 onChange={(e) => setEditPrice(e.target.value)}
 className="w-64 rounded-lg border border-gray-200 bg-gray-200 px-3 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none"
 placeholder="例：¥8,000-¥15,000"
 />
 </div>
 </div>
 ) : (
 <div>
 {plan.estimatedDays && <p className="text-gray-500">预计开发周期：约 {plan.estimatedDays} 天</p>}
 {plan.estimatedPriceRange && <p className="text-gray-500">预计费用范围：{plan.estimatedPriceRange}</p>}
 </div>
 )}
 </EditableSection>

 {editing ? (
 <div className="flex gap-3">
 <button
 onClick={handleSave}
 disabled={saving}
 className="rounded-lg bg-blue-600 px-6 py-2 text-white hover:bg-blue-700 transition-colors disabled:bg-gray-400"
 >
 {saving ? '保存中...' : '💾 保存修改'}
 </button>
 <button
 onClick={handleCancel}
 className="rounded-lg border border-gray-200 px-6 py-2 text-gray-900 hover:bg-gray-100 transition-colors"
 >
 取消
 </button>
 </div>
 ) : (
 <div className="flex gap-3">
 <button
 onClick={handleConfirm}
 className="rounded-lg bg-blue-600 px-6 py-2 text-gray-900 hover:bg-blue-700 transition-colors"
 >
 确认方案
 </button>
 <button
 onClick={() => router.push(`/projects/${projectId}`)}
 className="rounded-lg border border-gray-200 px-6 py-2 text-gray-900 hover:bg-gray-100 transition-colors"
 >
 返回聊天
 </button>
 </div>
 )}
 </div>
 ) : (
 <div className="rounded-xl bg-white p-8 text-center shadow-sm">
 <p className="text-gray-500">方案尚未生成，请先在聊天中描述需求。</p>
 <button
 onClick={() => router.push(`/projects/${projectId}`)}
 className="mt-4 text-blue-600 hover:underline"
 >
 去描述需求
 </button>
 </div>
 )) : (
 <div className="space-y-4">
 <DesignSuggestions projectId={projectId} onSaved={handleDesignSaved} />
 {detecting && (
 <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
 正在根据你采纳的设计分析实体关系与业务规则…
 </div>
 )}
 <FollowUpQuestions projectId={projectId} enabled={designReady} refreshKey={relKey} onDone={() => setActiveTab('plan')} />
 </div>
 )}
 </div>
 </div>
 </div>
 );
}

function EditableSection({ title, editing, children }: { title: string; editing: boolean; children: React.ReactNode }) {
 return (
 <section className={`rounded-xl bg-white p-6 shadow-sm ${editing ? 'ring-2 ring-blue-500/20' : ''}`}>
 <h2 className="mb-3 text-lg font-semibold text-gray-900">{title}</h2>
 {children}
 </section>
 );
}
