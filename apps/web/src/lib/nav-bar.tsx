'use client';

import Link from 'next/link';
import { useAuth } from './auth-context';

interface NavBarProps {
  projectId?: string;
  projectName?: string;
}

export default function NavBar({ projectId, projectName }: NavBarProps) {
  const { user, logout } = useAuth();

  return (
    <header className="flex items-center justify-between border-b bg-white px-6 py-3">
      <div className="flex items-center gap-4">
        <Link href="/dashboard" className="text-lg font-bold text-gray-900 hover:text-blue-600 transition-colors">
          一句话做软件平台
        </Link>
        {projectName && (
          <>
            <span className="text-gray-300">/</span>
            <span className="text-sm text-gray-500">{projectName}</span>
          </>
        )}
      </div>
      <div className="flex items-center gap-3">
        {projectId && (
          <>
            <Link
              href={`/projects/${projectId}/demo`}
              className="text-sm text-gray-600 hover:text-blue-600 transition-colors"
            >
              预览
            </Link>
            <Link
              href={`/projects/${projectId}/snapshots`}
              className="text-sm text-gray-600 hover:text-blue-600 transition-colors"
            >
              版本
            </Link>
            <Link
              href={`/projects/${projectId}/delivery`}
              className="text-sm text-gray-600 hover:text-blue-600 transition-colors"
            >
              交付
            </Link>
          </>
        )}
        {user && (
          <span className="text-sm text-gray-400">{user.name?.trim() || user.email}</span>
        )}
        <button
          onClick={logout}
          className="rounded-lg border border-gray-300 px-3 py-1 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
        >
          退出
        </button>
      </div>
    </header>
  );
}
