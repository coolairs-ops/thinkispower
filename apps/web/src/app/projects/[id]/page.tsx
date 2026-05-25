'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';

interface Message {
  id: string;
  role: string;
  content: string;
  createdAt: string;
}

export default function ProjectChatPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;

  const [project, setProject] = useState<any>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const loadProject = async () => {
    const token = localStorage.getItem('token');
    if (!token) { router.push('/'); return; }
    const res = await fetch(`/api/projects/${projectId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) setProject(await res.json());
    else router.push('/dashboard');
  };

  const loadMessages = async () => {
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/projects/${projectId}/messages`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      setMessages(Array.isArray(data) ? data : []);
    }
  };

  useEffect(() => {
    loadProject();
    loadMessages();
  }, [projectId, router]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || sending) return;
    setSending(true);

    const token = localStorage.getItem('token');
    const userMsg = input;
    setInput('');

    // Optimistically add user message
    setMessages((prev) => [...prev, { id: 'temp', role: 'user', content: userMsg, createdAt: new Date().toISOString() }]);

    const res = await fetch(`/api/projects/${projectId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ content: userMsg }),
    });

    if (res.ok) {
      const data = await res.json();
      // Replace all messages with server response (removes temp message)
      setMessages(data.messages || []);
      // Reload project to get updated status
      loadProject();
    }

    setSending(false);
  };

  const isPlanReady = project?.hasPlan || project?.status === 'plan_ready';

  if (!project) return <div className="p-8 text-gray-500">加载中...</div>;

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      {/* Header */}
      <header className="flex items-center justify-between border-b bg-white px-6 py-3">
        <div>
          <Link href="/dashboard" className="text-sm text-blue-600 hover:underline">← 返回项目列表</Link>
          <h1 className="text-lg font-bold text-gray-900">{project.name}</h1>
          <p className="text-xs text-gray-400">{project.statusText || project.status}</p>
        </div>
        <div className="flex gap-2">
          {isPlanReady && (
            <Link
              href={`/projects/${projectId}/plan`}
              className="rounded-lg bg-green-600 px-4 py-2 text-sm text-white hover:bg-green-700 animate-pulse"
            >
              查看方案 →
            </Link>
          )}
          <Link
            href={`/projects/${projectId}/delivery`}
            className="rounded-lg border px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          >
            交付
          </Link>
        </div>
      </header>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-2xl space-y-4">
          {/* Welcome message */}
          {messages.length === 0 && (
            <div className="flex justify-start">
              <div className="max-w-[80%] rounded-xl bg-white border px-4 py-3">
                <p className="text-sm text-gray-700">
                  你好！请描述你想要做什么软件，我会帮你整理需求。
                </p>
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={msg.id || i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[80%] rounded-xl px-4 py-3 whitespace-pre-wrap ${
                  msg.role === 'user'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white border text-gray-800'
                }`}
              >
                <p className="text-sm">{msg.content}</p>
              </div>
            </div>
          ))}

          {sending && (
            <div className="flex justify-start">
              <div className="rounded-xl bg-white border px-4 py-3">
                <p className="text-sm text-gray-500">平台正在思考...</p>
              </div>
            </div>
          )}

          {/* Plan ready prompt */}
          {isPlanReady && (
            <div className="flex justify-center">
              <Link
                href={`/projects/${projectId}/plan`}
                className="rounded-lg bg-green-600 px-6 py-3 text-white hover:bg-green-700 transition-colors shadow-md"
              >
                📋 需求已收集完成，查看方案
              </Link>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <div className="border-t bg-white px-6 py-4">
        <div className="mx-auto flex max-w-2xl gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
            placeholder={isPlanReady ? '需求已收集完成，可查看方案或继续补充' : '描述你的需求...'}
            className="flex-1 rounded-lg border border-gray-300 px-4 py-2 focus:border-blue-500 focus:outline-none"
            disabled={sending}
          />
          <button
            onClick={handleSend}
            disabled={sending || !input.trim()}
            className="rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 transition-colors disabled:bg-gray-300"
          >
            发送
          </button>
        </div>
      </div>
    </div>
  );
}
