export type SpecificationGateStatus = 'pass' | 'warn' | 'fail';

export type RequiredSpecSlotKey =
  | 'roles'
  | 'coreFunctions'
  | 'dataModels'
  | 'businessRules'
  | 'acceptanceScenarios';

export type AdvisorySpecSlotKey = 'pages';
export type SpecSlotKey = RequiredSpecSlotKey | AdvisorySpecSlotKey;

export interface SpecificationGateSlot {
  key: SpecSlotKey;
  label: string;
  count: number;
  ok: boolean;
  required: boolean;
}

export interface SpecificationGateEvaluation {
  exists: boolean;
  status: SpecificationGateStatus;
  contentStatus: SpecificationGateStatus;
  deliveryStatus: SpecificationGateStatus;
  readyToFreeze: boolean;
  frozen: boolean;
  version: number | null;
  specStatus: string | null;
  frozenAt: string | null;
  summary: string;
  deliverySummary: string;
  freezeMessage: string;
  counts: Record<SpecSlotKey, number>;
  requiredGaps: string[];
  advisoryGaps: string[];
  gaps: string[];
  requiredSlots: SpecificationGateSlot[];
  advisorySlots: SpecificationGateSlot[];
}

interface SpecificationLike {
  version?: number | null;
  status?: string | null;
  frozenAt?: Date | string | null;
  roles?: unknown;
  coreFunctions?: unknown;
  dataModels?: unknown;
  businessRules?: unknown;
  acceptanceScenarios?: unknown;
  pages?: unknown;
}

const REQUIRED_SLOTS: Array<{ key: RequiredSpecSlotKey; label: string }> = [
  { key: 'roles', label: '角色' },
  { key: 'coreFunctions', label: '核心功能' },
  { key: 'dataModels', label: '数据对象' },
  { key: 'businessRules', label: '业务规则' },
  { key: 'acceptanceScenarios', label: '验收场景' },
];

const ADVISORY_SLOTS: Array<{ key: AdvisorySpecSlotKey; label: string }> = [
  { key: 'pages', label: '页面清单' },
];

export function evaluateSpecificationGate(spec: SpecificationLike | null | undefined): SpecificationGateEvaluation {
  if (!spec) {
    const counts = emptyCounts();
    return {
      exists: false,
      status: 'fail',
      contentStatus: 'fail',
      deliveryStatus: 'fail',
      readyToFreeze: false,
      frozen: false,
      version: null,
      specStatus: null,
      frozenAt: null,
      summary: '未生成规格',
      deliverySummary: '未生成规格',
      freezeMessage: '规格冻结门未通过：尚未生成规格。',
      counts,
      requiredGaps: REQUIRED_SLOTS.map((s) => `${s.label}为空`),
      advisoryGaps: ADVISORY_SLOTS.map((s) => `${s.label}为空`),
      gaps: [...REQUIRED_SLOTS.map((s) => `${s.label}为空`), ...ADVISORY_SLOTS.map((s) => `${s.label}为空`)],
      requiredSlots: REQUIRED_SLOTS.map((s) => ({ ...s, count: 0, ok: false, required: true })),
      advisorySlots: ADVISORY_SLOTS.map((s) => ({ ...s, count: 0, ok: false, required: false })),
    };
  }

  const counts: Record<SpecSlotKey, number> = {
    roles: countMeaningfulItems('roles', spec.roles),
    coreFunctions: countMeaningfulItems('coreFunctions', spec.coreFunctions),
    dataModels: countMeaningfulItems('dataModels', spec.dataModels),
    businessRules: countMeaningfulItems('businessRules', spec.businessRules),
    acceptanceScenarios: countMeaningfulItems('acceptanceScenarios', spec.acceptanceScenarios),
    pages: countMeaningfulItems('pages', spec.pages),
  };
  const requiredSlots = REQUIRED_SLOTS.map((s) => ({
    ...s,
    count: counts[s.key],
    ok: counts[s.key] > 0,
    required: true,
  }));
  const advisorySlots = ADVISORY_SLOTS.map((s) => ({
    ...s,
    count: counts[s.key],
    ok: counts[s.key] > 0,
    required: false,
  }));
  const requiredGaps = requiredSlots.filter((s) => !s.ok).map((s) => `${s.label}为空`);
  const advisoryGaps = advisorySlots.filter((s) => !s.ok).map((s) => `${s.label}为空`);
  const readyToFreeze = requiredGaps.length === 0;
  const frozen = spec.status === 'frozen';
  const contentStatus: SpecificationGateStatus = requiredGaps.length > 0 ? 'fail' : advisoryGaps.length > 0 ? 'warn' : 'pass';
  const deliveryStatus: SpecificationGateStatus = requiredGaps.length > 0
    ? 'fail'
    : !frozen
      ? 'fail'
      : advisoryGaps.length > 0
        ? 'warn'
        : 'pass';
  const version = typeof spec.version === 'number' ? spec.version : null;
  const specStatus = spec.status ?? null;
  const frozenAt = toIsoOrNull(spec.frozenAt);
  const summary = requiredGaps.length > 0
    ? `规格内容不完整，缺 ${requiredGaps.length} 项`
    : advisoryGaps.length > 0
      ? `核心内容齐全，建议补充 ${advisoryGaps.length} 项`
      : '规格内容齐全，可以冻结';
  const deliverySummary = buildDeliverySummary({
    version,
    specStatus,
    frozenAt,
    frozen,
    requiredGaps,
    advisoryGaps,
  });
  const freezeMessage = buildFreezeMessage(requiredGaps);

  return {
    exists: true,
    status: contentStatus,
    contentStatus,
    deliveryStatus,
    readyToFreeze,
    frozen,
    version,
    specStatus,
    frozenAt,
    summary,
    deliverySummary,
    freezeMessage,
    counts,
    requiredGaps,
    advisoryGaps,
    gaps: [...requiredGaps, ...advisoryGaps],
    requiredSlots,
    advisorySlots,
  };
}

