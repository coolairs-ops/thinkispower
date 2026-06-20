'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

/** 追加问答窗口：D 的 ask 缺口 + 关系 ask 候选合批，一窗答完（消费 .../requirement/followup）。 */
interface Question {
  id: string;
  group: 'requirement' | 'relation';
  kind: string;
  title: string;
  question: string;
  options: { label: string; value: string }[];
  missing?: string;
  relationKey?: string;
}

// 否定型答案 → 不采纳该需求缺口
const NEGATIVE = /不需要|不用|没有|都不|不做|暂不|没关系|^否/;

function groupBy<T>(arr: T[], key: (t: T) => string): Record<string, T[]> {
  return arr.reduce<Record<string, T[]>>((acc, x) => ((acc[key(x)] = acc[key(x)] || []).push(x), acc), {});
}

export default function FollowUpQuestions({
  projectId,
  enabled = true,
  refreshKey = 0,
  onDone,
}: {
  projectId: string;
  enabled?: boolean; // 仅在「设计已采纳」后开启（关系据已采纳设计推，顺序：设计→关系）
  refreshKey?: number; // 检测完成后 +1 触发重取
  onDone?: () => void;
}) {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId || !enabled) return;
    setLoading(true);
    api
      .get(`/api/projects/${projectId}/requirement/followup`)
      .then((r: any) => setQuestions(r?.questions || []))
      .catch(() => setQuestions([]))
      .finally(() => setLoading(false));
  }, [projectId, enabled, refreshKey]);

  // 未开启 / 加载中 / 无 ask 项 → 不渲染（设计：设计采纳后、检测到模糊的才出现）
  if (!enabled || loading || questions.length === 0) return null;

  const reqQs = questions.filter((q) => q.group === 'requirement');
  const relGroups = groupBy(
    questions.filter((q) => q.group === 'relation'),
    (q) => q.relationKey || q.title,
  );
  const pick = (id: string, value: string) => {
    setAnswers((a) => ({ ...a, [id]: value }));
    setDone(null);
  };

  const submit = async () => {
    setSubmitting(true);
    const relations: Record<string, Record<string, string>> = {};
    for (const q of questions) {
      if (q.group === 'relation' && q.relationKey && answers[q.id]) {
        (relations[q.relationKey] = relations[q.relationKey] || {})[q.kind] = answers[q.id];
      }
    }
    const acceptGaps = reqQs
      .filter((q) => answers[q.id] && !NEGATIVE.test(answers[q.id]))
      .map((q) => q.missing!)
      .filter(Boolean);
    try {
      const r: any = await api.post(`/api/projects/${projectId}/requirement/followup`, { relations, acceptGaps });
      const relCount = (r?.relations || []).length;
      setDone(`✓ 已保存：确认 ${relCount} 条实体关系、采纳 ${acceptGaps.length} 项需求`);
      onDone?.();
    } catch {
      setDone('保存失败，可重试');
    }
    setSubmitting(false);
  };

  const renderQuestion = (q: Question) => (
    <div key={q.id} className="rounded-lg bg-white border border-amber-100 p-3">
      <p className="text-sm font-medium text-gray-800">{q.question}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {q.options.map((o) => (
          <button
            key={o.value}
            onClick={() => pick(q.id, o.value)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
              answers[q.id] === o.value
                ? 'bg-amber-500 text-white border-amber-500'
                : 'bg-white text-gray-600 border-gray-300 hover:border-amber-400'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );

  const total = questions.length;
  const answered = Object.keys(answers).length;

  return (
    <div className="border border-amber-200 bg-amber-50 rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3">
        <span className="text-lg">💬</span>
        <span className="text-sm font-semibold text-amber-800">还有几个问题想跟你确认</span>
        <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-200 text-amber-700 font-medium">{total} 题</span>
      </div>
      <p className="px-4 -mt-1 pb-2 text-xs text-amber-700">这些是从你填的需求和设计里检测到、还不太确定的点——选一下，让生成更准。</p>

      <div className="px-4 pb-4 space-y-4">
        {reqQs.length > 0 && (
          <section>
            <h4 className="text-xs font-semibold text-gray-500 mb-2">需求确认</h4>
            <div className="space-y-2">{reqQs.map(renderQuestion)}</div>
          </section>
        )}

        {Object.entries(relGroups).map(([key, qs]) => (
          <section key={key}>
            <h4 className="text-xs font-semibold text-gray-500 mb-2">实体关系 · {qs[0]?.title || key}</h4>
            <div className="space-y-2">{qs.map(renderQuestion)}</div>
          </section>
        ))}

        <div className="flex items-center justify-between pt-2 border-t border-amber-100">
          <span className="text-xs text-amber-600">{done || `已答 ${answered}/${total}`}</span>
          <button
            onClick={submit}
            disabled={submitting || answered === 0}
            className="rounded-lg px-5 py-2 text-sm text-white bg-amber-600 hover:bg-amber-700 transition-colors disabled:bg-gray-300"
          >
            {submitting ? '保存中...' : '保存确认'}
          </button>
        </div>
      </div>
    </div>
  );
}
