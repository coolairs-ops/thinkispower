import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { assertResourceAccess } from '../../common/utils/tenant-scope';
import { disposeGap, type GapAction } from '../../sensors/gap-disposition';
import { inferFulfillment } from '../../sensors/capability-provenance';

export type RequirementCategory =
  | 'external_interface'
  | 'existing_tool_or_skill'
  | 'backend_capability'
  | 'generator_capability'
  | 'manual_decision';

export interface CapabilityMatchingHints {
  query: string;
  topics: string[];
  suggestedKeywords: string[];
  mustHaveCapabilities: string[];
}

export type GithubSearchPlan = CapabilityMatchingHints;

export interface UnresolvedRequirementItem {
  id: string;
  title: string;
  description: string;
  source: 'routed_gap' | 'stuck_recommendation';
  sourceRecommendation: string;
  category: RequirementCategory;
  solutionRouteLabel: string;
  action: GapAction | 'stuck-generator';
  channel: string;
  customerAction: string;
  reason: string;
  matchingHints: CapabilityMatchingHints;
  acceptanceCriteria: string[];
  integrationNotes: string[];
}

export interface CapabilityModuleCandidate {
  id: string;
  moduleKey: string;
  title: string;
  category: RequirementCategory;
  solutionRouteLabel: string;
  requirementIds: string[];
  description: string;
  whyConverge: string;
  selectionPolicy: 'pending_user_selection';
  matchingHints: CapabilityMatchingHints;
  acceptanceCriteria: string[];
  integrationNotes: string[];
}

export interface UnresolvedRequirementsDocument {
  project: {
    id: string;
    name: string;
    description: string | null;
  };
  generatedAt: string;
  source: {
    taskId: string | null;
    status: string;
    statusText: string | null;
    terminalType: string | null;
    terminalMessage: string | null;
    round: number;
    score: number;
    rounds: number;
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
  collectionPolicy: {
    mode: 'document_first';
    immediateOnlineFetch: false;
    selectionOwner: 'user';
    convergenceRule: string;
  };
  moduleCandidates: CapabilityModuleCandidate[];
  requirements: UnresolvedRequirementItem[];
  markdown: string;
}

interface ProjectForUnresolvedDoc {
  id: string;
  name: string;
  description: string | null;
  autoIterateState: unknown;
}

@Injectable()
export class UnresolvedRequirementsService {
  constructor(private readonly prisma: PrismaService) {}

  async getForUser(userId: string, orgId: string | null, projectId: string): Promise<UnresolvedRequirementsDocument> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        name: true,
        description: true,
        userId: true,
        orgId: true,
        autoIterateState: true,
      },
    });
    if (!project) throw new NotFoundException('项目不存在');
    assertResourceAccess(project, userId, orgId);
    return buildUnresolvedRequirementsDocument(project);
  }
}

