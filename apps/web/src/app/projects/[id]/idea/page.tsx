'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import NavBar from '@/lib/nav-bar';

interface InterviewData {
  stage: string;
  stageLabel: string;
  questionIndex: number;
  question?: string;
  questionNumber?: number;
  totalInStage?: number;
  progress: number;
  totalStages: number;
  stageIndex: number;
  done?: boolean;
  message?: string;
  answersCount?: number;
  answers?: { question: string; answer: string }[];
}

const STAGE_ICONS: Record<string, string> = {
  capture: '💡', philosophy: '🧠', user: '👤', flow: '🔄',
  scope: '🎯', ux: '🎨', data: '🗄️', platform: '📱',
  technical: '⚙️', quality: '✅',
};

export default function IdeaPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;
  const { token, isLoading } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);

  const [data, setData] = useState<InterviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [answer, setAnswer] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState('');

  const fetchState = async () => {
    if (!token || isLoading) { setLoading(false); return; }
    try {
      const d = await api.get(`/api/projects/${projectId}/idea`);
      setData(d);
    } catch { setFeedback('加载失败'); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchState(); }, [token, isLoading, projectId]);
  useEffect(() => { inputRef.current?.focus(); }, [data?.question]);

  const handleSubmit = async () => {
    if (!answer.trim() || submitting) return;
    setSubmitting(true);
    try {
      const result = await api.post(`/api/projects/${projectId}/idea/answer`, { answer: answer.trim() });
      setData((prev) => prev ? { ...prev, ...result } : result);
      setAnswer('');
      if (result.done) {
        setFeedback(result.message || '完成！');
      }
    } catch (e: any) {
      setFeedback(e?.message || '提交失败');
    } finally {
      setSubmitting(false);
      inputRef.current?.focus();
    }
  };

  const handleSkip = async () => {
    setAnswer('跳过');
    // Submit empty answer
    setSubmitting(true);
    try {
      const result = await api.post(`/api/projects/${projectId}/idea/answer`, { answer: '跳过' });
      setData((prev) => prev ? { ...prev, ...result } : result);
      setAnswer('');
    } catch (e: any) {
      setFeedback(e?.message || '跳过失败');
    } finally {
      setSubmitting(false);
      inputRef.current?.focus();
    }
  };

  if (isLoading || loading) {
    return <div className="min-h-screen bg-gray-50"><NavBar /><div className="p-8 text-gray-500">加载中...</div></div>;
  }

  if (data?.done) {
    return (
      <div className="min-h-screen bg-gray-50">
        <NavBar />
        <div className="max-w-2xl mx-auto px-4 py-16 text-center">
          <div className="text-6xl mb-4">🎉</div>
          <h1 className="text-2xl font-bold text-gray-900 mb-4">需求访谈完成！</h1>
          <p className="text-gray-600 mb-2">你回答了 {data.answersCount} 个问题</p>
          <p className="text-gray-500 mb-8">平台已自动生成结构化需求文档，可以继续后面的流程了。</p>
          <div className="flex gap-3 justify-center">
            <button onClick={() => router.push(`/projects/${projectId}/plan`)}
              className="px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium">
              查看方案 →
            </button>
            <button onClick={() => router.push(`/projects/${projectId}/spec`)}
              className="px-6 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium">
              生成规格 →
            </button>
          </div>
        </div>
      </div>
    );
  }

  const stageIcon = STAGE_ICONS[data?.stage || ''] || '💬';

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar />
      <div className="max-w-2xl mx-auto px-4 py-8">
        {/* Progress */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-600">
              {stageIcon} {data?.stageLabel}
            </span>
            <span className="text-xs text-gray-400">
              阶段 {((data?.stageIndex ?? 0) + 1)}/{data?.totalStages}
            </span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div className="bg-blue-600 h-2 rounded-full transition-all duration-500"
              style={{ width: `${data?.progress || 0}%` }} />
          </div>
        </div>

        {/* Question */}
        {data?.question && (
          <div className="bg-white rounded-2xl border border-gray-200 p-8 shadow-sm mb-6">
            <div className="flex items-center gap-2 mb-6">
              <span className="text-3xl">{stageIcon}</span>
              <span className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded-full">
                {data.questionNumber}/{data.totalInStage}
              </span>
            </div>
            <h2 className="text-xl font-semibold text-gray-900 mb-8 leading-relaxed">
              {data.question}
            </h2>

            {/* Input */}
            <div className="flex gap-3">
              <input
                ref={inputRef}
                type="text"
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
                placeholder="输入你的回答..."
                className="flex-1 px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                disabled={submitting}
              />
              <button
                onClick={handleSubmit}
                disabled={submitting || !answer.trim()}
                className="px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-40 font-medium text-sm transition-colors"
              >
                {submitting ? '...' : '→'}
              </button>
            </div>

            <button
              onClick={handleSkip}
              disabled={submitting}
              className="mt-3 text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >
              跳过这个问题 →
            </button>
          </div>
        )}

        {/* Previous answers */}
        {data?.answers && data.answers.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">已回答</h3>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {data.answers.slice(-5).reverse().map((a, i) => (
                <div key={i} className="text-sm">
                  <span className="text-gray-400">{a.question.slice(0, 40)}...</span>
                  <span className="text-gray-700 ml-2">{a.answer.slice(0, 60)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {feedback && (
          <div className="mt-4 text-sm text-center text-gray-500">{feedback}</div>
        )}
      </div>
    </div>
  );
}
