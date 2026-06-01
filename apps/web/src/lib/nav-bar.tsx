'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from './auth-context';

interface NavBarProps {
  projectId?: string;
  projectName?: string;
}

const links = [
  { href: '/spec', label: '规格' },
  { href: '/estimate', label: '预测' },
  { href: '/demo', label: '预览' },
  { href: '/deploy', label: '测试环境' },
  { href: '/snapshots', label: '版本' },
  { href: '/evaluation', label: '项目评估' },
  { href: '/handoff', label: '开发包' },
  { href: '/delivery', label: '终稿交付' },
];

export default function NavBar({ projectId, projectName }: NavBarProps) {
  const { user, logout } = useAuth();
  const pathname = usePathname();

  const isActive = (href: string) => pathname?.endsWith(href);

  return (
    <header className="sticky top-0 z-50 flex items-center justify-between border-b border-gray-200 bg-white px-6 py-3">
      <div className="flex items-center gap-4">
        <Link
          href="/dashboard"
          className="font-bold text-lg text-blue-600 hover:text-blue-500 transition-colors"
        >
          思想动力
        </Link>
        {projectName && (
          <>
            <span className="text-gray-500">/</span>
            <span className="text-sm text-gray-500">{projectName}</span>
          </>
        )}
      </div>
      <div className="flex items-center gap-3">
        {projectId && links.map(({ href, label }) => (
          <Link
            key={href}
            href={`/projects/${projectId}${href}`}
            className={`relative text-sm transition-colors after:absolute after:-bottom-1 after:left-0 after:h-[2px] after:w-full after:origin-left after:scale-x-0 after:bg-blue-500 after:transition-transform after:duration-200 hover:after:scale-x-100 ${
              isActive(href)
                ? 'text-blue-600 after:scale-x-100'
                : 'text-gray-500 hover:text-blue-600'
            }`}
          >
            {label}
          </Link>
        ))}
        {user && (
          <span className="text-sm text-gray-500">{user.name?.trim() || user.email}</span>
        )}
        <button
          onClick={logout}
          className="rounded-lg border border-gray-200 px-3 py-1 text-sm text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
        >
          退出
        </button>
      </div>
    </header>
  );
}
