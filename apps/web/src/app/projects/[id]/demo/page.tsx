'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import NavBar from '@/lib/nav-bar';

type Mode = 'preview' | 'annotation' | 'theme' | 'replica';
interface ShotLayout { name: string; layout: string }
interface ClickedElement { moduleKey: string; elementPath: string; }
interface ThemeConfig { primary: string; mode: 'light' | 'dark'; radius: number; daisyTheme: string }

const DEFAULT_THEME: ThemeConfig = { primary: '#2563eb', mode: 'light', radius: 8, daisyTheme: 'corporate' };
const PRESET_COLORS = ['#2563eb', '#0ea5e9', '#16a34a', '#9333ea', '#dc2626', '#ea580c', '#0f766e', '#475569'];

/** 一键整体风格预设（西服/中山装）：daisyUI 主题(新 demo) + 主色/明暗/圆角(存量覆盖层兜底) */
const STYLE_PRESETS: { key: string; label: string; desc: string; config: ThemeConfig }[] = [
  { key: 'gov', label: '政务严肃', desc: '庄重深蓝 · 方正', config: { primary: '#1d4ed8', mode: 'light', radius: 2, daisyTheme: 'corporate' } },
  { key: 'biz', label: '企业商务', desc: '稳重蓝 · 适中', config: { primary: '#0f766e', mode: 'light', radius: 8, daisyTheme: 'business' } },
  { key: 'cockpit', label: '深色驾驶舱', desc: '科技青 · 深色', config: { primary: '#0ea5e9', mode: 'dark', radius: 10, daisyTheme: 'dark' } },
  { key: 'vivid', label: '活力互联网', desc: '活泼紫 · 圆润', config: { primary: '#9333ea', mode: 'light', radius: 16, daisyTheme: 'cyberpunk' } },
];

/** 与后端 ThemeService.buildThemeCss 一致的覆盖层 CSS（不含 <style> 包裹），用于 iframe 内实时预览 */
function buildThemeCssText(c: ThemeConfig): string {
  const dark = c.mode === 'dark';
  const bg = dark ? '#0f172a' : '#ffffff';
  const text = dark ? '#e5e7eb' : '#1f2937';
  const surface = dark ? '#1e293b' : '#f8fafc';
  const border = dark ? '#334155' : '#e5e7eb';
  const darkContainers = dark
    ? `nav, aside, header, [class*="card"], [class*="panel"], [class*="sidebar"], [class*="header"] { background-color: var(--tip-surface) !important; border-color: var(--tip-border) !important; }`
    : '';
  return `:root{ --tip-primary:${c.primary}; --tip-on-primary:#ffffff; --tip-radius:${c.radius}px; --tip-bg:${bg}; --tip-text:${text}; --tip-surface:${surface}; --tip-border:${border}; }
body{ background-color:var(--tip-bg)!important; color:var(--tip-text)!important; }
a{ color:var(--tip-primary)!important; }
button,.btn,[class*="btn"],[class*="button"],input[type="submit"],input[type="button"]{ background-color:var(--tip-primary)!important; color:var(--tip-on-primary)!important; border-color:var(--tip-primary)!important; border-radius:var(--tip-radius)!important; }
input,select,textarea,[class*="card"],[class*="panel"],table{ border-radius:var(--tip-radius)!important; }
${darkContainers}`;
}

interface FeedbackItem {
  id: string;
  moduleKey: string | null;
  elementPath: string | null;
  pageUrl: string | null;
  comment: string;
  status: string;
  createdAt: string;
}

interface DemoProgress {
  phase: 'queued' | 'generating' | 'done' | 'failed';
  percent: number;
  message: string;
  startedAt: string;
}

