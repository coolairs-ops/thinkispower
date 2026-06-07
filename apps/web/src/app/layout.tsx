import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '@/lib/auth-context';
import { ToastProvider } from '@/lib/toast';

export const metadata: Metadata = {
  title: '思想动力',
  description: '思想动力 —— 不辜负你的每个想法。AI 驱动的软件生成与交付平台，帮你整理需求、生成预览、自动开发、交付可使用的软件。',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <style>{`
          input:-webkit-autofill,
          input:-webkit-autofill:hover,
          input:-webkit-autofill:focus,
          input:-webkit-autofill:active {
            -webkit-background-clip: text !important;
            -webkit-text-fill-color: #1a1a2e !important;
            box-shadow: inset 0 0 0 1000px #ffffff !important;
            caret-color: #1a1a2e !important;
          }
        `}</style>
      </head>
      <body className="min-h-screen antialiased">
        <AuthProvider>
          <ToastProvider>
            {children}
          </ToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
