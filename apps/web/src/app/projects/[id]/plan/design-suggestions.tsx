'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface DesignSuggestion {
  id: string;
  category: 'navigation' | 'layout' | 'fields' | 'flow' | 'color';
  title: string;
  description: string;
  adopted: boolean;
}

const CATEGORY_LABELS: Record<string, string> = {
  navigation: '导航结构',
  layout: '页面布局',
  fields: '核心字段',
  flow: '操作流程',
  color: '配色方案',
};

const CATEGORY_COLORS: Record<string, string> = {
  navigation: 'border-l-blue-400 bg-blue-50',
  layout: 'border-l-green-400 bg-green-50',
  fields: 'border-l-purple-400 bg-purple-50',
  flow: 'border-l-orange-400 bg-orange-50',
  color: 'border-l-pink-400 bg-pink-50',
};

const CATEGORY_ICONS: Record<string, string> = {
  navigation: '≡',
  layout: '⊞',
  fields: '◎',
  flow: '↻',
  color: '◈',
};

export default function DesignSuggestions({ projectId, onSaved }: { projectId: string; onSaved?: () => void }) {
  const [suggestions, setSuggestions] = useState<DesignSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');

  useEffect(() => {
    api.get(`/api/projects/${projectId}/plan/design-suggestions`)
      .then(setSuggestions)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [projectId]);

  const toggleAdopt = (id: string) => {
    setSuggestions(prev => prev.map(s => s.id === id ? { ...s, adopted: !s.adopted } : s));
    setSaved(false);
  };

  const startEdit = (s: DesignSuggestion) => {
    setEditingId(s.id);
    setEditTitle(s.title);
    setEditDesc(s.description);
  };

  const saveEdit = () => {
    setSuggestions(prev => prev.map(s => s.id === editingId ? { ...s, title: editTitle, description: editDesc } : s));
    setEditingId(null);
    setSaved(false);
  };

  const adoptAll = () => {
    setSuggestions(prev => prev.map(s => ({ ...s, adopted: true })));
    setSaved(false);
  };

  const saveAll = async () => {
    setSaving(true);
    try {
      await api.put(`/api/projects/${projectId}/plan/design-suggestions`, { suggestions });
      setSaved(true);
      onSaved?.(); // 通知父级：设计已采纳保存 → 触发实体关系检测（基于已采纳的设计）
    } catch { }
    setSaving(false);
  };

  if (loading) return <div className="p-8 text-center text-gray-400">加载设计建议...</div>;

  const grouped = suggestions.reduce<Record<string, DesignSuggestion[]>>((acc, s) => {
    (acc[s.category] = acc[s.category] || []).push(s);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      {Object.entries(grouped).map(([category, items]) => (
        <section key={category}>
          <h3 className="flex items-center gap-2 text-base font-semibold text-gray-700 mb-3">
            <span className="text-lg">{CATEGORY_ICONS[category]}</span>
            {CATEGORY_LABELS[category] || category}
          </h3>
          <div className="space-y-2">
            {items.map(s => (
              <div
                key={s.id}
                className={`rounded-lg border-l-4 p-4 transition-colors ${CATEGORY_COLORS[s.category] || 'border-l-gray-300 bg-gray-50'} ${s.adopted ? 'ring-2 ring-blue-300' : ''}`}
              >
                {editingId === s.id ? (
                  <div className="space-y-2">
                    <input
                      value={editTitle}
                      onChange={e => setEditTitle(e.target.value)}
                      className="w-full rounded border border-gray-300 px-2 py-1 text-sm font-medium"
                    />
                    <textarea
                      value={editDesc}
                      onChange={e => setEditDesc(e.target.value)}
                      className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
                      rows={2}
                    />
                    <div className="flex gap-2">
                      <button onClick={saveEdit} className="text-xs rounded bg-blue-600 px-3 py-1 text-white hover:bg-blue-700">保存</button>
                      <button onClick={() => setEditingId(null)} className="text-xs rounded border px-3 py-1 text-gray-600 hover:bg-gray-100">取消</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`inline-block h-2 w-2 rounded-full ${s.adopted ? 'bg-blue-500' : 'bg-gray-300'}`} />
                        <h4 className="font-medium text-gray-800 text-sm">{s.title}</h4>
                      </div>
                      <p className="text-gray-500 text-xs mt-1 line-clamp-2">{s.description}</p>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button
                        onClick={() => startEdit(s)}
                        className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-200"
                        title="编辑"
                      >✎</button>
                      <button
                        onClick={() => toggleAdopt(s.id)}
                        className={`rounded px-2 py-1 text-xs transition-colors ${s.adopted ? 'bg-blue-100 text-blue-700' : 'text-gray-500 hover:bg-gray-200'}`}
                      >
                        {s.adopted ? '已采纳' : '采纳'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}

      <div className="flex items-center justify-between pt-4 border-t">
        <button
          onClick={adoptAll}
          className="rounded-lg border border-blue-300 px-4 py-2 text-sm text-blue-700 hover:bg-blue-50 transition-colors"
        >
          全部采纳
        </button>
        <button
          onClick={saveAll}
          disabled={saving}
          className={`rounded-lg px-5 py-2 text-sm text-white transition-colors disabled:bg-gray-400 ${saved ? 'bg-green-600 hover:bg-green-700' : 'bg-blue-600 hover:bg-blue-700'}`}
        >
          {saving ? '保存中...' : saved ? '✓ 已保存' : '保存建议'}
        </button>
      </div>
    </div>
  );
}