export function buildUnresolvedRequirementsDocument(project: ProjectForUnresolvedDoc): UnresolvedRequirementsDocument {
  const state = asRecord(project.autoIterateState);
  const terminal = asRecord(state.terminal);
  const routedGaps = uniqueRecords([
    ...asArray(state.routedGaps),
    ...asArray(terminal.routedGaps),
  ]);
  const latestRecommendations = collectStuckRecommendations(state);
  const used = new Set<string>();
  const requirements: UnresolvedRequirementItem[] = [];

  for (const gap of routedGaps) {
    const record = asRecord(gap);
    const recommendation = cleanText(record.recommendation) || cleanText(record.title) || cleanText(record.description);
    if (!recommendation || isDiagnosticNoise(recommendation)) continue;
    const key = normalizeKey(recommendation);
    if (used.has(key)) continue;
    used.add(key);

    const action = asGapAction(record.action) ?? disposeGap(inferFulfillment(recommendation)).action;
    const category = classifyRequirement(action, recommendation, 'routed_gap');
    requirements.push(makeRequirementItem({
      index: requirements.length + 1,
      recommendation,
      source: 'routed_gap',
      category,
      action,
      channel: cleanText(record.channel) || defaultChannel(action),
      customerAction: cleanText(record.customerAction) || defaultCustomerAction(category),
      reason: cleanText(record.reason) || disposeGap(inferFulfillment(recommendation)).reason,
    }));
  }

  for (const recommendation of latestRecommendations) {
    const key = normalizeKey(recommendation);
    if (used.has(key)) continue;
    used.add(key);

    const inferred = disposeGap(inferFulfillment(recommendation));
    const action: UnresolvedRequirementItem['action'] =
      inferred.action === 'auto-iterate' ? 'stuck-generator' : inferred.action;
    const category = classifyRequirement(action, recommendation, 'stuck_recommendation');
    requirements.push(makeRequirementItem({
      index: requirements.length + 1,
      recommendation,
      source: 'stuck_recommendation',
      category,
      action,
      channel: action === 'stuck-generator' ? 'skill-market' : inferred.channel,
      customerAction: action === 'stuck-generator'
        ? '建议匹配开源工具 / skill，或沉淀为平台生成器能力'
        : inferred.customerAction,
      reason: action === 'stuck-generator'
        ? `连续自迭代仍未改善，需外部工具或生成器能力补强；${inferred.reason}`
        : inferred.reason,
    }));
  }

  const source = {
    taskId: cleanText(state.taskId) || null,
    status: cleanText(state.status) || 'idle',
    statusText: cleanText(state.statusText) || null,
    terminalType: cleanText(terminal.type) || null,
    terminalMessage: cleanText(terminal.message) || null,
    round: toInt(state.round),
    score: toInt(state.score),
    rounds: asArray(state.rounds).length,
  };

  const moduleCandidates = buildModuleCandidates(requirements);
  const summary = summarize(requirements, moduleCandidates);
  const doc: UnresolvedRequirementsDocument = {
    project: { id: project.id, name: project.name, description: project.description },
    generatedAt: new Date().toISOString(),
    source,
    summary,
    collectionPolicy: {
      mode: 'document_first',
      immediateOnlineFetch: false,
      selectionOwner: 'user',
      convergenceRule: '生成子体时只沉淀缺口，不自动联网下载或接入工具；同类缺口先归并为模块候选，由用户统一选型后再进入 Hermes/平台能力库。',
    },
    moduleCandidates,
    requirements,
    markdown: '',
  };
  doc.markdown = renderUnresolvedRequirementsMarkdown(doc);
  return doc;
}

