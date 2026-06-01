'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

export default function NewProjectPage() {
 const router = useRouter();
 const { token, isLoading } = useAuth();
 const [name, setName] = useState('');
 const [description, setDescription] = useState('');

 if (isLoading) return null;
 if (!token) { router.push('/'); return null; }

 const handleSubmit = async (e: React.FormEvent) => {
 e.preventDefault();
 const project = await api.post('/api/projects', { name, description });
 router.push(`/projects/${project.id}`);
 };

 return (
 <div className="min-h-screen bg-gray-50 px-6 py-12">
 {/* Geometric decoration */}
 <div
 className="pointer-events-none fixed inset-0 opacity-20"
 style={{
 backgroundImage: `radial-gradient(circle at 50% 0%, rgba(217, 119, 6, 0.08) 0%, transparent 50%)`,
 }}
 />

 <div className="relative mx-auto max-w-lg">
 <h1 className="mb-6 font-bold text-2xl text-blue-700 font-bold">
 创建项目
 </h1>

 <form onSubmit={handleSubmit} className=" space-y-5 rounded-2xl border border-gray-200 bg-white p-8">
 <div>
 <label className="mb-1.5 block text-sm font-medium text-gray-900">项目名称</label>
 <input
 type="text"
 value={name}
 onChange={(e) => setName(e.target.value)}
 className="w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-gray-900 placeholder-gray-400 transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
 placeholder="例如：客户管理系统"
 required
 />
 </div>

 <div>
 <label className="mb-1.5 block text-sm font-medium text-gray-900">一句话描述你的想法</label>
 <textarea
 value={description}
 onChange={(e) => setDescription(e.target.value)}
 className="w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-gray-900 placeholder-gray-400 transition-colors focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
 rows={4}
 placeholder="例如：我想做一个客户管理系统，可以记录客户信息、跟进记录，最好还能看到销售统计。"
 />
 </div>

 <button
 type="submit"
 className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-gray-900 transition-all duration-200 hover:bg-blue-700 hover:shadow-md active:scale-[0.98]"
 >
 创建并开始
 </button>
 </form>
 </div>
 </div>
 );
}
