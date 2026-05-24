import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '一句话做软件平台',
  description: '你说想法，平台帮你整理需求、生成预览、自动开发、支持点选修改，并交付可使用的软件。',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