export function renderUnresolvedRequirementsMarkdown(doc: Omit<UnresolvedRequirementsDocument, 'markdown'>): string {
  const lines: string[] = [];
  lines.push('# 未解决需求收敛文档');
  lines.push('');
  lines.push(`- 项目：${doc.project.name} (${doc.project.id})`);
  lines.push(`- 生成时间：${doc.generatedAt}`);
  lines.push(`- 自迭代状态：${doc.source.status}${doc.source.statusText ? ` · ${doc.source.statusText}` : ''}`);
  lines.push(`- 轮次/分数：${doc.source.round} / ${doc.source.score}`);
  lines.push(`- 汇总：${doc.summary.total} 个原子缺口，收敛为 ${doc.summary.moduleCandidateCount} 个模块候选；外部接口 ${doc.summary.externalInterfaceCount} 项；开源工具/skill ${doc.summary.existingToolOrAgentCount} 项；后端能力 ${doc.summary.backendCapabilityCount} 项；生成器能力 ${doc.summary.generatorCapabilityCount} 项；人工决策 ${doc.summary.manualDecisionCount} 项`);
  lines.push('');
  lines.push('## 收敛原则');
  lines.push('- 子体生成过程中只记录 LLM 无法稳定闭合的缺口，不在生成现场自动联网下载或接入工具。');
  lines.push('- 同类缺口先合并为模块候选，避免十几个子需求变成十几个孤立依赖。');
  lines.push('- 用户先基于模块候选做 GitHub / agent / skill 选型，再由平台把选中的能力接入 Hermes 编排和交付包。');
  lines.push(`- 当前规则：${doc.collectionPolicy.convergenceRule}`);
  lines.push('');
  lines.push('## 处理建议');
  lines.push(doc.summary.recommendation);
  lines.push('');

  if (doc.requirements.length === 0) {
    lines.push('## 缺口清单');
    lines.push('当前没有可汇总的未解决需求。');
    return lines.join('\n');
  }

  if (doc.moduleCandidates.length > 0) {
    lines.push('## 模块候选');
    lines.push('| 模块 | 类型 | 覆盖缺口 | 建议路线 | 统一匹配输入 |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const mod of doc.moduleCandidates) {
      lines.push(`| ${mod.id} ${escapeTable(mod.title)} | ${categoryLabel(mod.category)} | ${mod.requirementIds.join(', ')} | ${escapeTable(mod.solutionRouteLabel)} | \`${escapeBackticks(mod.matchingHints.query)}\` |`);
    }

    lines.push('');
    lines.push('## 模块详情');
    for (const mod of doc.moduleCandidates) {
      lines.push('');
      lines.push(`### ${mod.id} ${mod.title}`);
      lines.push(`- 覆盖缺口：${mod.requirementIds.join('、')}`);
      lines.push(`- 收敛原因：${mod.whyConverge}`);
      lines.push(`- 匹配输入：\`${mod.matchingHints.query}\``);
      lines.push(`- 推荐关键词：${mod.matchingHints.suggestedKeywords.join('、') || '暂无'}`);
      lines.push(`- 必备能力：${mod.matchingHints.mustHaveCapabilities.join('；') || '暂无'}`);
      lines.push('- 模块验收标准：');
      for (const criterion of mod.acceptanceCriteria) lines.push(`  - ${criterion}`);
      lines.push('- 接入说明：');
      for (const note of mod.integrationNotes) lines.push(`  - ${note}`);
    }
    lines.push('');
  }

  lines.push('## 原子缺口清单');
  lines.push('| ID | 类型 | 缺口 | 建议路线 | 所属模块 |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const item of doc.requirements) {
    const moduleId = doc.moduleCandidates.find((m) => m.requirementIds.includes(item.id))?.id ?? '未归并';
    lines.push(`| ${item.id} | ${categoryLabel(item.category)} | ${escapeTable(item.title)} | ${escapeTable(item.solutionRouteLabel)} | ${moduleId} |`);
  }

  lines.push('');
  lines.push('## 原子需求详情');
  for (const item of doc.requirements) {
    lines.push('');
    lines.push(`### ${item.id} ${item.title}`);
    lines.push(`- 类型：${categoryLabel(item.category)}`);
    lines.push(`- 来源：${item.source === 'routed_gap' ? '能力分流缺口' : '自迭代停滞建议'}`);
    lines.push(`- 建议路线：${item.solutionRouteLabel}`);
    lines.push(`- 原始建议：${item.sourceRecommendation}`);
    lines.push(`- 分流原因：${item.reason}`);
    lines.push(`- 匹配线索：${item.matchingHints.suggestedKeywords.join('、') || '暂无'}`);
    lines.push('- 验收标准：');
    for (const criterion of item.acceptanceCriteria) lines.push(`  - ${criterion}`);
    lines.push('- 接入说明：');
    for (const note of item.integrationNotes) lines.push(`  - ${note}`);
  }

  return lines.join('\n');
}

function makeRequirementItem(args: {
  index: number;
  recommendation: string;
  source: UnresolvedRequirementItem['source'];
  category: RequirementCategory;
  action: UnresolvedRequirementItem['action'];
  channel: string;
  customerAction: string;
  reason: string;
}): UnresolvedRequirementItem {
  const title = titleFromRecommendation(args.recommendation);
  const matchingHints = buildMatchingHints(args.recommendation, args.category, args.action);
  return {
    id: `REQ-${String(args.index).padStart(3, '0')}`,
    title,
    description: args.recommendation,
    source: args.source,
    sourceRecommendation: args.recommendation,
    category: args.category,
    solutionRouteLabel: solutionRouteLabel(args.category, args.action),
    action: args.action,
    channel: args.channel,
    customerAction: args.customerAction,
    reason: args.reason,
    matchingHints,
    acceptanceCriteria: buildAcceptanceCriteria(args.category, args.recommendation),
    integrationNotes: buildIntegrationNotes(args.category, args.recommendation),
  };
}

