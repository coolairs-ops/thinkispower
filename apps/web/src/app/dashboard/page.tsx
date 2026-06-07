'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

interface Project {
  id: string;
  name: string;
  appType: string | null;
  status: string;
  createdAt: string;
}

function SkeletonCard() {
  return (
    <div className="animate-pulse rounded-xl border border-gray-200 bg-white p-5">
      <div className="mb-3 h-5 w-3/4 rounded bg-gray-200" />
      <div className="mb-2 h-4 w-1/3 rounded bg-gray-200" />
      <div className="mb-2 h-3 w-1/2 rounded bg-gray-100" />
      <div className="h-3 w-1/4 rounded bg-gray-100" />
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const { token, isLoading } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const handleDelete = async (e: React.MouseEvent, projectId: string, projectName: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`确定删除项目"${projectName}"？此操作不可撤销。`)) return;
    setDeleting(projectId);
    try {
      await api.delete(`/api/projects/${projectId}`);
      setProjects(prev => prev.filter(p => p.id !== projectId));
    } catch {
      alert('删除失败');
    }
    setDeleting(null);
  };

  useEffect(() => {
    if (isLoading) return;
    if (!token) { router.push('/'); return; }

    api.get('/api/projects')
      .then((data) => {
        setProjects(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [token, isLoading, router]);

  if (isLoading) return null;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4">
        <h1 className="text-lg font-bold text-gray-900">
          思想动力
        </h1>
        <Link
          href="/projects/new"
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white transition-colors hover:bg-blue-700"
        >
          创建项目
        </Link>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        <h2 className="mb-6 text-xl font-semibold text-gray-800">
          我的项目
        </h2>

        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => <SkeletonCard key={i} />)}
          </div>
        ) : projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 p-16">
            <svg className="mb-4 h-12 w-12 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m6.75 12H9m1.5-12H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
            <p className="mb-4 text-gray-500">还没有项目</p>
            <Link
              href="/projects/new"
              className="text-blue-600 transition-colors hover:text-blue-500"
            >
              创建你的第一个项目
            </Link>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => (
              <div
                key={project.id}
                onClick={() => router.push(`/projects/${project.id}`)}
                className="group relative cursor-pointer rounded-xl border border-gray-200 bg-white p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md"
              >
                <button
                  onClick={(e) => handleDelete(e, project.id, project.name)}
                  disabled={deleting === project.id}
                  className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full text-gray-500 opacity-0 transition-all hover:bg-blue-600/20 hover:text-blue-600 group-hover:opacity-100 disabled:opacity-50"
                  title="删除项目"
                >
                  {deleting === project.id ? '...' : '×'}
                </button>
                <h3 className="mb-2 pr-6 font-medium text-gray-900">{project.name}</h3>
                {project.appType && (
                  <span className="mb-2 inline-block rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-600">
                    {project.appType}
                  </span>
                )}
                <p className="text-sm text-gray-500">{project.status}</p>
                <p className="mt-2 text-xs text-gray-400">
                  {new Date(project.createdAt).toLocaleDateString('zh-CN')}
                </p>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
