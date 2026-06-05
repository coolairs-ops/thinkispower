'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import NavBar from '@/lib/nav-bar';

type Mode = 'preview' | 'annotation';
interface ClickedElement { moduleKey: string; elementPath: string; }

interface FeedbackItem {
  id: string;
  moduleKey: string | null;
  elementPath: string | null;
  pageUrl: string | null;
  comment: string;
  status: string;
  createdAt: string;
}

export default function DemoPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;
  const { token, isLoading } = useAuth();

  const [demoHtml, setDemoHtml] = useState<string | null>(null);
  const [demoUrl, setDemoUrl] = useState<string | null>(null);
  const [projectName, setProjectName] = useState('');
  const [status, setStatus] = useState('loading');
  const [publicStatusLabel, setPublicStatusLabel] = useState('');
  const [feedbacks, setFeedbacks] = useState<FeedbackItem[]>([]);
  const [mode, setMode] = useState<Mode>('preview');
  const [clickedElement, setClickedElement] = useState<ClickedElement | null>(null);
  const [feedbackComment, setFeedbackComment] = useState('');
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    if (isLoading) return;
    if (!token) { router.push('/'); return; }

    Promise.all([
      api.get(`/api/projects/${projectId}/demo`),
      api.get(`/api/projects/${projectId}`),
      api.get(`/api/projects/${projectId}/feedback`),
    ])
      .then(([demo, proj, fbs]) => {
        setDemoHtml(demo.html || null);
        setDemoUrl(demo.demoUrl || null);
        setStatus(demo.status || 'loading');
        setPublicStatusLabel(demo.publicStatusLabel || '');
        setProjectName(proj.name || '');
        setFeedbacks(Array.isArray(fbs) ? fbs : []);
      })
      .catch(() => {});
  }, [projectId, token, isLoading, router]);

  // Poll while generating
  useEffect(() => {
    if (status === 'demo_generating') {
      pollingRef.current = setInterval(() => {
        api.get(`/api/projects/${projectId}/demo`).then((data) => {
          setDemoHtml(data.html || null);
          setDemoUrl(data.demoUrl || null);
          setStatus(data.status || 'loading');
          setPublicStatusLabel(data.publicStatusLabel || '');
        });
        api.get(`/api/projects/${projectId}/feedback`).then((fbs) => {
          setFeedbacks(Array.isArray(fbs) ? fbs : []);
        });
      }, 3000);
      return () => {
        if (pollingRef.current) clearInterval(pollingRef.current);
      };
    }
  }, [status, projectId]);

  // Listen for iframe element-click messages
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (event.data?.type === 'element-click' && event.data?.moduleKey) {
        if (mode !== 'annotation') return;
        setClickedElement({
          moduleKey: event.data.moduleKey,
          elementPath: event.data.elementPath || '',
        });
        setFeedbackComment('');
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [mode]);

  // Send highlight/clear commands to iframe
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;

    if (clickedElement && mode === 'annotation') {
      iframe.contentWindow.postMessage({
        type: 'highlight-element',
        moduleKey: clickedElement.moduleKey,
        elementPath: clickedElement.elementPath,
      }, '*');
    } else {
      iframe.contentWindow.postMessage({ type: 'clear-highlight' }, '*');
    }
  }, [clickedElement, mode]);

  const handleGenerate = async () => {
    setStatus('demo_generating');
    setPublicStatusLabel('正在生成预览');
    setClickedElement(null);
    await api.post(`/api/projects/${projectId}/demo/generate`);
  };

  const handleSubmitFeedback = async () => {
    if (!feedbackComment.trim() || !clickedElement) return;

    await api.post(`/api/projects/${projectId}/feedback`, {
      moduleKey: clickedElement.moduleKey,
      elementPath: clickedElement.elementPath,
      pageUrl: demoUrl || '',
      comment: feedbackComment,
    });

    setClickedElement(null);
    setFeedbackComment('');
    api.get(`/api/projects/${projectId}/feedback`).then((fbs) => {
      setFeedbacks(Array.isArray(fbs) ? fbs : []);
    });
  };

  const handleClearSelection = () => {
    setClickedElement(null);
    setFeedbackComment('');
  };

  const showPreview = status === 'demo_ready' || status === 'awaiting_demo_feedback' || status === 'completed' || status === 'developing' || status === 'demo_failed';
  const showGenerateButton = status === 'prd_ready' || status === 'plan_ready' || status === 'spec_confirmed' || status === 'demo_ready' || status === 'demo_generating' || status === 'awaiting_demo_feedback' || status === 'completed' || status === 'developing' || status === 'demo_failed';

  if (isLoading) return null;

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <NavBar projectId={projectId} projectName={projectName} />

      <div className="flex items-center justify-between border-b bg-white px-6 py-2">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-bold text-gray-900">预览</h1>
          <ModeToggle mode={mode} onChange={setMode} />
        </div>
        <div className="flex items-center gap-3">
          {publicStatusLabel && (
            <span className="text-sm text-gray-500">{publicStatusLabel}</span>
          )}
          {showGenerateButton && (
            <button
              onClick={handleGenerate}
              className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700 transition-colors"
            >
              生成预览
            </button>
          )}
          {showPreview && (
            <>
              <a
                href={`/projects/${projectId}/snapshots`}
                className="rounded-lg border border-gray-300 px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
              >
                历史版本
              </a>
              <a
                href={`/projects/${projectId}/evaluation`}
                className="rounded-lg bg-green-600 px-4 py-2 text-sm text-white hover:bg-green-700 transition-colors"
              >
                项目评估
              </a>
            </>
          )}
          {mode === 'annotation' && showPreview && demoHtml && (
            <p className="text-sm text-orange-500">点击页面中想修改的位置，写下意见</p>
          )}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Preview area */}
        <div className="flex-1 p-4">
          {status === 'demo_generating' ? (
            <div className="flex h-full items-center justify-center rounded-xl border-2 border-dashed">
              <div className="text-center">
                <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
                <p className="text-gray-500">AI 正在生成预览...</p>
                <p className="mt-1 text-xs text-gray-400">根据方案内容生成，约需 30-60 秒</p>
              </div>
            </div>
          ) : showPreview && demoHtml ? (
            <div className="relative h-full">
            <iframe
              ref={iframeRef}
              srcDoc={demoHtml}
              className="h-full w-full rounded-xl border bg-white"
              title="预览"
              sandbox="allow-scripts allow-same-origin"
            />
            {/* 反馈浮窗 */}
            <button
              onClick={() => setMode('annotation')}
              className="absolute bottom-3 right-3 px-3 py-1.5 bg-white border border-gray-300 rounded-full shadow-lg text-xs text-gray-600 hover:bg-gray-50 hover:border-gray-400 transition-all"
              title="这里有问题？点击反馈"
            >
              💬 这里有问题？
            </button>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center rounded-xl border-2 border-dashed">
              <div className="text-center">
                <p className="text-gray-400">预览尚未生成</p>
                <p className="mt-1 text-xs text-gray-300">确认方案后可点击"生成预览"按钮</p>
              </div>
            </div>
          )}
        </div>

        {/* Sidebar — only in annotation mode */}
        {mode === 'annotation' && showPreview && demoHtml && (
          <aside className="w-80 border-l bg-white p-4 overflow-y-auto flex flex-col gap-4">
            {clickedElement ? (
              <div className="rounded-xl bg-white border border-blue-200 p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div className="text-sm text-gray-500">
                    位置：
                    <span className="font-medium text-gray-700">{clickedElement.moduleKey}</span>
                    {clickedElement.elementPath && (
                      <> &gt; <span className="font-medium text-gray-700">{clickedElement.elementPath}</span></>
                    )}
                  </div>
                  <button
                    onClick={handleClearSelection}
                    className="text-gray-400 hover:text-gray-600 text-sm leading-none"
                  >
                    ✕
                  </button>
                </div>
                <textarea
                  value={feedbackComment}
                  onChange={(e) => setFeedbackComment(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  rows={3}
                  placeholder="例如：这里增加一个导出按钮"
                />
                <button
                  onClick={handleSubmitFeedback}
                  disabled={!feedbackComment.trim()}
                  className="w-full rounded-lg bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 transition-colors disabled:bg-gray-300"
                >
                  提交意见
                </button>
              </div>
            ) : (
              <div className="rounded-lg bg-blue-50 p-3 text-sm text-blue-700">
                点击页面中的元素开始批注
              </div>
            )}

            <hr className="border-gray-200" />

            <div>
              <h2 className="mb-3 text-sm font-semibold text-gray-800">
                历史意见
                {feedbacks.length > 0 && (
                  <span className="ml-1 text-gray-400 font-normal">({feedbacks.length})</span>
                )}
              </h2>
              {feedbacks.length === 0 ? (
                <p className="text-sm text-gray-400">暂无修改意见</p>
              ) : (
                <div className="space-y-2">
                  {feedbacks.map((fb, i) => (
                    <div key={fb.id || i} className="rounded-lg bg-gray-50 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm text-gray-700 flex-1">{fb.comment}</p>
                        <StatusBadge status={fb.status} />
                      </div>
                      {(fb.moduleKey || fb.elementPath) && (
                        <p className="mt-1 text-xs text-gray-400">
                          {fb.moduleKey}{fb.elementPath ? ` > ${fb.elementPath}` : ''}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  return (
    <div className="flex rounded-lg border border-gray-300 overflow-hidden">
      <button
        onClick={() => onChange('preview')}
        className={`px-4 py-1.5 text-sm transition-colors ${
          mode === 'preview'
            ? 'bg-blue-600 text-white'
            : 'bg-white text-gray-700 hover:bg-gray-50'
        }`}
      >
        预览
      </button>
      <button
        onClick={() => onChange('annotation')}
        className={`px-4 py-1.5 text-sm transition-colors ${
          mode === 'annotation'
            ? 'bg-blue-600 text-white'
            : 'bg-white text-gray-700 hover:bg-gray-50'
        }`}
      >
        批注
      </button>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; className: string }> = {
    new:        { label: '待处理', className: 'bg-gray-100 text-gray-600' },
    processing: { label: '处理中', className: 'bg-yellow-100 text-yellow-700' },
    resolved:   { label: '已处理', className: 'bg-green-100 text-green-700' },
  };
  const c = config[status] || { label: status, className: 'bg-gray-100 text-gray-600' };
  return (
    <span className={`shrink-0 text-xs px-1.5 py-0.5 rounded ${c.className}`}>
      {c.label}
    </span>
  );
}