function collectStuckRecommendations(state: Record<string, unknown>): string[] {
  const terminal = asRecord(state.terminal);
  const terminalType = cleanText(terminal.type);
  const status = cleanText(state.status);
  const isBlocked = ['stuck', 'needs_human', 'routed_stop'].includes(terminalType)
    || ['awaiting_decision', 'needs_human', 'error', 'interrupted'].includes(status);
  if (!isBlocked) return [];

  const rounds = asArray<Record<string, unknown>>(state.rounds);
  const recent = rounds.slice(-3).flatMap((round) => asArray(round.recommendations));
  const result: string[] = [];
  for (const rec of recent) {
    const text = cleanText(rec);
    if (!text || isDiagnosticNoise(text)) continue;
    if (!result.some((r) => normalizeKey(r) === normalizeKey(text))) result.push(text);
  }
  return result.slice(0, 20);
}

function isDiagnosticNoise(text: string): boolean {
  const title = titleFromRecommendation(text);
  return /整体质量|通过率|评分/u.test(text)
    || /^\d{1,3}\s*\/\s*100$/u.test(text)
    || /^\d{1,3}%$/u.test(text)
    || /^score\s*[:：]?\s*\d+/iu.test(text)
    || (title !== text && isDiagnosticNoise(title));
}

function summarize(
  requirements: UnresolvedRequirementItem[],
  moduleCandidates: CapabilityModuleCandidate[],
): UnresolvedRequirementsDocument['summary'] {
  const externalInterfaceCount = requirements.filter((r) => r.category === 'external_interface').length;
  const existingToolOrAgentCount = requirements.filter((r) => r.category === 'existing_tool_or_skill').length;
  const backendCapabilityCount = requirements.filter((r) => r.category === 'backend_capability').length;
  const generatorCapabilityCount = requirements.filter((r) => r.category === 'generator_capability').length;
  const manualDecisionCount = requirements.filter((r) => r.category === 'manual_decision').length;
  const total = requirements.length;
  const moduleCandidateCount = moduleCandidates.length;
  return {
    total,
    moduleCandidateCount,
    externalInterfaceCount,
    existingToolOrAgentCount,
    backendCapabilityCount,
    generatorCapabilityCount,
    manualDecisionCount,
    recommendation: total === 0
      ? '当前没有沉淀出 LLM 无法闭合的需求。可以继续按现有交付流程推进。'
      : `不要在子体生成时逐条联网找补。建议先把 ${total} 个原子缺口收敛为 ${moduleCandidateCount} 个模块候选，再由用户统一选择开源工具、agent、skill 或平台自研模块。`,
  };
}

function buildModuleCandidates(requirements: UnresolvedRequirementItem[]): CapabilityModuleCandidate[] {
  const grouped = new Map<string, UnresolvedRequirementItem[]>();
  for (const item of requirements) {
    const key = inferModuleKey(item);
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }

  return [...grouped.entries()].map(([moduleKey, items], index) => {
    const category = dominantCategory(items);
    const text = items.map((i) => i.sourceRecommendation).join('；');
    const action = items.find((i) => i.action !== 'stuck-generator')?.action ?? items[0]?.action ?? 'stuck-generator';
    const title = moduleTitle(moduleKey);
    const matchingHints = buildMatchingHints(text, category, action);
    return {
      id: `MOD-${String(index + 1).padStart(3, '0')}`,
      moduleKey,
      title,
      category,
      solutionRouteLabel: solutionRouteLabel(category, action),
      requirementIds: items.map((i) => i.id),
      description: moduleDescription(moduleKey, items),
      whyConverge: `这些缺口都指向“${title}”这类可复用能力，应作为统一模块选型/建设，而不是散落到单个生成子体里。`,
      selectionPolicy: 'pending_user_selection',
      matchingHints,
      acceptanceCriteria: buildModuleAcceptanceCriteria(moduleKey, items),
      integrationNotes: buildModuleIntegrationNotes(category),
    };
  });
}