/** 生成中按已用时把进度平滑爬升到 95%，让进度条"在动"（后端单次大调用拿不到真实百分比） */
function displayProgress(p: DemoProgress | null, now: number): { percent: number; label: string; elapsed: number } {
  if (!p) return { percent: 0, label: 'AI 正在准备…', elapsed: 0 };
  const elapsed = p.startedAt ? Math.max(0, Math.floor((now - new Date(p.startedAt).getTime()) / 1000)) : 0;
  if (p.phase === 'done') return { percent: 100, label: p.message, elapsed };
  if (p.phase === 'failed') return { percent: 100, label: p.message, elapsed };
  const base = p.percent || 5;
  const smoothed = Math.min(95, base + (elapsed / 90) * (95 - base));
  return { percent: Math.round(smoothed), label: p.message || 'AI 正在生成预览…', elapsed };
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
  const [progress, setProgress] = useState<DemoProgress | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [feedbacks, setFeedbacks] = useState<FeedbackItem[]>([]);
  const [mode, setMode] = useState<Mode>('preview');
  const [clickedElement, setClickedElement] = useState<ClickedElement | null>(null);
  const [feedbackComment, setFeedbackComment] = useState('');
  const [themeConfig, setThemeConfig] = useState<ThemeConfig>(DEFAULT_THEME);
  const [shotLayouts, setShotLayouts] = useState<ShotLayout[]>([]);
  const [regenerating, setRegenerating] = useState(false);
  const [savingTheme, setSavingTheme] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editMsg, setEditMsg] = useState('');
  const themeRef = useRef(themeConfig);
  themeRef.current = themeConfig;
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
        setProgress(demo.progress || null);
        setProjectName(proj.name || '');
        setFeedbacks(Array.isArray(fbs) ? fbs : []);
        if (demo.themeConfig) setThemeConfig(demo.themeConfig);
        setShotLayouts(Array.isArray(demo.shotLayouts) ? demo.shotLayouts : []);
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
          setProgress(data.progress || null);
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

  // 生成中每秒驱动进度条平滑爬升（不发请求，仅本地重算已用时）
  useEffect(() => {
    if (status !== 'demo_generating') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [status]);

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

  // 把主题覆盖层写入 iframe 内的 <style id="tip-theme">（即时、不重载）
  const applyThemeToIframe = (cfg: ThemeConfig) => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    // daisyUI 化的 demo：切 data-theme（成熟主题体系），并清掉覆盖层避免 !important 冲突
    const isDaisy = !!doc.querySelector('link[href*="daisyui"]') || doc.documentElement.hasAttribute('data-theme');
    if (isDaisy) {
      doc.documentElement.setAttribute('data-theme', cfg.daisyTheme || 'corporate');
      const old = doc.getElementById('tip-theme');
      if (old) old.textContent = '';
      return;
    }
    // 非 daisyUI（存量/裸 HTML）：用覆盖层兜底
    let style = doc.getElementById('tip-theme') as HTMLStyleElement | null;
    if (!style) {
      style = doc.createElement('style');
      style.id = 'tip-theme';
      (doc.head || doc.body || doc.documentElement).appendChild(style);
    }
    style.textContent = buildThemeCssText(cfg);
  };

  const updateTheme = (patch: Partial<ThemeConfig>) => {
    const next = { ...themeRef.current, ...patch };
    setThemeConfig(next);
    applyThemeToIframe(next);
  };

  const handleSaveTheme = async () => {
    setSavingTheme(true);
    try {
      const saved = await api.patch(`/api/projects/${projectId}/demo/theme`, themeRef.current);
      if (saved) setThemeConfig(saved);
    } catch { /* 保存失败保留本地预览 */ }
    setSavingTheme(false);
  };

  const updateLayout = (i: number, v: string) =>
    setShotLayouts((ls) => ls.map((l, idx) => (idx === i ? { ...l, layout: v } : l)));

  const handleRegenerate = async () => {
    setRegenerating(true);
    try {
      await api.post(`/api/projects/${projectId}/demo/regenerate-shots`, { layouts: shotLayouts });
      const demo = await api.get(`/api/projects/${projectId}/demo`);
      setDemoHtml(demo.html || null);
      if (Array.isArray(demo.shotLayouts)) setShotLayouts(demo.shotLayouts);
    } catch { /* ignore */ }
    setRegenerating(false);
  };

  const handleGenerate = async () => {
    setStatus('demo_generating');
    setPublicStatusLabel('正在生成预览');
    setProgress({ phase: 'queued', percent: 5, message: '已加入生成队列，即将开始…', startedAt: new Date().toISOString() });
    setNow(Date.now());
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

  // 档位/颜色调整：通知 iframe 对选中元素改 class 或 inline style（即时预览，需保存才持久化）
  const adjustElement = (group: 'align' | 'size' | 'color' | 'bg', value: string) => {
    iframeRef.current?.contentWindow?.postMessage({ type: 'adjust-element', group, value }, '*');
    setEditMsg('');
  };

  // 保存预览里的直接编辑（取 iframe 当前 HTML 回存）
  const handleSaveEdit = async () => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    setSavingEdit(true);
    setEditMsg('');
    try {
      const html = '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
      await api.patch(`/api/projects/${projectId}/demo/html`, { html });
      setEditMsg('✓ 已保存');
    } catch (e: any) {
      setEditMsg('保存失败：' + (e?.message || '未知错误'));
    } finally {
      setSavingEdit(false);
    }
  };

  const handleClearSelection = () => {
    setClickedElement(null);
    setFeedbackComment('');
    setEditMsg('');
  };

  // paused：自迭代停在"需人工介入"后的状态——demo 仍在，须继续可看可手动编辑
  const showPreview = status === 'demo_ready' || status === 'awaiting_demo_feedback' || status === 'completed' || status === 'developing' || status === 'demo_failed' || status === 'paused';
  const showGenerateButton = status === 'prd_ready' || status === 'plan_ready' || status === 'spec_confirmed' || status === 'demo_ready' || status === 'demo_generating' || status === 'awaiting_demo_feedback' || status === 'completed' || status === 'developing' || status === 'demo_failed' || status === 'paused';

  if (isLoading) return null;

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <NavBar projectId={projectId} projectName={projectName} />

      <div className="flex items-center justify-between border-b bg-white px-6 py-2">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-bold text-gray-900">预览</h1>
          <ModeToggle mode={mode} onChange={setMode} hasShots={shotLayouts.length > 0} />
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
            (() => {
              const disp = displayProgress(progress, now);
              return (
                <div className="flex h-full items-center justify-center rounded-xl border-2 border-dashed">
                  <div className="w-full max-w-md px-8 text-center">
                    <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
                    <p className="mb-3 text-gray-700">{disp.label}</p>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
                      <div className="h-full rounded-full bg-blue-600 transition-all duration-700 ease-out" style={{ width: `${disp.percent}%` }} />
                    </div>
                    <div className="mt-2 flex justify-between text-xs text-gray-400">
                      <span>{disp.percent}%</span>
                      <span>已用时 {disp.elapsed}s</span>
                    </div>
                    <p className="mt-3 text-xs text-gray-400">复杂应用通常需要 1-2 分钟，可离开页面，生成完成后回来查看</p>
                  </div>
                </div>
              );
            })()
          ) : status === 'demo_failed' ? (
            <div className="flex h-full items-center justify-center rounded-xl border-2 border-dashed border-red-200 bg-red-50/30">
              <div className="max-w-md px-8 text-center">
                <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-red-100 text-xl text-red-500">!</div>
                <p className="mb-1 font-medium text-gray-800">预览生成未成功</p>
                <p className="mb-4 text-sm text-gray-500">{progress?.message || '生成超时或出错，可以重试。'}</p>
                <button
                  onClick={handleGenerate}
                  className="rounded-lg bg-blue-600 px-5 py-2 text-sm text-white transition-colors hover:bg-blue-700"
                >
                  重新生成预览
                </button>
              </div>
            </div>
          ) : showPreview && demoHtml ? (
            <div className="relative h-full">
            <iframe
              ref={iframeRef}
              srcDoc={demoHtml}
              onLoad={() => applyThemeToIframe(themeRef.current)}
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

                {/* 快捷调整：档位（直接改，不走 AI） */}
                <div className="mt-1 space-y-2 border-t border-gray-100 pt-3">
                  <p className="text-xs text-gray-500">快捷调整（即时预览，需保存）</p>
                  <div className="flex items-center gap-1.5">
                    <span className="w-8 text-xs text-gray-400">对齐</span>
                    {([['left', '左'], ['center', '中'], ['right', '右']] as const).map(([v, l]) => (
                      <button key={v} onClick={() => adjustElement('align', v)}
                        className="flex-1 rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50">{l}</button>
                    ))}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-8 text-xs text-gray-400">字号</span>
                    {([['sm', '小'], ['base', '中'], ['lg', '大'], ['xl', '特大']] as const).map(([v, l]) => (
                      <button key={v} onClick={() => adjustElement('size', v)}
                        className="flex-1 rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50">{l}</button>
                    ))}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-8 text-xs text-gray-400">文字</span>
                    <input type="color" onChange={(e) => adjustElement('color', e.target.value)}
                      title="文字颜色" className="h-7 w-9 cursor-pointer rounded border border-gray-300 bg-white p-0.5" />
                    <span className="ml-3 w-8 text-xs text-gray-400">背景</span>
                    <input type="color" onChange={(e) => adjustElement('bg', e.target.value)}
                      title="背景颜色" className="h-7 w-9 cursor-pointer rounded border border-gray-300 bg-white p-0.5" />
                  </div>
                  <button onClick={handleSaveEdit} disabled={savingEdit}
                    className="w-full rounded-lg bg-green-600 px-3 py-1.5 text-sm text-white hover:bg-green-700 disabled:opacity-50">
                    {savingEdit ? '保存中…' : '保存修改'}
                  </button>
                  {editMsg && <p className="text-xs text-gray-500">{editMsg}</p>}
                </div>
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

        {/* Theme sidebar — 外观换肤 */}
        {mode === 'theme' && showPreview && demoHtml && (
          <aside className="w-72 border-l bg-white p-4 overflow-y-auto flex flex-col gap-5">
            <div>
              <h2 className="mb-2 text-sm font-semibold text-gray-800">整体风格</h2>
              <div className="grid grid-cols-2 gap-2">
                {STYLE_PRESETS.map((p) => {
                  const active =
                    themeConfig.primary.toLowerCase() === p.config.primary.toLowerCase() &&
                    themeConfig.mode === p.config.mode &&
                    themeConfig.radius === p.config.radius;
                  return (
                    <button
                      key={p.key}
                      onClick={() => updateTheme(p.config)}
                      className={`rounded-lg border p-2.5 text-left transition-all ${active ? 'border-blue-500 ring-1 ring-blue-300' : 'border-gray-200 hover:border-gray-300'}`}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="h-4 w-4 rounded-full" style={{ backgroundColor: p.config.primary }} />
                        <span className="text-xs font-medium text-gray-800">{p.label}</span>
                      </div>
                      <p className="mt-1 text-[11px] text-gray-400">{p.desc}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <h2 className="mb-2 text-sm font-semibold text-gray-800">主题色 <span className="font-normal text-gray-400">微调</span></h2>
              <div className="mb-2 flex flex-wrap gap-2">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => updateTheme({ primary: c })}
                    className={`h-7 w-7 rounded-full border-2 ${themeConfig.primary.toLowerCase() === c ? 'border-gray-800' : 'border-transparent'}`}
                    style={{ backgroundColor: c }}
                    title={c}
                  />
                ))}
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-600">
                自定义
                <input
                  type="color"
                  value={themeConfig.primary}
                  onChange={(e) => updateTheme({ primary: e.target.value })}
                  className="h-7 w-10 cursor-pointer rounded border border-gray-300"
                />
                <span className="font-mono text-xs text-gray-400">{themeConfig.primary}</span>
              </label>
            </div>

            <div>
              <h2 className="mb-2 text-sm font-semibold text-gray-800">明暗</h2>
              <div className="flex w-fit overflow-hidden rounded-lg border border-gray-300">
                {(['light', 'dark'] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => updateTheme({ mode: m })}
                    className={`px-4 py-1.5 text-sm ${themeConfig.mode === m ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
                  >
                    {m === 'light' ? '浅色' : '深色'}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <h2 className="mb-2 text-sm font-semibold text-gray-800">
                圆角 <span className="font-normal text-gray-400">{themeConfig.radius}px</span>
              </h2>
              <input
                type="range"
                min={0}
                max={20}
                value={themeConfig.radius}
                onChange={(e) => updateTheme({ radius: Number(e.target.value) })}
                className="w-full"
              />
            </div>

            <button
              onClick={handleSaveTheme}
              disabled={savingTheme}
              className="mt-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {savingTheme ? '保存中…' : '保存外观'}
            </button>
            <p className="text-xs text-gray-400">调整即时预览；保存后下次打开与交付都会沿用。</p>
          </aside>
        )}

        {/* Replica sidebar — 看图复刻描述校对（人在回路） */}
        {mode === 'replica' && showPreview && shotLayouts.length > 0 && (
          <aside className="w-80 border-l bg-white p-4 overflow-y-auto flex flex-col gap-3">
            <div>
              <h2 className="text-sm font-semibold text-gray-800">复刻描述校对</h2>
              <p className="mt-1 text-xs text-gray-400">看图复刻的布局描述，可改 OCR 错/补漏；改完「按描述重新生成」(跳过看图、更省时)。</p>
            </div>
            {shotLayouts.map((s, i) => (
              <div key={i} className="rounded-lg border border-gray-200 p-2">
                <p className="mb-1 text-xs font-medium text-gray-600">{s.name}</p>
                <textarea
                  value={s.layout}
                  onChange={(e) => updateLayout(i, e.target.value)}
                  className="h-40 w-full rounded border border-gray-300 px-2 py-1 font-mono text-xs focus:border-blue-500 focus:outline-none"
                />
              </div>
            ))}
            <button
              onClick={handleRegenerate}
              disabled={regenerating}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {regenerating ? '重新生成中…' : '按描述重新生成'}
            </button>
          </aside>
        )}
      </div>
    </div>
  );
}

function ModeToggle({ mode, onChange, hasShots }: { mode: Mode; onChange: (m: Mode) => void; hasShots: boolean }) {
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
      <button
        onClick={() => onChange('theme')}
        className={`px-4 py-1.5 text-sm transition-colors ${
          mode === 'theme'
            ? 'bg-blue-600 text-white'
            : 'bg-white text-gray-700 hover:bg-gray-50'
        }`}
      >
        外观
      </button>
      {hasShots && (
        <button
          onClick={() => onChange('replica')}
          className={`px-4 py-1.5 text-sm transition-colors ${
            mode === 'replica' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'
          }`}
        >
          复刻校对
        </button>
      )}
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
