'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import NavBar from '@/lib/nav-bar';
import NextStepCard from '@/components/next-step-card';
import WarningCard from '@/components/warning-card';

interface AcceptanceScenario {
  name: string; given: string; when: string; then: string; priority: string;
}

interface CoreFunction {
  name: string; description: string; priority: 'must' | 'nice' | 'later';
}

interface PageItem {
  name: string; route: string; description: string;
}

interface RoleItem {
  name: string; permissions: string[];
}

interface DataModel {
  name: string; fields: { name: string; type: string; required: boolean }[];
}

interface BusinessRule {
  name: string; description: string; trigger: string; outcome: string;
}

interface RiskItem {
  name: string; severity: string; description: string;
}

type GateStatus = 'pass' | 'warn' | 'fail';

interface FreezeGateSlot {
  key: string;
  label: string;
  count: number;
  ok: boolean;
  required: boolean;
}

interface FreezeGate {
  status: GateStatus;
  contentStatus: GateStatus;
  deliveryStatus: GateStatus;
  readyToFreeze: boolean;
  frozen: boolean;
  summary: string;
  deliverySummary: string;
  freezeMessage: string;
  counts: Record<string, number>;
  requiredGaps: string[];
  advisoryGaps: string[];
  gaps: string[];
  requiredSlots: FreezeGateSlot[];
  advisorySlots: FreezeGateSlot[];
}

interface SpecData {
  exists: boolean;
  id?: string;
  version?: number;
  status?: string;
  targetUsers?: { role: string; description: string }[];
  coreFunctions?: CoreFunction[];
  outOfScope?: { name: string; reason: string }[];
  pages?: PageItem[];
  roles?: RoleItem[];
  dataModels?: DataModel[];
  businessRules?: BusinessRule[];
  acceptanceScenarios?: AcceptanceScenario[];
  estimatedCostRmb?: number;
  estimatedDays?: number;
  primaryRisks?: RiskItem[];
  message?: string;
  projectName?: string;
  freezeGate?: FreezeGate;
}

type TabKey = 'overview' | 'functions' | 'pages' | 'roles' | 'data' | 'rules' | 'acceptance';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: '概览' },
  { key: 'functions', label: '功能范围' },
  { key: 'pages', label: '页面清单' },
  { key: 'roles', label: '角色权限' },
  { key: 'data', label: '数据模型' },
  { key: 'rules', label: '业务规则' },
  { key: 'acceptance', label: '验收场景' },
];