function inferModuleKey(item: UnresolvedRequirementItem): string {
  const text = `${item.title} ${item.sourceRecommendation}`;
  if (/(PDF|pdf|OCR|文档|文件|附件|Excel|xlsx|表格|结构化|知识库|知识|抽取|识别)/iu.test(text)) return 'document-knowledge-ingestion';
  if (/(问数|自然语言|查询|指标|口径|计算|经营分析|分析建议|BI|报表|看板|dashboard|KPI)/iu.test(text)) return 'analytics-query';
  if (/(接口|API|对接|同步|外部系统|ERP|CRM|Webhook|金蝶|用友|风险分析软件)/iu.test(text)) return 'external-integration';
  if (/(权限|角色|部门|RBAC|数据权限|数据隔离|鉴权|登录|SSO|OAuth|会话|session)/iu.test(text)) return 'identity-access';
  if (/(审批|流程|工作流|流转|审核|节点)/iu.test(text)) return 'workflow-approval';
  if (/(导入|导出|批量|ETL|清洗|映射|错误行)/iu.test(text)) return 'data-import-export';
  if (item.category === 'external_interface') return 'external-integration';
  if (item.category === 'backend_capability') return 'backend-foundation';
  if (item.category === 'generator_capability') return 'generator-extension';
  return 'general-tool-skill';
}

function dominantCategory(items: UnresolvedRequirementItem[]): RequirementCategory {
  const priority: RequirementCategory[] = [
    'external_interface',
    'existing_tool_or_skill',
    'backend_capability',
    'generator_capability',
    'manual_decision',
  ];
  return priority.find((category) => items.some((item) => item.category === category)) ?? 'generator_capability';
}

function moduleTitle(key: string): string {
  switch (key) {
    case 'document-knowledge-ingestion': return '文档结构化与知识库接入模块';
    case 'analytics-query': return '智能问数与指标分析模块';
    case 'external-integration': return '外部系统接口适配模块';
    case 'identity-access': return '身份、权限与数据范围模块';
    case 'workflow-approval': return '审批流与工作流模块';
    case 'data-import-export': return '数据导入导出模块';
    case 'backend-foundation': return '后端底座能力模块';
    case 'generator-extension': return '生成器能力扩展模块';
    default: return '通用工具/skill 补强模块';
  }
}

function moduleDescription(key: string, items: UnresolvedRequirementItem[]): string {
  const sample = items.slice(0, 3).map((i) => i.title).join('；');
  return `${moduleTitle(key)}用于统一承接 ${items.length} 个缺口：${sample}${items.length > 3 ? '；...' : ''}`;
}

function buildModuleAcceptanceCriteria(moduleKey: string, items: UnresolvedRequirementItem[]): string[] {
  return [
    `覆盖 ${items.length} 个原子缺口：${items.map((i) => i.id).join('、')}`,
    '作为平台级模块或 Hermes 可编排节点接入，而不是写入单个子体的临时代码',
    '提供结构化输入/输出契约，运行结果可回写需求、规格、Demo、验收或交付包',
    '具备可重复执行的验收脚本或健康检查，失败时能进入缺口文档继续收敛',
    moduleKey === 'external-integration' ? '真实接口未到位时必须先提供 mock adapter 和契约样例' : '选型完成前不阻塞当前子体生成，但不得伪造已实现状态',
  ];
}

function buildModuleIntegrationNotes(category: RequirementCategory): string[] {
  if (category === 'external_interface') {
    return ['先进入接口契约库和 mock adapter，不直接写死到子体', '用户选定真实系统/接口文档后，再接入 Hermes 编排节点'];
  }
  if (category === 'existing_tool_or_skill') {
    return ['GitHub/agent/skill 匹配发生在模块候选层，而不是每个缺口逐条搜索', '选中后沉淀为平台能力库条目，后续子体按能力调用'];
  }
  if (category === 'backend_capability') {
    return ['优先沉淀为若依或平台后端标准能力', '置备状态必须写入 backendRuntime 并纳入上线门'];
  }
  if (category === 'generator_capability') {
    return ['沉淀为可测试的生成器 block/template/skill', '补传感器和回归测试，保证后续生成稳定复用'];
  }
  return ['先由用户确认是否进入本期范围', '确认后再进入模块选型或平台能力建设'];
}

