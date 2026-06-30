'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import NavBar from '@/lib/nav-bar';

type ScenarioStatus = 'pass' | 'fail' | 'manual';

interface ScenarioCheck {
  source: string;
  name: string;
  passed: boolean;
  detail?: string;
}

interface ScenarioVerification {
  scenarioName: string;
  given: string;
  when: string;
  then: string;
  priority: 'must' | 'nice';
  coverage: string[];
  provenance: string[];
  status: ScenarioStatus;
  checks: ScenarioCheck[];
  evidence: string;
  verifiedAt: string;
}

interface AcceptanceReport {
  hasScenarios: boolean;
  passRate: number | null;
  total: number;
  passed: number;
  failed: number;
  manual: number;
  overallScore: number | null;
  scenarios: ScenarioVerification[];
  verifiedAt: string | null;
  specVersion: number | null;
}

interface UnresolvedRequirementItem {
  id: string;
  title: string;
  category: 'external_interface' | 'existing_tool_or_skill' | 'backend_capability' | 'generator_capability' | 'manual_decision';
  solutionRouteLabel: string;
  sourceRecommendation: string;
  matchingHints: {
    query: string;
    topics: string[];
    suggestedKeywords: string[];
    mustHaveCapabilities: string[];
  };
}

interface CapabilityModuleCandidate {
  id: string;
  title: string;
  category: UnresolvedRequirementItem['category'];
  solutionRouteLabel: string;
  requirementIds: string[];
  whyConverge: string;
  matchingHints: {
    query: string;
    topics: string[];
    suggestedKeywords: string[];
    mustHaveCapabilities: string[];
  };
}

interface UnresolvedRequirementsDocument {
  generatedAt: string;
  source: {
    status: string;
    statusText: string | null;
    terminalType: string | null;
    round: number;
    score: number;
  };
  summary: {
    total: number;
    moduleCandidateCount: number;
    externalInterfaceCount: number;
    existingToolOrAgentCount: number;
    backendCapabilityCount: number;
    generatorCapabilityCount: number;
    manualDecisionCount: number;
    recommendation: string;
  };
  collectionPolicy?: {
    mode: 'document_first';
    immediateOnlineFetch: false;
    selectionOwner: 'user';
    convergenceRule: string;
  };
  moduleCandidates: CapabilityModuleCandidate[];
  requirements: UnresolvedRequirementItem[];
  markdown: string;
}

const STATUS_META: Record<ScenarioStatus, { label: string; cls: string; dot: string }> = {
  pass: { label: '通过', cls: 'bg-green-100 text-green-700 border-green-200', dot: 'bg-green-500' },
  fail: { label: '未通过', cls: 'bg-red-100 text-red-700 border-red-200', dot: 'bg-red-500' },
  manual: { label: '待人工', cls: 'bg-amber-100 text-amber-700 border-amber-200', dot: 'bg-amber-500' },
};