function buildDeliverySummary(args: {
  version: number | null;
  specStatus: string | null;
  frozenAt: string | null;
  frozen: boolean;
  requiredGaps: string[];
  advisoryGaps: string[];
}) {
  const prefix = `v${args.version ?? '-'} · ${args.specStatus ?? 'unknown'}${args.frozenAt ? ` · frozenAt ${args.frozenAt}` : ''}`;
  if (args.requiredGaps.length > 0) return `${prefix} · 规格内容不完整，缺 ${args.requiredGaps.length} 项`;
  if (!args.frozen) return `${prefix} · 内容齐全但尚未冻结确认`;
  if (args.advisoryGaps.length > 0) return `${prefix} · 已冻结，建议补充 ${args.advisoryGaps.length} 项`;
  return `${prefix} · 规格冻结门通过`;
}

function buildFreezeMessage(requiredGaps: string[]) {
  if (requiredGaps.length === 0) return '规格冻结门已通过，可以确认规格。';
  return `规格冻结门未通过，不能确认。还缺：${requiredGaps.join('、')}。请回到访谈/方案补齐，或重新生成规格。`;
}

function countMeaningfulItems(slot: SpecSlotKey, value: unknown): number {
  return asArray(value).filter((item) => isMeaningfulItem(slot, item)).length;
}

function isMeaningfulItem(slot: SpecSlotKey, item: unknown): boolean {
  if (hasText(item)) return true;
  const record = asRecord(item);
  if (!record) return false;
  if (slot === 'roles') {
    return hasText(record.name) || hasText(record.role) || asArray(record.permissions).length > 0;
  }
  if (slot === 'coreFunctions') {
    return hasText(record.name) || hasText(record.description);
  }
  if (slot === 'dataModels') {
    return hasText(record.name);
  }
  if (slot === 'businessRules') {
    return hasText(record.name) || hasText(record.description) || hasText(record.trigger) || hasText(record.outcome);
  }
  if (slot === 'acceptanceScenarios') {
    return hasText(record.name) || hasText(record.given) || hasText(record.when) || hasText(record.then);
  }
  return hasText(record.name) || hasText(record.route) || hasText(record.description);
}

function emptyCounts(): Record<SpecSlotKey, number> {
  return {
    roles: 0,
    coreFunctions: 0,
    dataModels: 0,
    businessRules: 0,
    acceptanceScenarios: 0,
    pages: 0,
  };
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function hasText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function toIsoOrNull(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}