function classifyRequirement(
  action: UnresolvedRequirementItem['action'],
  text: string,
  source: UnresolvedRequirementItem['source'],
): RequirementCategory {
  if (action === 'external-adapter') return 'external_interface';
  if (action === 'out-of-scope') return 'manual_decision';
  if (action === 'extend-generator') return 'generator_capability';
  if (action === 'stuck-generator') return likelyToolOrAgent(text) ? 'existing_tool_or_skill' : 'generator_capability';
  if (action === 'backend-provision') return likelyToolOrAgent(text) ? 'existing_tool_or_skill' : 'backend_capability';
  if (source === 'stuck_recommendation') return 'existing_tool_or_skill';
  return 'generator_capability';
}

function likelyToolOrAgent(text: string): boolean {
  return /(Excel|xlsx|导入|导出|权限|角色|部门|RBAC|看板|统计|报表|筛选|搜索|登录|认证|同步|接口|API|OCR|PDF|文档|知识库|问数|BI|支付|短信|邮件|地图|工作流|审批)/iu.test(text);
}

function buildMatchingHints(
  text: string,
  category: RequirementCategory,
  action: UnresolvedRequirementItem['action'],
): CapabilityMatchingHints {
  const rules: Array<{ re: RegExp; topics: string[]; keywords: string[]; capabilities: string[] }> = [
    {
      re: /(PDF|pdf|OCR|文档|文件|附件|结构化|知识库|知识|抽取|识别)/iu,
      topics: ['document-ai', 'ocr', 'knowledge-base', 'etl', 'rag'],
      keywords: ['document intelligence', 'pdf table extraction', 'ocr pipeline', 'knowledge base ingestion'],
      capabilities: ['支持 PDF/Excel/文档解析与结构化抽取', '支持本地知识库或向量库接入', '输出可追溯到原文位置或文件来源'],
    },
    {
      re: /(问数|自然语言|指标|口径|经营分析|组合查询|计算|BI|报表|看板|dashboard|KPI)/iu,
      topics: ['natural-language-query', 'text-to-sql', 'analytics', 'bi-agent'],
      keywords: ['text to sql', 'natural language query', 'nlq-bot', 'BI assistant'],
      capabilities: ['支持自然语言到指标/SQL/查询计划', '支持权限约束下的数据查询', '能解释口径和引用数据来源'],
    },
    {
      re: /(Excel|xlsx|导入|导出|批量)/iu,
      topics: ['excel-import', 'xlsx-parser', 'etl', 'data-import'],
      keywords: ['sheetjs', 'xlsx import', 'excel import tool', 'data import skill'],
      capabilities: ['支持 xlsx/csv 解析与字段映射', '提供导入校验与错误行回传', '可通过 CLI/API 调用'],
    },
    {
      re: /(权限|角色|部门|老板|经理|RBAC|数据隔离|鉴权)/iu,
      topics: ['rbac', 'policy-engine', 'data-permission', 'casbin'],
      keywords: ['casbin', 'rbac policy tool', 'data scope permission', 'ruoyi permission'],
      capabilities: ['支持角色/部门/数据范围策略', '策略可配置且可审计', '可嵌入现有后端或若依底座'],
    },
    {
      re: /(看板|统计|报表|趋势|KPI|仪表盘|dashboard)/iu,
      topics: ['dashboard', 'analytics', 'chart', 'reporting'],
      keywords: ['dashboard generator', 'analytics automation', 'report builder', 'echarts'],
      capabilities: ['支持指标口径配置', '支持聚合查询或数据源适配', '能输出前端组件或嵌入式页面'],
    },
    {
      re: /(筛选|搜索|列表|卡片|表格|分页|排序)/iu,
      topics: ['data-grid', 'faceted-filter', 'react-table', 'admin-ui'],
      keywords: ['react table filter', 'data grid automation', 'faceted search', 'admin table'],
      capabilities: ['支持筛选/排序/分页', '能绑定现有数据模型', '移动端和桌面端可用'],
    },
    {
      re: /(登录|注册|认证|SSO|OAuth|会话|session)/iu,
      topics: ['auth', 'sso', 'oauth', 'session'],
      keywords: ['auth automation', 'oauth integration', 'sso adapter', 'session management'],
      capabilities: ['支持登录态与权限态分离', '支持私有化部署', '提供清晰的回调与会话接口'],
    },
    {
      re: /(对接|同步|外部系统|第三方|ERP|CRM|Webhook|回调|快普|金蝶|用友)/iu,
      topics: ['api-connector', 'erp-integration', 'webhook', 'sync-tool'],
      keywords: ['api connector tool', 'erp sync', 'webhook adapter', 'integration skill'],
      capabilities: ['支持接口鉴权和重试', '支持增量同步与失败补偿', '提供 mock 或 sandbox 测试能力'],
    },
  ];

  const matched = rules.filter((rule) => rule.re.test(text));
  const topics = unique([
    ...matched.flatMap((r) => r.topics),
    ...categoryDefaultTopics(category),
  ]).slice(0, 8);
  const suggestedKeywords = unique([
    ...matched.flatMap((r) => r.keywords),
    ...categoryDefaultKeywords(category, action),
  ]).slice(0, 10);
  const mustHaveCapabilities = unique([
    ...matched.flatMap((r) => r.capabilities),
    ...categoryDefaultCapabilities(category),
  ]).slice(0, 8);
  const queryTerms = suggestedKeywords.slice(0, 4).join(' OR ') || titleFromRecommendation(text);
  return {
    query: `${queryTerms} language:TypeScript OR language:Python`,
    topics,
    suggestedKeywords,
    mustHaveCapabilities,
  };
}

