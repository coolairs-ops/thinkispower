'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import NavBar from '@/lib/nav-bar';

interface Message {
 id: string;
 role: string;
 content: string;
 createdAt: string;
}

interface PRD {
 productName: string;
 summary: string;
 background: string;
 targetUsers: string[];
 userPainPoints: string[];
 useScenarios: string[];
 coreValue: string;
 productForm: string;
 mvpScope: string[];
 successCriteria: string[];
 pages: string[];
 features: string[];
 roles: string[];
 dataObjects: string[];
 riskPoints: string[];
}

export default function ProjectChatPage() {
 const params = useParams();
 const router = useRouter();
 const projectId = params.id as string;
 const { token, isLoading } = useAuth();

 const [project, setProject] = useState<any>(null);
 const [messages, setMessages] = useState<Message[]>([]);
 const [input, setInput] = useState('');
 const [sending, setSending] = useState(false);
 const messagesEndRef = useRef<HTMLDivElement>(null);

 // PRD editing state
 const [prd, setPrd] = useState<PRD | null>(null);
 const [editing, setEditing] = useState(false);
 const [editPrd, setEditPrd] = useState<PRD | null>(null);
 const [saving, setSaving] = useState(false);

 useEffect(() => {
 if (isLoading) return;
 if (!token) { router.push('/'); return; }

 Promise.all([
 api.get(`/api/projects/${projectId}`),
 api.get(`/api/projects/${projectId}/messages`),
 ])
 .then(([proj, msgs]) => {
 setProject(proj);
 const actualMsgs = Array.isArray(msgs) ? msgs : [];
 setMessages(actualMsgs);
 // Extract PRD from project
 if (proj.structuredRequirement) {
 const raw = proj.structuredRequirement.prd || proj.structuredRequirement;
 setPrd(raw);
 setEditPrd(JSON.parse(JSON.stringify(raw)));
 }

   // 未开始访谈且无历史消息 → 跳转到独立访谈页
   api.get(`/api/projects/${projectId}/idea`).then((idea: any) => {
     if (idea && !idea.done && idea.question && actualMsgs.length === 0) {
       router.push(`/projects/${projectId}/idea`);
       return;
     }
   }).catch(() => {});
 })
 .catch(() => router.push('/dashboard'));
 }, [projectId, token, isLoading, router]);

 useEffect(() => {
 messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
 }, [messages]);

 const handleSend = async () => {
   if (!input.trim() || sending) return;
   setSending(true);
   const userMsg = input;
   setInput('');

   // 普通聊天模式

    setMessages((prev) => [...prev, { id: 'temp', role: 'user', content: userMsg, createdAt: new Date().toISOString() }]);

    try {
      const data = await api.post(`/api/projects/${projectId}/messages`, { content: userMsg });
      setMessages(data.messages || []);
      const proj = await api.get(`/api/projects/${projectId}`);
      setProject(proj);
      if (proj.structuredRequirement) {
        const raw = proj.structuredRequirement.prd || proj.structuredRequirement;
        setPrd(raw);
        setEditPrd(JSON.parse(JSON.stringify(raw)));
      }
    } catch {
      setInput(userMsg);
    }

    setSending(false);
 };

 const handleSavePrd = async () => {
 if (!editPrd) return;
 setSaving(true);
 try {
 const updated = await api.patch(`/api/projects/${projectId}`, {
 structuredRequirement: { prd: editPrd },
 });
 setPrd(JSON.parse(JSON.stringify(editPrd)));
 setProject(updated);
 setEditing(false);
 } catch (e: any) {
 alert('保存失败: ' + e.message);
 }
 setSaving(false);
 };

 const handleConfirmPrd = async () => {
 // Save first if editing
 if (editing) {
 await handleSavePrd();
 }
 // Navigate to plan page (plan auto-generates from PRD on load)
 router.push(`/projects/${projectId}/plan`);
 };

 const startEditing = () => {
 if (prd) {
 setEditPrd(JSON.parse(JSON.stringify(prd)));
 }
 setEditing(true);
 };

 const cancelEditing = () => {
 setEditPrd(prd ? JSON.parse(JSON.stringify(prd)) : null);
 setEditing(false);
 };

 const updateField = (field: keyof PRD, value: any) => {
 if (!editPrd) return;
 setEditPrd({ ...editPrd, [field]: value });
 };

 const updateArrayItem = (field: keyof PRD, index: number, value: string) => {
 if (!editPrd) return;
 const arr = [...(editPrd[field] as string[])];
 arr[index] = value;
 setEditPrd({ ...editPrd, [field]: arr });
 };

 const addArrayItem = (field: keyof PRD) => {
 if (!editPrd) return;
 setEditPrd({ ...editPrd, [field]: [...(editPrd[field] as string[]), ''] });
 };

 const removeArrayItem = (field: keyof PRD, index: number) => {
 if (!editPrd) return;
 const arr = (editPrd[field] as string[]).filter((_, i) => i !== index);
 setEditPrd({ ...editPrd, [field]: arr });
 };

 const isPrdReady = project?.status === 'prd_ready';
 const isPlanReady = project?.hasPlan || project?.status === 'plan_ready' || project?.status === 'demo_generating';

 if (isLoading) return null;
 if (!project) return <div className="p-8 text-gray-500">加载中...</div>;

 // PRD Review & Edit mode
 if (isPrdReady && prd) {
 const display = editing ? editPrd! : prd;
 return (
 <div className="min-h-screen bg-gray-50">
 <NavBar projectId={projectId} projectName={project.name} />

 <div className="px-6 py-8">
 <div className="mx-auto max-w-3xl">
 <div className="mb-6 flex items-center justify-between">
 <div>
 <h1 className="font-bold text-2xl text-blue-700 font-bold">需求文档</h1>
 <p className="mt-1 text-gray-500">
 {editing ? '编辑需求文档，修改后点击保存' : '确认需求文档无误后，点击下方按钮生成方案'}
 </p>
 </div>
 {!editing && (
 <button
 onClick={startEditing}
 className="rounded-lg border border-blue-500/30 px-4 py-2 text-sm text-blue-600 transition-colors hover:bg-blue-50"
 >
 编辑文档
 </button>
 )}
 </div>

 <div className="space-y-5">
 <PrdSection title="产品名称" editing={editing}>
 {editing ? (
 <input
 value={display.productName || ''}
 onChange={(e) => updateField('productName', e.target.value)}
 className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
 />
 ) : (
 <p className="text-lg font-medium text-gray-900">{display.productName || '暂无'}</p>
 )}
 </PrdSection>

 <PrdSection title="项目简介" editing={editing}>
 {editing ? (
 <textarea
 value={display.summary || ''}
 onChange={(e) => updateField('summary', e.target.value)}
 className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
 rows={2}
 />
 ) : (
 <p className="text-gray-900">{display.summary || '暂无'}</p>
 )}
 </PrdSection>

 <PrdSection title="背景说明" editing={editing}>
 {editing ? (
 <textarea
 value={display.background || ''}
 onChange={(e) => updateField('background', e.target.value)}
 className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
 rows={3}
 />
 ) : (
 <p className="whitespace-pre-wrap text-gray-900">{display.background || '暂无'}</p>
 )}
 </PrdSection>

 <PrdSection title="目标用户" editing={editing}>
 <StringListDisplay
 values={display.targetUsers}
 editing={editing}
 field="targetUsers"
 placeholder="例：餐厅老板、前台收银员"
 updateItem={updateArrayItem}
 addItem={addArrayItem}
 removeItem={removeArrayItem}
 />
 </PrdSection>

 <PrdSection title="用户痛点" editing={editing}>
 <StringListDisplay
 values={display.userPainPoints}
 editing={editing}
 field="userPainPoints"
 placeholder="例：手工记账容易出错"
 updateItem={updateArrayItem}
 addItem={addArrayItem}
 removeItem={removeArrayItem}
 />
 </PrdSection>

 <PrdSection title="使用场景" editing={editing}>
 <StringListDisplay
 values={display.useScenarios}
 editing={editing}
 field="useScenarios"
 placeholder="例：顾客到店点餐时"
 updateItem={updateArrayItem}
 addItem={addArrayItem}
 removeItem={removeArrayItem}
 />
 </PrdSection>

 <PrdSection title="核心价值" editing={editing}>
 {editing ? (
 <textarea
 value={display.coreValue || ''}
 onChange={(e) => updateField('coreValue', e.target.value)}
 className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
 rows={2}
 />
 ) : (
 <p className="text-gray-900">{display.coreValue || '暂无'}</p>
 )}
 </PrdSection>

 <PrdSection title="产品形态" editing={editing}>
 {editing ? (
 <input
 value={display.productForm || ''}
 onChange={(e) => updateField('productForm', e.target.value)}
 className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
 placeholder="例：网页应用、小程序、手机APP"
 />
 ) : (
 <p className="text-gray-900">{display.productForm || '暂未确定'}</p>
 )}
 </PrdSection>

 <PrdSection title="MVP 功能范围" editing={editing}>
 <StringListDisplay
 values={display.mvpScope}
 editing={editing}
 field="mvpScope"
 placeholder="例：用户注册登录"
 updateItem={updateArrayItem}
 addItem={addArrayItem}
 removeItem={removeArrayItem}
 />
 </PrdSection>

 <PrdSection title="页面清单" editing={editing}>
 <StringListDisplay
 values={display.pages}
 editing={editing}
 field="pages"
 placeholder="例：登录页面"
 updateItem={updateArrayItem}
 addItem={addArrayItem}
 removeItem={removeArrayItem}
 />
 </PrdSection>

 <PrdSection title="功能清单" editing={editing}>
 <StringListDisplay
 values={display.features}
 editing={editing}
 field="features"
 placeholder="例：用户注册功能"
 updateItem={updateArrayItem}
 addItem={addArrayItem}
 removeItem={removeArrayItem}
 />
 </PrdSection>

 <PrdSection title="角色权限" editing={editing}>
 <StringListDisplay
 values={display.roles}
 editing={editing}
 field="roles"
 placeholder="例：管理员 - 系统全部功能"
 updateItem={updateArrayItem}
 addItem={addArrayItem}
 removeItem={removeArrayItem}
 />
 </PrdSection>

 <PrdSection title="数据对象" editing={editing}>
 <StringListDisplay
 values={display.dataObjects}
 editing={editing}
 field="dataObjects"
 placeholder="例：用户、订单"
 updateItem={updateArrayItem}
 addItem={addArrayItem}
 removeItem={removeArrayItem}
 />
 </PrdSection>

 <PrdSection title="成功标准" editing={editing}>
 <StringListDisplay
 values={display.successCriteria}
 editing={editing}
 field="successCriteria"
 placeholder="例：用户可以在 3 分钟内完成注册"
 updateItem={updateArrayItem}
 addItem={addArrayItem}
 removeItem={removeArrayItem}
 />
 </PrdSection>

 <PrdSection title="风险点" editing={editing}>
 <StringListDisplay
 values={display.riskPoints}
 editing={editing}
 field="riskPoints"
 placeholder="例：第三方支付接口对接复杂度"
 updateItem={updateArrayItem}
 addItem={addArrayItem}
 removeItem={removeArrayItem}
 />
 </PrdSection>
 </div>

 {/* Action buttons */}
 <div className="mt-8 flex gap-3">
 {editing ? (
 <>
 <button
 onClick={handleSavePrd}
 disabled={saving}
 className="rounded-lg bg-blue-600 px-6 py-2 text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
 >
 {saving ? '保存中...' : '保存修改'}
 </button>
 <button
 onClick={cancelEditing}
 className="rounded-lg border border-gray-200 px-6 py-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
 >
 取消
 </button>
 </>
 ) : (
 <button
 onClick={handleConfirmPrd}
 className="rounded-lg bg-emerald-500 px-6 py-3 text-white shadow-lg shadow-emerald-500/20 transition-all hover:bg-emerald-600 active:scale-[0.98]"
 >
 确认无误，生成方案
 </button>
 )}
 </div>

 {/* Back to chat link */}
 <div className="mt-4">
 <button
 onClick={() => router.push(`/projects/${projectId}?mode=chat`)}
 className="text-sm text-gray-500 transition-colors hover:text-blue-600"
 >
 ← 返回聊天
 </button>
 </div>
 </div>
 </div>
 </div>
 );
 }

 // Chat mode
 return (
 <div className="flex min-h-screen flex-col bg-gray-50">
 <NavBar projectId={projectId} projectName={project.name} />

 {/* Messages */}
 <div className="flex-1 overflow-y-auto px-6 py-6">
 <div className="mx-auto max-w-2xl space-y-4">
 {messages.length === 0 && (
 <div className="flex justify-start">
 <div className="max-w-[80%] rounded-xl border border-gray-100 bg-white px-4 py-3">
 <p className="text-sm text-gray-500">
 你好！请描述你想要做什么软件，我会帮你整理需求。
 </p>
 </div>
 </div>
 )}

 {messages.map((msg, i) => (
 <div key={msg.id || i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} `}>
 <div
 className={`max-w-[80%] rounded-xl px-4 py-3 whitespace-pre-wrap ${
 msg.role === 'user'
 ? 'bg-blue-600 text-white'
 : 'border border-gray-200 bg-gray-100 text-gray-900'
 }`}
 >
 <p className="text-sm">{msg.content}</p>
 </div>
 </div>
 ))}

 {sending && (
 <div className="flex justify-start">
 <div className=" rounded-xl border border-gray-100 bg-white px-4 py-3">
 <p className="text-sm text-gray-500">平台正在思考...</p>
 </div>
 </div>
 )}

 {isPlanReady && !isPrdReady && (
 <div className="flex justify-center">
 <Link
 href={`/projects/${projectId}/plan`}
 className="rounded-lg bg-emerald-500 px-6 py-3 text-white shadow-lg shadow-emerald-500/20 transition-all hover:bg-emerald-600 active:scale-[0.98]"
 >
 查看方案
 </Link>
 </div>
 )}

 <div ref={messagesEndRef} />
 </div>
 </div>

 {/* Input */}
 <div className="border-t border-gray-100 bg-white px-6 py-4">
 <div className="mx-auto flex max-w-2xl gap-2">
 <input
 type="text"
 value={input}
 onChange={(e) => setInput(e.target.value)}
 onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
 placeholder={isPlanReady ? '需求已收集完成，可继续补充' : '描述你的需求...'}
 className="flex-1 rounded-lg border border-gray-200 bg-white px-4 py-2 text-gray-900 placeholder-gray-400 transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
 disabled={sending}
 />
 <button
 onClick={handleSend}
 disabled={sending || !input.trim()}
 className="rounded-lg bg-blue-600 px-4 py-2 text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
 >
 发送
 </button>
 </div>
 </div>
 </div>
 );
}

/* PRD Section wrapper */
function PrdSection({ title, editing, children }: { title: string; editing: boolean; children: React.ReactNode }) {
 return (
 <section className={`rounded-xl border border-gray-200 bg-white p-6 transition-shadow ${editing ? 'ring-1 ring-blue-500/20' : ''}`}>
 <h2 className="mb-3 text-base font-semibold text-gray-900">{title}</h2>
 {children}
 </section>
 );
}

/* Reusable string list display/editor */
function StringListDisplay({
 values,
 editing,
 field,
 placeholder,
 updateItem,
 addItem,
 removeItem,
}: {
 values: string[];
 editing: boolean;
 field: keyof PRD;
 placeholder: string;
 updateItem: (field: keyof PRD, index: number, value: string) => void;
 addItem: (field: keyof PRD) => void;
 removeItem: (field: keyof PRD, index: number) => void;
}) {
 if (editing) {
 return (
 <div className="space-y-2">
 {(values && values.length > 0 ? values : ['']).map((item, i) => (
 <div key={i} className="flex gap-2">
 <input
 value={item}
 onChange={(e) => updateItem(field, i, e.target.value)}
 className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
 placeholder={placeholder}
 />
 <button onClick={() => removeItem(field, i)} className="px-2 text-gray-500 transition-colors hover:text-red-400">✕</button>
 </div>
 ))}
 <button onClick={() => addItem(field)} className="text-sm text-blue-600 transition-colors hover:text-blue-500">+ 添加</button>
 </div>
 );
 }
 if (!values || values.length === 0) return <p className="text-gray-500">暂无</p>;
 return (
 <ul className="list-inside list-disc space-y-1 text-gray-900">
 {values.map((item, i) => (
 <li key={i}>{item}</li>
 ))}
 </ul>
 );
}
