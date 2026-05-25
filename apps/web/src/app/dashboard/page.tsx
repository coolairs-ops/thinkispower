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

export default function DashboardPage() {
  const router = useRouter();
  const { token, isLoading } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

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

  if (isLoading || loading) return <div className="p-8 text-gray-500">加载中...</div>;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b bg-white px-6 py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <h1 className="text-lg font-bold text-gray-900">一句话做软件平台</h1>
          <Link
            href="/projects/new"
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 transition-colors"
          >
            创建项目
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">
        <h2 className="mb-6 text-xl font-semibold text-gray-800">我的项目</h2>

        {projects.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed border-gray-300 p-12 text-center">
            <p className="mb-4 text-gray-500">还没有项目</p>
            <Link
              href="/projects/new"
              className="text-blue-600 hover:underline"
            >
              创建你的第一个项目
            </Link>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => (
              <Link
                key={project.id}
                href={`/projects/${project.id}`}
                className="rounded-xl border bg-white p-5 hover:shadow-md transition-shadow"
              >
                <h3 className="mb-2 font-medium text-gray-900">{project.name}</h3>
                {project.appType && (
                  <span className="mb-2 inline-block rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700">
                    {project.appType}
                  </span>
                )}
                <p className="text-sm text-gray-500">{project.status}</p>
                <p className="mt-2 text-xs text-gray-400">
                  {new Date(project.createdAt).toLocaleDateString('zh-CN')}
                </p>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