function categoryDefaultTopics(category: RequirementCategory): string[] {
  switch (category) {
    case 'external_interface': return ['api-connector', 'adapter', 'integration'];
    case 'existing_tool_or_skill': return ['tool', 'skill', 'automation'];
    case 'backend_capability': return ['backend', 'admin-framework', 'ruoyi'];
    case 'generator_capability': return ['code-generator', 'ui-block', 'low-code'];
    case 'manual_decision': return ['requirements', 'scope-management'];
  }
}

function categoryDefaultKeywords(category: RequirementCategory, action: UnresolvedRequirementItem['action']): string[] {
  if (action === 'stuck-generator') return ['automation skill', 'code generation assistant', 'workflow automation'];
  switch (category) {
    case 'external_interface': return ['api connector', 'integration adapter'];
    case 'existing_tool_or_skill': return ['open source tool', 'codex skill', 'automation tool'];
    case 'backend_capability': return ['admin backend', 'ruoyi plugin'];
    case 'generator_capability': return ['code generator block', 'ui generator component'];
    case 'manual_decision': return ['requirements triage', 'scope decision'];
  }
}

function categoryDefaultCapabilities(category: RequirementCategory): string[] {
  switch (category) {
    case 'external_interface':
      return ['提供明确的输入/输出契约', '支持鉴权、超时、重试与错误回传', '可用 mock 数据先行验证'];
    case 'existing_tool_or_skill':
      return ['有命令行或 API 调用方式', '能私有化运行', '输入输出结构清晰，便于接入 Hermes 编排'];
    case 'backend_capability':
      return ['能被若依或平台后端置备', '提供权限和审计边界', '具备自动化验收信号'];
    case 'generator_capability':
      return ['可沉淀为模板/block/skill', '能被质量门确定性验证', '不会破坏既有 Demo 结构'];
    case 'manual_decision':
      return ['需要明确本期是否做', '需要定义验收边界', '需要业务负责人确认优先级'];
  }
}

function buildAcceptanceCriteria(category: RequirementCategory, text: string): string[] {
  const base = [
    `覆盖原始缺口：${text}`,
    '能被平台以结构化状态记录成功/失败/需人工确认',
  ];
  if (category === 'external_interface') {
    return [...base, '具备接口文档、鉴权方式、测试环境或 mock 响应', '接入失败时有可读错误与重试/降级策略'];
  }
  if (category === 'existing_tool_or_skill') {
    return [...base, '工具可由平台命令行/API 调用', '输出可被需求、规格、Demo 或验收链路消费'];
  }
  if (category === 'backend_capability') {
    return [...base, '后端资源、权限与数据表可自动置备', '上线门和 Guardian 能检测核心接口健康'];
  }
  if (category === 'generator_capability') {
    return [...base, '能力可复用为生成器模板、block 或 skill', '至少有一个回归测试证明再次生成可稳定产出'];
  }
  return [...base, '业务侧确认本期范围、优先级和验收口径'];
}