export default function SpecPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;
  const { token, isLoading: authLoading } = useAuth();

  const [spec, setSpec] = useState<SpecData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [message, setMessage] = useState('');

  const fetchSpec = useCallback(async () => {
    if (!token || authLoading) return;
    try {
      const data = await api.get(`/api/projects/${projectId}/specification`);
      setSpec(data);
    } catch (e: any) {
      if (e?.status === 404) {
        setSpec({ exists: false, message: '尚未生成规格草案' });
      } else {
        setMessage('加载规格失败: ' + (e?.message || '未知错误'));
      }
    } finally {
      setLoading(false);
    }
  }, [token, authLoading, projectId]);

  useEffect(() => { fetchSpec(); }, [fetchSpec]);

  const handleGenerate = async () => {
    setSaving(true);
    setMessage('');
    try {
      const data = await api.post(`/api/projects/${projectId}/specification/generate`);
      setSpec(data);
      setMessage('规格草案已生成');
    } catch (e: any) {
      setMessage('生成失败: ' + (e?.message || '未知错误'));
    } finally {
      setSaving(false);
    }
  };

  const handleConfirm = async () => {
    if (spec?.freezeGate && !spec.freezeGate.readyToFreeze) {
      setMessage('确认失败: ' + spec.freezeGate.freezeMessage);
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      const data = await api.post(`/api/projects/${projectId}/specification/freeze`, { action: 'confirm' });
      setSpec((prev) => prev ? { ...prev, status: 'frozen', version: data.version, freezeGate: data.freezeGate || prev.freezeGate } : prev);
      setMessage('✅ 规格已确认！下一步：生成预览 → 查看效果 → 终稿交付（无需自迭代）');
    } catch (e: any) {
      setMessage('确认失败: ' + (e?.message || '未知错误'));
    } finally {
      setSaving(false);
    }
  };

  const handleRevise = async () => {
    setSaving(true);
    setMessage('');
    try {
      const data = await api.post(`/api/projects/${projectId}/specification/freeze`, { action: 'revise' });
      setSpec((prev) => prev ? { ...prev, status: 'draft', version: data.version, freezeGate: data.freezeGate || prev.freezeGate } : prev);
      setMessage('规格已退回，可以修改后再确认');
    } catch (e: any) {
      setMessage('退回失败: ' + (e?.message || '未知错误'));
    } finally {
      setSaving(false);
    }
  };

  const handleRepairSpec = async () => {
    setRepairing(true);
    setMessage('');
    try {
      if (spec?.status === 'frozen') {
        await api.post(`/api/projects/${projectId}/specification/freeze`, {
          action: 'revise',
          reviseNote: '规格冻结门未通过，解冻后按当前需求重新生成规格',
        });
      }
      const data = await api.post(`/api/projects/${projectId}/specification/generate`);
      setSpec(data);
      setMessage('规格已解冻并重新生成，请检查缺口后再次确认');
    } catch (e: any) {
      setMessage('修复规格失败: ' + (e?.message || '未知错误'));
    } finally {
      setRepairing(false);
    }
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <NavBar />
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-500">加载中...</div>
        </div>
      </div>
    );
  }

  const isFrozen = spec?.status === 'frozen';
  const hasSpec = spec?.exists !== false;
  const freezeGate = spec?.freezeGate;
  const canConfirm = hasSpec && !isFrozen && (freezeGate ? freezeGate.readyToFreeze : true);
  const devBlocked = hasSpec && isFrozen && freezeGate?.deliveryStatus === 'fail';

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar />
      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">产品规格确认</h1>
            <p className="text-sm text-gray-500 mt-1">
              {spec?.projectName || '项目'} · 
              {isFrozen ? (
                <span className="text-green-600 font-medium"> 已确认 v{spec?.version}</span>
              ) : hasSpec ? (
                <span className="text-amber-600 font-medium"> 待确认 v{spec?.version}</span>
              ) : (
                <span> 未生成</span>
              )}
            </p>
          </div>
          <div className="flex gap-3">
            {!hasSpec && (
              <button
                onClick={handleGenerate}
                disabled={saving}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
              >
                {saving ? '生成中...' : '生成规格草案'}
              </button>
            )}
            {hasSpec && !isFrozen && (
              <>
                <button
                  onClick={handleConfirm}
                  disabled={saving || !canConfirm}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 text-sm font-medium"
                >
                  确认规格，进入开发
                </button>
                <button
                  onClick={handleGenerate}
                  disabled={saving}
                  className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-100 disabled:opacity-50 text-sm"
                >
                  重新生成
                </button>
              </>
            )}
            {isFrozen && (
              <>
                <button
                  onClick={() => router.push(`/projects/${projectId}/demo`)}
                  disabled={devBlocked}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 text-sm font-medium"
                >
                  进入开发
                </button>
                <button
                  onClick={handleRevise}
                  disabled={saving}
                  className="px-4 py-2 border border-amber-300 text-amber-700 rounded-lg hover:bg-amber-50 disabled:opacity-50 text-sm"
                >
                  退回修改
                </button>
              </>
            )}
            <button
              onClick={() => router.push(`/projects/${projectId}/plan`)}
              className="px-4 py-2 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-100 text-sm"
            >
              返回方案
            </button>
          </div>
        </div>

        {message && (
          <div className={`mb-4 p-3 rounded-lg text-sm ${message.includes('✅') || message.includes('已生成') ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
            {message}
          </div>
        )}

        {/* 下一步建议 */}
        {hasSpec && (
          <div className="mb-6 space-y-3">
            {freezeGate && (
              <SpecFreezeGateCard
                gate={freezeGate}
                isFrozen={isFrozen}
                repairing={repairing}
                onRepair={handleRepairSpec}
              />
            )}
            <WarningCard projectId={projectId} refreshKey={spec?.status} />
            <NextStepCard projectId={projectId} refreshKey={spec?.status} />
          </div>
        )}

        {/* Tabs */}
        {hasSpec && (
          <>
            <div className="flex gap-1 mb-6 border-b border-gray-200">
              {TABS.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === tab.key
                      ? 'border-blue-600 text-blue-700'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Tab Content */}
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              {activeTab === 'overview' && <OverviewTab spec={spec!} />}
              {activeTab === 'functions' && <FunctionsTab spec={spec!} />}
              {activeTab === 'pages' && <PagesTab spec={spec!} />}
              {activeTab === 'roles' && <RolesTab spec={spec!} />}
              {activeTab === 'data' && <DataTab spec={spec!} />}
              {activeTab === 'rules' && <RulesTab spec={spec!} />}
              {activeTab === 'acceptance' && <AcceptanceTab spec={spec!} />}
            </div>

            {/* Bottom confirm bar */}
            {!isFrozen && (
              <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-xl">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-blue-800">确认无误后，点击确认规格进入开发</p>
                    <p className="text-xs text-blue-600 mt-1">
                      确认后，后续反馈将自动判定是问题修复还是新增需求
                    </p>
                  </div>
                  <button
                    onClick={handleConfirm}
                    disabled={saving || !canConfirm}
                    className="px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium shadow-sm"
                  >
                    确认规格
                  </button>
                </div>
              </div>
            )}
            {isFrozen && (
              <div className="mt-6 p-4 bg-green-50 border border-green-200 rounded-xl">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-green-800">规格已确认 v{spec.version}，可以进入开发</p>
                    <p className="text-xs text-green-600 mt-1">
                      下一步：生成 Demo 预览 → 查看效果 → 终稿交付
                    </p>
                  </div>
                  <button
                    onClick={() => router.push(`/projects/${projectId}/demo`)}
                    disabled={devBlocked}
                    className="px-6 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 text-sm font-medium shadow-sm"
                  >
                    进入开发
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function SpecFreezeGateCard({
  gate,
  isFrozen,
  repairing,
  onRepair,
}: {
  gate: FreezeGate;
  isFrozen: boolean;
  repairing: boolean;
  onRepair: () => void;
}) {
  const displayStatus = isFrozen ? gate.deliveryStatus : gate.contentStatus;
  const blocked = displayStatus === 'fail';
  const tone = blocked ? 'red' : displayStatus === 'warn' ? 'amber' : 'green';
  const toneClass: Record<string, string> = {
    red: 'bg-red-50 border-red-200 text-red-800',
    amber: 'bg-amber-50 border-amber-200 text-amber-800',
    green: 'bg-green-50 border-green-200 text-green-800',
  };
  const badgeClass: Record<string, string> = {
    red: 'bg-red-100 text-red-700',
    amber: 'bg-amber-100 text-amber-700',
    green: 'bg-green-100 text-green-700',
  };
  const title = blocked
    ? isFrozen ? '规格已冻结，但冻结门未通过' : '规格冻结门未通过'
    : displayStatus === 'warn'
      ? '已满足冻结条件，仍有建议项'
      : isFrozen ? '规格冻结门已通过' : '规格内容已满足冻结条件';

  return (
    <div className={`rounded-xl border p-4 ${toneClass[tone]}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${badgeClass[tone]}`}>
              {displayStatus === 'pass' ? 'PASS' : displayStatus === 'warn' ? 'WARN' : 'FAIL'}
            </span>
            <p className="text-sm font-semibold">{title}</p>
          </div>
          <p className="text-xs mt-2 opacity-90">{isFrozen ? gate.deliverySummary : gate.freezeMessage}</p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center text-xs shrink-0">
          <GateCount label="角色" value={gate.counts.roles || 0} />
          <GateCount label="功能" value={gate.counts.coreFunctions || 0} />
          <GateCount label="验收" value={gate.counts.acceptanceScenarios || 0} />
        </div>
      </div>

      {(gate.requiredGaps.length > 0 || gate.advisoryGaps.length > 0) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {gate.requiredGaps.map((gap) => (
            <span key={gap} className="px-2 py-1 rounded bg-white/70 text-xs font-medium border border-current/10">
              必补：{gap}
            </span>
          ))}
          {gate.advisoryGaps.map((gap) => (
            <span key={gap} className="px-2 py-1 rounded bg-white/50 text-xs border border-current/10">
              建议：{gap}
            </span>
          ))}
        </div>
      )}

      {blocked && (
        <div className="mt-4 flex items-center justify-between gap-3 border-t border-current/10 pt-3">
          <p className="text-xs opacity-80">
            先把旧规格退回草稿，再用当前需求、方案和补齐结果重新生成规格。
          </p>
          <button
            onClick={onRepair}
            disabled={repairing}
            className="shrink-0 rounded-lg bg-red-600 px-4 py-2 text-xs font-medium text-white hover:bg-red-700 disabled:bg-gray-300"
          >
            {repairing ? '修复中...' : isFrozen ? '解冻并重建规格' : '重新生成规格'}
          </button>
        </div>
      )}
    </div>
  );
}

function GateCount({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-[52px] rounded-lg bg-white/70 px-2 py-1 border border-current/10">
      <div className="font-semibold">{value}</div>
      <div className="opacity-70">{label}</div>
    </div>
  );
}

// ── Tab Components ──

function OverviewTab({ spec }: { spec: SpecData }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="版本" value={`v${spec.version || 1}`} color="blue" />
        <StatCard
          label="估算费用"
          value={spec.estimatedCostRmb ? `¥${spec.estimatedCostRmb.toLocaleString()}` : '待估算'}
          color="green"
        />
        <StatCard
          label="估算周期"
          value={spec.estimatedDays ? `${spec.estimatedDays} 天` : '待估算'}
          color="purple"
        />
      </div>

      <Section title="目标用户">
        <ul className="list-disc list-inside text-sm text-gray-700 space-y-1">
          {(spec.targetUsers || []).map((u, i) => (
            <li key={i}><strong>{u.role}</strong> — {u.description}</li>
          ))}
          {(!spec.targetUsers || spec.targetUsers.length === 0) && <EmptyHint />}
        </ul>
      </Section>

      <Section title="主要风险">
        <div className="space-y-2">
          {(spec.primaryRisks || []).map((r, i) => (
            <div key={i} className={`p-3 rounded-lg text-sm ${
              r.severity === 'high' ? 'bg-red-50 border border-red-200 text-red-800' :
              r.severity === 'medium' ? 'bg-amber-50 border border-amber-200 text-amber-800' :
              'bg-gray-50 border border-gray-200 text-gray-700'
            }`}>
              <strong>{r.name}</strong>
              <span className={`ml-2 text-xs px-1.5 py-0.5 rounded ${
                r.severity === 'high' ? 'bg-red-200' : r.severity === 'medium' ? 'bg-amber-200' : 'bg-gray-200'
              }`}>{r.severity === 'high' ? '高' : r.severity === 'medium' ? '中' : '低'}</span>
              <p className="mt-1 text-xs opacity-80">{r.description}</p>
            </div>
          ))}
          {(!spec.primaryRisks || spec.primaryRisks.length === 0) && <EmptyHint />}
        </div>
      </Section>
    </div>
  );
}

function FunctionsTab({ spec }: { spec: SpecData }) {
  const mustHave = (spec.coreFunctions || []).filter(f => f.priority === 'must');
  const niceToHave = (spec.coreFunctions || []).filter(f => f.priority === 'nice');
  const later = (spec.coreFunctions || []).filter(f => f.priority === 'later');

  return (
    <div className="space-y-6">
      <FunctionGroup title="第一版必须有" items={mustHave} color="blue" />
      <FunctionGroup title="最好有" items={niceToHave} color="green" />
      <FunctionGroup title="以后再做" items={later} color="gray" />

      <Section title="暂不做的功能">
        <ul className="list-disc list-inside text-sm text-gray-600 space-y-1">
          {(spec.outOfScope || []).map((o, i) => (
            <li key={i}><strong>{o.name}</strong> — {o.reason}</li>
          ))}
          {(!spec.outOfScope || spec.outOfScope.length === 0) && <EmptyHint />}
        </ul>
      </Section>
    </div>
  );
}

function FunctionGroup({ title, items, color }: { title: string; items: CoreFunction[]; color: string }) {
  if (items.length === 0) return null;
  const colorMap: Record<string, string> = {
    blue: 'border-blue-200 bg-blue-50',
    green: 'border-green-200 bg-green-50',
    gray: 'border-gray-200 bg-gray-50',
  };
  return (
    <div className={`p-4 rounded-xl border ${colorMap[color]}`}>
      <h3 className="text-sm font-semibold text-gray-800 mb-3">{title} ({items.length})</h3>
      <div className="space-y-2">
        {items.map((f, i) => (
          <div key={i} className="p-3 bg-white rounded-lg border border-gray-100">
            <p className="text-sm font-medium text-gray-900">{f.name}</p>
            <p className="text-xs text-gray-500 mt-1">{f.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function PagesTab({ spec }: { spec: SpecData }) {
  return (
    <div className="space-y-3">
      {(spec.pages || []).map((p, i) => (
        <div key={i} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-100">
          <div className="w-8 h-8 bg-blue-100 text-blue-700 rounded-lg flex items-center justify-center text-xs font-bold">
            {i + 1}
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-gray-900">{p.name}</p>
            <p className="text-xs text-gray-500">{p.route}</p>
          </div>
          <p className="text-xs text-gray-400 max-w-[200px] truncate">{p.description}</p>
        </div>
      ))}
      {(!spec.pages || spec.pages.length === 0) && <EmptyHint />}
    </div>
  );
}

function RolesTab({ spec }: { spec: SpecData }) {
  return (
    <div className="space-y-4">
      {(spec.roles || []).map((r, i) => (
        <div key={i} className="p-4 bg-gray-50 rounded-lg border border-gray-100">
          <h4 className="text-sm font-semibold text-gray-900 mb-2">{r.name}</h4>
          <div className="flex flex-wrap gap-1.5">
            {(r.permissions || []).map((perm, j) => (
              <span key={j} className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-medium">
                {perm === 'view' ? '查看' : perm === 'edit' ? '编辑' : perm === 'delete' ? '删除' : perm}
              </span>
            ))}
          </div>
        </div>
      ))}
      {(!spec.roles || spec.roles.length === 0) && <EmptyHint />}
    </div>
  );
}

function DataTab({ spec }: { spec: SpecData }) {
  return (
    <div className="space-y-4">
      {(spec.dataModels || []).map((dm, i) => (
        <div key={i} className="border border-gray-200 rounded-lg overflow-hidden">
          <div className="bg-gray-50 px-4 py-2 border-b border-gray-200">
            <span className="text-sm font-semibold text-gray-900">{dm.name}</span>
          </div>
          <div className="divide-y divide-gray-100">
            {(dm.fields || []).map((f, j) => (
              <div key={j} className="px-4 py-2 flex items-center gap-3 text-sm">
                <span className="font-medium text-gray-800 w-32">{f.name}</span>
                <span className="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded font-mono">{f.type}</span>
                {f.required && <span className="text-xs text-red-500">必填</span>}
              </div>
            ))}
          </div>
        </div>
      ))}
      {(!spec.dataModels || spec.dataModels.length === 0) && <EmptyHint />}
    </div>
  );
}

function RulesTab({ spec }: { spec: SpecData }) {
  return (
    <div className="space-y-3">
      {(spec.businessRules || []).map((r, i) => (
        <div key={i} className="p-4 bg-gray-50 rounded-lg border border-gray-100">
          <h4 className="text-sm font-semibold text-gray-900">{r.name}</h4>
          <p className="text-xs text-gray-600 mt-1">{r.description}</p>
          <div className="mt-2 flex gap-3 text-xs">
            <span className="text-blue-600">
              <span className="text-gray-400">触发：</span>{r.trigger}
            </span>
            <span className="text-green-600">
              <span className="text-gray-400">结果：</span>{r.outcome}
            </span>
          </div>
        </div>
      ))}
      {(!spec.businessRules || spec.businessRules.length === 0) && <EmptyHint />}
    </div>
  );
}

function AcceptanceTab({ spec }: { spec: SpecData }) {
  return (
    <div className="space-y-3">
      {(spec.acceptanceScenarios || []).map((s, i) => (
        <div key={i} className="p-4 border border-gray-200 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
              s.priority === 'must' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'
            }`}>
              {s.priority === 'must' ? '必须通过' : '建议通过'}
            </span>
            <span className="text-sm font-semibold text-gray-900">{s.name}</span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div>
              <span className="text-gray-400 block">前置条件</span>
              <span className="text-gray-700">{s.given || '—'}</span>
            </div>
            <div>
              <span className="text-gray-400 block">操作</span>
              <span className="text-gray-700">{s.when || '—'}</span>
            </div>
            <div>
              <span className="text-gray-400 block">预期结果</span>
              <span className="text-green-700">{s.then || '—'}</span>
            </div>
          </div>
        </div>
      ))}
      {(!spec.acceptanceScenarios || spec.acceptanceScenarios.length === 0) && <EmptyHint />}
    </div>
  );
}

// ── Shared Components ──

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  const borderMap: Record<string, string> = {
    blue: 'border-blue-200 bg-blue-50',
    green: 'border-green-200 bg-green-50',
    purple: 'border-purple-200 bg-purple-50',
  };
  const textMap: Record<string, string> = {
    blue: 'text-blue-700',
    green: 'text-green-700',
    purple: 'text-purple-700',
  };
  return (
    <div className={`p-4 rounded-xl border ${borderMap[color]}`}>
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-lg font-bold mt-1 ${textMap[color]}`}>{value}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-800 mb-2">{title}</h3>
      {children}
    </div>
  );
}

function EmptyHint() {
  return <p className="text-xs text-gray-400 italic">暂无数据，可在方案阶段补充后重新生成</p>;
}
