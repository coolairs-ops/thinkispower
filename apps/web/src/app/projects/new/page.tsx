'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

export default function NewProjectPage() {
  const router = useRouter();
  const { token, isLoading } = useAuth();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (isLoading) return null;
  if (!token) { router.push('/'); return null; }

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    setFiles((prev) => [...prev, ...Array.from(list)]);
  };

  const removeFile = (idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const project = await api.post('/api/projects', { name, description });

      // 无附加资料 → 走描述路径
      if (files.length === 0) {
        router.push(`/projects/${project.id}`);
        return;
      }

      // 有资料 → 建导入批次、逐个上传，进入分步向导
      const batch = await api.post('/api/import/batches', { name, projectId: project.id });
      for (const f of files) {
        const fd = new FormData();
        fd.append('file', f);
        await api.upload(`/api/import/batches/${batch.id}/files`, fd);
      }
      router.push(`/import/${batch.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交失败，请重试');
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 px-6 py-12">
      <div
        className="pointer-events-none fixed inset-0 opacity-20"
        style={{ backgroundImage: `radial-gradient(circle at 50% 0%, rgba(217, 119, 6, 0.08) 0%, transparent 50%)` }}
      />

      <div className="relative mx-auto max-w-lg">
        <h1 className="mb-2 font-bold text-2xl text-blue-700">创建项目</h1>
        <p className="mb-6 text-sm text-gray-500">描述你的想法，也可以附上已有的资料——资料越多，理解越准。</p>

        <form onSubmit={handleSubmit} className="space-y-5 rounded-2xl border border-gray-200 bg-white p-8">
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

          {/* 附加资料(可选) */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-900">
              附加资料 <span className="font-normal text-gray-400">（可选：需求文档、原型导出、表格、截图…）</span>
            </label>
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
              className="flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-center transition-colors hover:border-blue-400 hover:bg-blue-50/30"
            >
              <svg className="mb-2 h-8 w-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
              <p className="text-sm text-gray-500">点击选择，或拖拽文件到此</p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
            />

            {files.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {files.map((f, i) => (
                  <li key={i} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-sm">
                    <span className="truncate text-gray-700">{f.name}</span>
                    <button
                      type="button"
                      onClick={() => removeFile(i)}
                      className="ml-2 shrink-0 text-gray-400 transition-colors hover:text-red-500"
                      title="移除"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-white transition-all duration-200 hover:bg-blue-700 hover:shadow-md active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? (files.length > 0 ? '正在上传资料…' : '正在创建…') : (files.length > 0 ? '创建并理解资料' : '创建并开始')}
          </button>
        </form>
      </div>
    </div>
  );
}