function buildIntegrationNotes(category: RequirementCategory, text: string): string[] {
  if (category === 'external_interface') {
    return ['先生成 mock adapter，待真实接口文档到位后替换实现', '将接口契约写入产品知识图谱，后续迭代按契约校验'];
  }
  if (category === 'existing_tool_or_skill') {
    return ['优先选择有活跃维护、明确许可证、可本地运行的项目', '接入后作为 Hermes 可编排节点，产物回写交付包'];
  }
  if (category === 'backend_capability') {
    return ['优先复用若依基础能力，前端只适配资源和权限状态', '将置备结果写入 backendRuntime，纳入交付包验收'];
  }
  if (category === 'generator_capability') {
    return ['沉淀为可测试的生成器能力，不直接依赖一次性 prompt', '补充传感器规则，确保后续生成结果能被门控拦住'];
  }
  return [`围绕“${titleFromRecommendation(text)}”补充业务决策记录`, '确认后再进入生成或外部匹配流程'];
}

function solutionRouteLabel(category: RequirementCategory, action: UnresolvedRequirementItem['action']): string {
  if (category === 'external_interface') return '外部接口/适配器对接';
  if (category === 'existing_tool_or_skill') return '匹配开源工具 / skill / 组件';
  if (category === 'backend_capability') return '平台后端或若依底座置备';
  if (category === 'generator_capability') return action === 'extend-generator' ? '扩展生成器能力块' : '补充生成器/自动化能力';
  return '人工范围与优先级决策';
}

function categoryLabel(category: RequirementCategory): string {
  switch (category) {
    case 'external_interface': return '外部接口';
    case 'existing_tool_or_skill': return '开源工具/skill';
    case 'backend_capability': return '后端能力';
    case 'generator_capability': return '生成器能力';
    case 'manual_decision': return '人工决策';
  }
}

function titleFromRecommendation(text: string): string {
  const cleaned = text
    .replace(/^.*?[:：]\s*/u, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > 38 ? `${cleaned.slice(0, 38)}...` : cleaned || '未命名缺口';
}

function defaultChannel(action: UnresolvedRequirementItem['action']): string {
  if (action === 'external-adapter') return 'gap-workflow';
  if (action === 'backend-provision') return 'provision';
  if (action === 'out-of-scope') return 'human';
  if (action === 'stuck-generator') return 'skill-market';
  return 'gap-workflow';
}

function defaultCustomerAction(category: RequirementCategory): string {
  if (category === 'external_interface') return '补充外部系统接口文档或选择适配器';
  if (category === 'existing_tool_or_skill') return '选择可接入的开源工具 / skill';
  if (category === 'backend_capability') return '进入平台后端能力置备';
  if (category === 'generator_capability') return '进入生成器能力建设排期';
  return '确认是否纳入本期范围';
}

function asGapAction(value: unknown): GapAction | null {
  const text = cleanText(value);
  if (['auto-iterate', 'extend-generator', 'external-adapter', 'backend-provision', 'out-of-scope'].includes(text)) {
    return text as GapAction;
  }
  return null;
}

function uniqueRecords(values: unknown[]): unknown[] {
  const seen = new Set<string>();
  const result: unknown[] = [];
  for (const value of values) {
    const record = asRecord(value);
    const text = cleanText(record.recommendation) || cleanText(value);
    const key = normalizeKey(text || JSON.stringify(value));
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
}

function asArray<T = unknown>(v: unknown): T[] {
  return Array.isArray(v) ? v as T[] : [];
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeKey(value: string): string {
  return value.replace(/\s+/g, '').replace(/[。；;,.，:：]/g, '').toLowerCase();
}

function toInt(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function escapeTable(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function escapeBackticks(value: string): string {
  return value.replace(/`/g, "'");
}