export default function AcceptanceReportPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;
  const { token, isLoading: authLoading } = useAuth();

  const [report, setReport] = useState<AcceptanceReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [message, setMessage] = useState('');
  const [unresolvedDoc, setUnresolvedDoc] = useState<UnresolvedRequirementsDocument | null>(null);
  const [docLoading, setDocLoading] = useState(true);

  const fetchReport = useCallback(async () => {
    if (!token || authLoading) return;
    try {
      const data = await api.get(`/api/projects/${projectId}/delivery/acceptance-report`);
      setReport(data);
    } catch (e: any) {
      if (e?.status === 404) {
        setReport(null);
        setMessage('尚未生成规格，请先在「产品规格」页生成并确认规格');
      } else {
        setMessage('加载验收报告失败: ' + (e?.message || '未知错误'));
      }
    } finally {
      setLoading(false);
    }
  }, [token, authLoading, projectId]);

  const fetchUnresolvedDoc = useCallback(async () => {
    if (!token || authLoading) return;
    try {
      const data = await api.get(`/api/projects/${projectId}/delivery/unresolved-requirements`);
      setUnresolvedDoc(data);
    } catch {
      setUnresolvedDoc(null);
    } finally {
      setDocLoading(false);
    }
  }, [token, authLoading, projectId]);

  useEffect(() => {
    fetchReport();
    fetchUnresolvedDoc();
  }, [fetchReport, fetchUnresolvedDoc]);

  const runVerify = async () => {
    setVerifying(true);
    setMessage('');
    try {
      const data = await api.post(`/api/projects/${projectId}/delivery/acceptance-verify`);
      setReport(data);
      await fetchUnresolvedDoc();
      setMessage('✅ 验收完成');
    } catch (e: any) {
      setMessage('验收失败: ' + (e?.message || '未知错误'));
    } finally {
      setVerifying(false);
    }
  };

  const manualConfirm = async (scenarioName: string, status: ScenarioStatus) => {
    const note = window.prompt(`将「${scenarioName}」人工标记为「${STATUS_META[status].label}」。可填写裁定说明（可留空）：`, '');
    if (note === null) return; // 取消
    try {
      const data = await api.post(`/api/projects/${projectId}/delivery/acceptance-manual-confirm`, {
        scenarioName, status, note: note || undefined,
      });
      setReport(data);
      setMessage(`✅ 已人工裁定「${scenarioName}」`);
    } catch (e: any) {
      setMessage('裁定失败: ' + (e?.message || '未知错误'));
    }
  };

  const exportJson = () => {
    if (!report) return;
    const payload = {
      projectId,
      specVersion: report.specVersion,
      verifiedAt: report.verifiedAt,
      passRate: report.passRate,
      summary: { total: report.total, passed: report.passed, failed: report.failed, manual: report.manual },
      overallScore: report.overallScore,
      scenarios: report.scenarios,
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `acceptance-report-${projectId.slice(0, 8)}-v${report.specVersion ?? 0}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyUnresolvedMarkdown = async () => {
    if (!unresolvedDoc?.markdown) return;
    try {
      await navigator.clipboard.writeText(unresolvedDoc.markdown);
      setMessage('✅ 已复制未解决需求文档');
    } catch {
      setMessage('复制失败，请使用下载文档');
    }
  };

  const downloadUnresolvedMarkdown = () => {
    if (!unresolvedDoc?.markdown) return;
    const blob = new Blob([unresolvedDoc.markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `unresolved-requirements-${projectId.slice(0, 8)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <NavBar projectId={projectId} />
        <div className="flex items-center justify-center h-64"><div className="text-gray-500">加载中...</div></div>
      </div>
    );
  }

  const pct = report?.passRate != null ? Math.round(report.passRate * 100) : null;
  const pctColor = pct == null ? 'text-gray-400' : pct >= 80 ? 'text-green-600' : pct >= 50 ? 'text-amber-600' : 'text-red-600';
  const ringColor = pct == null ? '#d1d5db' : pct >= 80 ? '#16a34a' : pct >= 50 ? '#d97706' : '#dc2626';

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar projectId={projectId} />
      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">验收报告</h1>
            <p className="text-sm text-gray-500 mt-1">
              逐条验收场景 → 来源 → 实现 → 检查结果，可审计可追溯
              {report?.verifiedAt && <span className="ml-2 text-gray-400">· 最近验收 {new Date(report.verifiedAt).toLocaleString()}</span>}
              {report?.specVersion != null && <span className="ml-1 text-gray-400">· 规格 v{report.specVersion}</span>}
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={runVerify}
              disabled={verifying}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
            >
              {verifying ? '验收中...' : report?.verifiedAt ? '重新验收' : '执行验收'}
            </button>
            <button
              onClick={exportJson}
              disabled={!report?.scenarios?.length}
              className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 disabled:opacity-50 text-sm"
            >
              导出报告
            </button>
            <button
              onClick={() => router.push(`/projects/${projectId}/delivery`)}
              className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-100 text-sm"
            >
              去交付
            </button>
          </div>
        </div>

        {message && (
          <div className={`mb-4 p-3 rounded-lg text-sm ${message.includes('✅') ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}`}>
            {message}
          </div>
        )}

        <UnresolvedRequirementsPanel
          doc={unresolvedDoc}
          loading={docLoading}
          onRefresh={fetchUnresolvedDoc}
          onCopy={copyUnresolvedMarkdown}
          onDownload={downloadUnresolvedMarkdown}
        />

        {!report?.hasScenarios && (
          <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
            <p className="text-gray-500">当前规格还没有可验收的场景。</p>
            <p className="text-xs text-gray-400 mt-2">请先在「产品规格」页生成规格（会从需求功能自动生成验收场景）。</p>
            <button
              onClick={() => router.push(`/projects/${projectId}/spec`)}
              className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
            >
              去产品规格
            </button>
          </div>
        )}

        {report?.hasScenarios && (
          <>
            {/* 通过率仪表盘 */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
              <div className="bg-white rounded-xl border border-gray-200 p-5 flex items-center gap-4">
                <div
                  className="w-20 h-20 rounded-full flex items-center justify-center shrink-0"
                  style={{ background: `conic-gradient(${ringColor} ${(pct ?? 0) * 3.6}deg, #f3f4f6 0deg)` }}
                >
                  <div className="w-15 h-15 bg-white rounded-full flex items-center justify-center" style={{ width: 60, height: 60 }}>
                    <span className={`text-lg font-bold ${pctColor}`}>{pct == null ? '—' : `${pct}%`}</span>
                  </div>
                </div>
                <div>
                  <p className="text-xs text-gray-500">通过率</p>
                  <p className="text-sm text-gray-700 mt-1">门控阈值 80%</p>
                  {pct != null && (
                    <p className={`text-xs mt-1 font-medium ${pct >= 80 ? 'text-green-600' : 'text-red-600'}`}>
                      {pct >= 80 ? '✓ 可交付' : '✗ 未达交付标准'}
                    </p>
                  )}
                </div>
              </div>
              <StatCard label="通过" value={report.passed} total={report.total} color="green" />
              <StatCard label="未通过" value={report.failed} total={report.total} color="red" />
              <StatCard label="待人工" value={report.manual} total={report.total} color="amber" />
            </div>

            {report.overallScore != null && (
              <div className="mb-6 text-xs text-gray-500">
                平台实现质量综合得分（传感器融合）：<span className="font-semibold text-gray-700">{report.overallScore}/100</span>
              </div>
            )}

            {/* 逐条场景 */}
            <div className="space-y-4">
              {report.scenarios.map((s, i) => (
                <ScenarioCard key={i} s={s} onManual={manualConfirm} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function UnresolvedRequirementsPanel({
  doc,
  loading,
  onRefresh,
  onCopy,
  onDownload,
}: {
  doc: UnresolvedRequirementsDocument | null;
  loading: boolean;
  onRefresh: () => void;
  onCopy: () => void;
  onDownload: () => void;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900">未解决需求收敛文档</h2>
          <p className="text-xs text-gray-500 mt-1">
            只沉淀自迭代无法闭合的缺口，先归并为模块候选；不在子体生成现场自动联网下载工具。
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button onClick={onRefresh} className="px-3 py-1.5 text-xs border border-gray-300 rounded-lg hover:bg-gray-50">
            刷新
          </button>
          <button
            onClick={onCopy}
            disabled={!doc?.markdown}
            className="px-3 py-1.5 text-xs border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            复制 Markdown
          </button>
          <button
            onClick={onDownload}
            disabled={!doc?.markdown}
            className="px-3 py-1.5 text-xs bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50"
          >
            下载文档
          </button>
        </div>
      </div>

      {loading && <p className="text-sm text-gray-500 mt-4">正在读取自迭代缺口...</p>}

      {!loading && !doc && (
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 mt-4">
          暂时无法读取未解决需求文档。
        </p>
      )}

      {!loading && doc && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-4">
            <MiniStat label="原子缺口" value={doc.summary.total} />
            <MiniStat label="模块候选" value={doc.summary.moduleCandidateCount ?? doc.moduleCandidates?.length ?? 0} />
            <MiniStat label="外部接口" value={doc.summary.externalInterfaceCount} />
            <MiniStat label="开源工具" value={doc.summary.existingToolOrAgentCount} />
            <MiniStat label="生成器" value={doc.summary.generatorCapabilityCount + doc.summary.backendCapabilityCount} />
          </div>
          <p className="text-xs text-gray-500 mt-3">
            状态：{doc.source.status}{doc.source.statusText ? ` · ${doc.source.statusText}` : ''} · 第 {doc.source.round} 轮 · {doc.source.score} 分
          </p>
          {doc.collectionPolicy?.convergenceRule && (
            <p className="text-xs text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-lg p-3 mt-3">
              收敛规则：{doc.collectionPolicy.convergenceRule}
            </p>
          )}
          <p className="text-sm text-gray-700 mt-3">{doc.summary.recommendation}</p>
          {doc.moduleCandidates?.length > 0 ? (
            <div className="mt-4 divide-y divide-gray-100 border border-gray-100 rounded-lg overflow-hidden">
              {doc.moduleCandidates.slice(0, 6).map((mod) => (
                <div key={mod.id} className="p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{mod.id} {mod.title}</p>
                      <p className="text-xs text-gray-500 mt-1">
                        覆盖 {mod.requirementIds.join('、')} · {mod.solutionRouteLabel} · {categoryText(mod.category)}
                      </p>
                    </div>
                    <span className="text-xs px-2 py-0.5 rounded bg-indigo-50 text-indigo-600 border border-indigo-100 shrink-0">
                      待选型
                    </span>
                  </div>
                  <p className="text-xs text-gray-600 mt-2">{mod.whyConverge}</p>
                  <p className="text-xs text-gray-600 mt-2 break-words">模块匹配输入：{mod.matchingHints.query}</p>
                  {mod.matchingHints.mustHaveCapabilities.length > 0 && (
                    <p className="text-xs text-gray-500 mt-1">
                      必备能力：{mod.matchingHints.mustHaveCapabilities.slice(0, 3).join('；')}
                    </p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg p-3 mt-4">
              当前没有沉淀出需要外部接口或开源工具补齐的缺口。
            </p>
          )}
        </>
      )}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-xl font-semibold text-gray-900 mt-1">{value}</p>
    </div>
  );
}

function categoryText(category: UnresolvedRequirementItem['category']) {
  const map: Record<UnresolvedRequirementItem['category'], string> = {
    external_interface: '外部接口',
    existing_tool_or_skill: '开源工具/skill',
    backend_capability: '后端能力',
    generator_capability: '生成器能力',
    manual_decision: '人工决策',
  };
  return map[category];
}

function StatCard({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const map: Record<string, string> = {
    green: 'border-green-200 bg-green-50 text-green-700',
    red: 'border-red-200 bg-red-50 text-red-700',
    amber: 'border-amber-200 bg-amber-50 text-amber-700',
  };
  return (
    <div className={`rounded-xl border p-5 ${map[color]}`}>
      <p className="text-xs opacity-70">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}<span className="text-sm font-normal opacity-60"> / {total}</span></p>
    </div>
  );
}

function ScenarioCard({ s, onManual }: { s: ScenarioVerification; onManual: (name: string, status: ScenarioStatus) => void }) {
  const meta = STATUS_META[s.status];
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full border font-medium ${meta.cls}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />{meta.label}
          </span>
          <span className="text-sm font-semibold text-gray-900">{s.scenarioName}</span>
          <span className={`text-xs px-1.5 py-0.5 rounded ${s.priority === 'must' ? 'bg-red-50 text-red-600' : 'bg-gray-100 text-gray-500'}`}>
            {s.priority === 'must' ? '必须' : '建议'}
          </span>
        </div>
        {s.status !== 'pass' && (
          <div className="flex gap-2 shrink-0">
            <button onClick={() => onManual(s.scenarioName, 'pass')}
              className="text-xs px-2 py-1 rounded border border-green-300 text-green-700 hover:bg-green-50">标记通过</button>
            <button onClick={() => onManual(s.scenarioName, 'fail')}
              className="text-xs px-2 py-1 rounded border border-red-300 text-red-700 hover:bg-red-50">标记未通过</button>
          </div>
        )}
      </div>

      {/* GWT */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs mb-3">
        <div><span className="text-gray-400 block">前置 (Given)</span><span className="text-gray-700">{s.given || '—'}</span></div>
        <div><span className="text-gray-400 block">操作 (When)</span><span className="text-gray-700">{s.when || '—'}</span></div>
        <div><span className="text-gray-400 block">预期 (Then)</span><span className="text-green-700">{s.then || '—'}</span></div>
      </div>

      {/* 来源 + 覆盖 */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {s.coverage.map((c, i) => (
          <span key={`c${i}`} className="text-xs px-2 py-0.5 rounded bg-indigo-50 text-indigo-600 border border-indigo-100">覆盖：{c}</span>
        ))}
        {s.provenance.map((p, i) => (
          <span key={`p${i}`} className="text-xs px-2 py-0.5 rounded bg-gray-50 text-gray-500 border border-gray-200">来源：{p}</span>
        ))}
        {s.provenance.length === 0 && s.coverage.length === 0 && (
          <span className="text-xs text-gray-400 italic">无溯源信息</span>
        )}
      </div>

      {/* 检查结果/证据 */}
      <div className="border-t border-gray-100 pt-3 space-y-1.5">
        {s.checks.map((c, i) => (
          <div key={i} className="flex items-start gap-2 text-xs">
            <span>{c.passed ? '✅' : c.source === '人工' ? '👤' : '⚠️'}</span>
            <span className="text-gray-500 shrink-0">[{c.source}] {c.name}：</span>
            <span className="text-gray-600">{c.detail || '—'}</span>
          </div>
        ))}
        {s.evidence && (
          <p className="text-xs text-gray-500 mt-2 italic">结论：{s.evidence}</p>
        )}
      </div>
    </div>
  );
}
