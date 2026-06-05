'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import NavBar from '@/lib/nav-bar';
import DesignSuggestions from './design-suggestions';
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

 const initEdit = (data: PlanData) => {
 setEditSummary(data?.summary || '');
 setEditPages(data?.pages || []);
 setEditFeatures(data?.features || []);
 setEditRoles(data?.roles || []);
 setEditDataObjects(data?.dataObjects || []);
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
 await api.put(`/api/projects/${projectId}/plan/confirm`);
 router.push(`/projects/${projectId}/demo`);
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
 {plan.pages?.length > 0 ? plan.pages.map((p, i) => <li key={i}>{p}</li>) : <p className="text-gray-500/70">暂无</p>}
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
 {plan.features?.length > 0 ? plan.features.map((f, i) => <li key={i}>{f}</li>) : <p className="text-gray-500/70">暂无</p>}
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
 {plan.roles?.length > 0 ? plan.roles.map((r, i) => <li key={i}>{r}</li>) : <p className="text-gray-500/70">暂无</p>}
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
 {plan.dataObjects?.length > 0 ? plan.dataObjects.map((d, i) => <li key={i}>{d}</li>) : <p className="text-gray-500/70">暂无</p>}
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
 <DesignSuggestions projectId={projectId} />
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
