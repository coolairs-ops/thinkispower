export interface InterviewAnswer {
  question: string;
  answer: string;
}

export interface UpliftRole {
  role: string;
  description: string;
  permissions: string[];
}

export interface UpliftFunction {
  name: string;
  description: string;
  priority: 'must' | 'nice' | 'later';
}

export interface UpliftPage {
  name: string;
  route: string;
  description: string;
}

export interface UpliftDataModel {
  name: string;
  fields: { name: string; type: string; required: boolean }[];
}

export interface UpliftBusinessRule {
  name: string;
  description: string;
  trigger: string;
  outcome: string;
}

export interface UpliftAcceptanceScenario {
  name: string;
  given: string;
  when: string;
  then: string;
  priority: 'must' | 'nice';
}

export interface RequirementUplift {
  summary: string;
  targetUsers: { role: string; description: string }[];
  coreFunctions: UpliftFunction[];
  pages: UpliftPage[];
  roles: UpliftRole[];
  dataObjects: string[];
  dataModels: UpliftDataModel[];
  businessRules: UpliftBusinessRule[];
  acceptanceScenarios: UpliftAcceptanceScenario[];
  outOfScope: { name: string; reason: string }[];
  primaryRisks: { name: string; severity: 'high' | 'medium' | 'low'; description: string }[];
  prd: Record<string, unknown>;
  signals: string[];
  missingSlots: string[];
}

export function buildRequirementUplift(
  answers: InterviewAnswer[],
  opts: { projectName?: string } = {},
): RequirementUplift {
  const cleaned = answers
    .map((a) => ({ question: clean(a.question), answer: clean(a.answer) }))
    .filter((a) => a.question && a.answer && !/^待完善$/.test(a.answer));
  const fullText = cleaned.map((a) => `${a.question} ${a.answer}`).join('\n');
  const answerOf = (keyword: RegExp) => cleaned.find((a) => keyword.test(a.question))?.answer ?? '';
  const signals = detectSignals(fullText);

  const roles = buildRoles(fullText);
  const coreFunctions = buildFunctions(fullText);
  const dataObjects = buildDataObjects(fullText);
  const dataModels = dataObjects.map(toDataModel);
  const pages = buildPages(fullText);
  const businessRules = buildBusinessRules(fullText);
  const acceptanceScenarios = buildAcceptanceScenarios(fullText);
  const outOfScope = buildOutOfScope(cleaned);
  const primaryRisks = buildRisks(cleaned, fullText);
  const summary = answerOf(/一句话描述|做什么/u) || `${opts.projectName || '系统'}需求`;

  const targetUsers = roles.map((r) => ({ role: r.role, description: r.description }));
  const prd = {
    productName: opts.projectName || cleaned[0]?.answer || '未命名项目',
    summary,
    background: answerOf(/为什么|痛点|信念|让你想做/u),
    targetUsers: targetUsers.map((u) => `${u.role} — ${u.description}`),
    userPainPoints: compact([
      answerOf(/痛点|信念|让你想做/u),
      answerOf(/受不了/u),
    ]),
    useScenarios: compact([
      answerOf(/第一个要完成|从头到尾|第一次打开/u),
      answerOf(/验证|验收/u),
    ]),
    coreValue: answerOf(/完美|不同的感受/u),
    productForm: answerOf(/电脑|手机|平台/u) || 'Web 应用',
    mvpScope: coreFunctions.filter((f) => f.priority === 'must').map((f) => f.name),
    successCriteria: acceptanceScenarios.map((s) => `${s.name}: ${s.then}`),
    pages: pages.map((p) => `${p.name} — ${p.description}`),
    features: coreFunctions.map((f) => `${f.name}${f.priority === 'must' ? '' : '（可选）'}`),
    roles: roles.map((r) => `${r.role}: ${r.permissions.join('、')}`),
    dataObjects,
    riskPoints: primaryRisks.map((r) => r.description),
  };

  const missingSlots = [
    roles.length ? '' : 'roles',
    coreFunctions.length ? '' : 'coreFunctions',
    dataModels.length ? '' : 'dataModels',
    businessRules.length ? '' : 'businessRules',
    acceptanceScenarios.length ? '' : 'acceptanceScenarios',
  ].filter(Boolean);

  return {
    summary,
    targetUsers,
    coreFunctions,
    pages,
    roles,
    dataObjects,
    dataModels,
    businessRules,
    acceptanceScenarios,
    outOfScope,
    primaryRisks,
    prd,
    signals,
    missingSlots,
  };
}

export function mergeRequirementUplift(
  input: unknown,
  uplift: RequirementUplift,
  opts: { projectName?: string } = {},
): Record<string, unknown> {
  const sr = isRecord(input) ? { ...input } : {};
  const oldPrd = isRecord(sr.prd) ? sr.prd : {};
  const oldPrdSummary = typeof sr.prd === 'string' ? sr.prd : clean(oldPrd.summary);

  sr.targetUsers = mergeByKey(asArray(sr.targetUsers), uplift.targetUsers, 'role');
  sr.coreFunctions = mergeByKey(asArray(sr.coreFunctions), uplift.coreFunctions, 'name');
  sr.pages = mergeByKey(asArray(sr.pages), uplift.pages, 'name');
  sr.roles = mergeByKey(asArray(sr.roles), uplift.roles, 'role', 'name');
  sr.dataObjects = unionStrings(asStringArray(sr.dataObjects), uplift.dataObjects);
  sr.dataModels = mergeByKey(asArray(sr.dataModels), uplift.dataModels, 'name');
  sr.businessRules = mergeByKey(asArray(sr.businessRules), uplift.businessRules, 'name');
  sr.acceptanceScenarios = mergeByKey(asArray(sr.acceptanceScenarios), uplift.acceptanceScenarios, 'name');
  sr.outOfScope = mergeByKey(asArray(sr.outOfScope), uplift.outOfScope, 'name');
  sr.primaryRisks = mergeByKey(asArray(sr.primaryRisks), uplift.primaryRisks, 'name');

  const mergedPrd = {
    ...oldPrd,
    ...uplift.prd,
    productName: clean(oldPrd.productName) || opts.projectName || clean(uplift.prd.productName) || '未命名项目',
    summary: oldPrdSummary || clean(uplift.prd.summary),
    targetUsers: preferNonEmptyStringArray(oldPrd.targetUsers, uplift.prd.targetUsers),
    userPainPoints: preferNonEmptyStringArray(oldPrd.userPainPoints, uplift.prd.userPainPoints),
    useScenarios: preferNonEmptyStringArray(oldPrd.useScenarios, uplift.prd.useScenarios),
    mvpScope: preferNonEmptyStringArray(oldPrd.mvpScope, uplift.prd.mvpScope),
    successCriteria: preferNonEmptyStringArray(oldPrd.successCriteria, uplift.prd.successCriteria),
    pages: preferNonEmptyStringArray(oldPrd.pages, uplift.prd.pages),
    features: preferNonEmptyStringArray(oldPrd.features, uplift.prd.features),
    roles: preferNonEmptyStringArray(oldPrd.roles, uplift.prd.roles),
    dataObjects: preferNonEmptyStringArray(oldPrd.dataObjects, uplift.prd.dataObjects),
    riskPoints: preferNonEmptyStringArray(oldPrd.riskPoints, uplift.prd.riskPoints),
  };
  sr.prd = mergedPrd;

  sr.requirementUplift = {
    source: 'deterministic_interview_uplift',
    generatedAt: new Date().toISOString(),
    signals: uplift.signals,
    missingSlots: uplift.missingSlots,
    counts: {
      roles: asArray(sr.roles).length,
      coreFunctions: asArray(sr.coreFunctions).length,
      dataModels: asArray(sr.dataModels).length,
      businessRules: asArray(sr.businessRules).length,
      acceptanceScenarios: asArray(sr.acceptanceScenarios).length,
    },
  };
  return sr;
}

export function buildPlanSeedFromRequirement(sr: unknown) {
  const record = isRecord(sr) ? sr : {};
  const prd = isRecord(record.prd) ? record.prd : {};
  return {
    summary: clean(prd.summary) || clean(record.summary) || clean(prd.productName) || '业务系统',
    pages: preferNonEmptyStringArray(prd.pages, asArray(record.pages).map(labelOf)),
    features: preferNonEmptyStringArray(prd.features, asArray(record.coreFunctions).map(labelOf)),
    roles: preferNonEmptyStringArray(prd.roles, asArray(record.roles).map(labelOf)),
    dataObjects: preferNonEmptyStringArray(prd.dataObjects, record.dataObjects),
    acceptanceChecklist: preferNonEmptyStringArray(prd.acceptanceChecklist, preferNonEmptyStringArray(prd.successCriteria, asArray(record.acceptanceScenarios).map(labelOf))),
  };
}

function detectSignals(text: string): string[] {
  const rules: Array<[string, RegExp]> = [
    ['auth', /登录|账号|权限|角色|多用户|管理员|SSO|认证/u],
    ['intelligent-query', /问数|自然语言|对话框|组合查询|查询|计算|分析|指标|口径/u],
    ['data-integration', /接口|对接|接进来|同步|外部系统|财务软件|ERP|风险分析/u],
    ['document-knowledge', /PDF|pdf|Excel|excel|xlsx|文档|结构化|知识库|上传|散落/u],
    ['dashboard', /看板|统计|一眼|呈现|图表|报表/u],
    ['local-offline', /本地|离线|私有化/u],
    ['finance', /财务|凭证|科目|报销|付款|发票|经营/u],
  ];
  return rules.filter(([, re]) => re.test(text)).map(([key]) => key);
}

function buildRoles(text: string): UpliftRole[] {
  const roles: UpliftRole[] = [];
  if (/董事长|领导|管理层|经理|负责人/u.test(text)) {
    roles.push({ role: '领导用户', description: '基于权限查看经营和财务分析结果的人', permissions: ['智能问数', '查看授权范围内的数据分析', '查看看板'] });
  }
  if (/财务|会计|出纳/u.test(text)) {
    roles.push({ role: '财务人员', description: '负责上传、维护和校验财务数据的人', permissions: ['上传财务数据', '维护数据源', '校验结构化结果'] });
  }
  if (/信息中心|系统管理员|管理员|IT/u.test(text)) {
    roles.push({ role: '信息中心管理员', description: '负责系统配置、账号权限和接口接入的人', permissions: ['账号权限管理', '系统配置', '接口配置'] });
  }
  if (/普通用户|员工|部门/u.test(text)) {
    roles.push({ role: '部门用户', description: '在授权范围内查询业务数据的人', permissions: ['提交查询', '查看本人或本部门数据'] });
  }
  if (roles.length === 0 && /给.+用|谁会用|用户/u.test(text)) {
    roles.push({ role: '业务用户', description: '使用系统完成核心业务任务的人', permissions: ['使用核心功能', '查看授权数据'] });
  }
  if (roles.length === 0) {
    roles.push({ role: '管理员', description: '负责系统初始化和日常管理的人', permissions: ['系统管理', '数据维护'] });
  }
  return uniqueBy(roles, (r) => r.role);
}

function buildFunctions(text: string): UpliftFunction[] {
  const features: UpliftFunction[] = [];
  if (/登录|账号|权限|角色|多用户/u.test(text)) features.push(feature('账号登录与权限控制', '用户用自己的账号登录，并按角色获得不同数据和功能权限'));
  if (/问数|自然语言|对话框|组合查询|查询|问题|计算|分析|呈现/u.test(text)) features.push(feature('智能问数', '用户通过对话输入问题，系统组合多源数据并返回分析结果'));
  if (/接口|对接|接进来|同步|外部系统|财务软件|ERP/u.test(text)) features.push(feature('多源系统数据接入', '通过接口接入已有业务系统中的结构化数据'));
  if (/PDF|pdf|Excel|excel|xlsx|文档|结构化|知识库|上传|散落/u.test(text)) features.push(feature('文档结构化与知识库沉淀', '把 PDF、Excel 和文档中的数据结构化，并沉淀到本地知识库'));
  if (/看板|统计|一眼|图表|报表/u.test(text)) features.push(feature('财务数据看板', '展示核心统计信息、指标趋势和关键数据概览'));
  if (/风险分析/u.test(text)) features.push(feature('企业风险分析软件对接', '预留与企业风险分析软件的数据接口和结果展示能力', 'nice'));
  if (/离线|本地/u.test(text)) features.push(feature('本地化与离线可用', '核心数据和知识库可在本地环境运行，支持离线使用约束'));
  if (features.length === 0) features.push(feature('核心业务管理', '支撑用户完成第一版核心业务流程'));
  return uniqueBy(features, (f) => f.name);
}

function buildDataObjects(text: string): string[] {
  const objects: string[] = [];
  if (/财务|经营|科目|凭证|金额|报表/u.test(text)) objects.push('财务数据', '财务指标');
  if (/PDF|pdf|Excel|excel|xlsx|文档|附件|上传/u.test(text)) objects.push('财务文档', '结构化文档数据');
  if (/知识库|结构化|散落/u.test(text)) objects.push('知识库条目');
  if (/接口|对接|接进来|同步|外部系统|财务软件|ERP/u.test(text)) objects.push('外部数据源', '接口同步任务');
  if (/问数|查询|问题|对话/u.test(text)) objects.push('问数记录', '查询结果');
  if (/权限|角色|账号|登录|多用户/u.test(text)) objects.push('用户账号', '角色权限');
  if (/风险分析/u.test(text)) objects.push('风险分析结果');
  if (objects.length === 0) objects.push('业务数据', '用户账号');
  return uniqueStrings(objects);
}

function buildPages(text: string): UpliftPage[] {
  const pages: UpliftPage[] = [];
  if (/登录|账号/u.test(text)) pages.push(page('登录页', '/login', '用户账号登录入口'));
  if (/问数|对话框|查询|问题/u.test(text)) pages.push(page('智能问数工作台', '/analytics-query', '用户输入问题并查看分析结果'));
  if (/看板|统计|财务/u.test(text)) pages.push(page('财务数据看板', '/dashboard', '展示财务统计信息和关键指标'));
  if (/接口|对接|同步|外部系统/u.test(text)) pages.push(page('数据源管理', '/data-sources', '配置外部系统接口和同步状态'));
  if (/PDF|pdf|Excel|excel|文档|知识库|结构化/u.test(text)) pages.push(page('文档结构化与知识库', '/knowledge-ingestion', '上传文档并查看结构化入库结果'));
  if (/权限|角色|多用户|管理员/u.test(text)) pages.push(page('权限管理', '/access-control', '维护角色、账号和数据权限'));
  if (pages.length === 0) pages.push(page('首页看板', '/dashboard', '展示核心业务概览'), page('业务数据页', '/data', '管理核心业务数据'));
  return uniqueBy(pages, (p) => p.name);
}

function buildBusinessRules(text: string): UpliftBusinessRule[] {
  const rules: UpliftBusinessRule[] = [];
  if (/权限|角色|账号|登录|多用户|领导|财务|信息中心/u.test(text)) {
    rules.push(rule('角色数据权限规则', '不同角色只能访问其授权范围内的数据和功能', '用户登录并访问数据或功能时', '系统按角色和数据范围过滤结果'));
  }
  if (/问数|查询|问题|计算|分析|呈现/u.test(text)) {
    rules.push(rule('问数结果一致性规则', '回答必须与用户问题、数据权限和可用数据源一致', '用户提交问数请求时', '系统返回可解释、可追溯的数据分析结果'));
  }
  if (/接口|对接|接进来|同步|外部系统|财务软件/u.test(text)) {
    rules.push(rule('外部数据接入规则', '外部接口数据需要记录来源、同步状态和失败原因', '系统执行接口同步时', '成功数据入库，失败数据进入待处理状态'));
  }
  if (/PDF|pdf|Excel|excel|文档|结构化|知识库|上传/u.test(text)) {
    rules.push(rule('文档结构化入库规则', '文档抽取结果必须保留来源文件和结构化状态', '财务人员上传文档时', '系统抽取结构化数据并写入知识库'));
  }
  if (/本地|离线/u.test(text)) {
    rules.push(rule('本地化运行规则', '本地数据和知识库不得依赖公网服务才能完成核心查询', '系统处于离线或内网环境时', '核心数据查询和已入库知识仍可使用'));
  }
  if (/数据.*对不上|失去信任|处理不好|接不进来/u.test(text)) {
    rules.push(rule('可信结果校验规则', '数据接入、结构化和呈现出现异常时必须显式提示', '系统发现数据缺失、来源异常或结果不匹配时', '系统阻止静默成功并提示需人工核验'));
  }
  if (rules.length === 0) rules.push(rule('基础数据有效性规则', '核心数据必须完整、可查看、可追溯', '用户新增或查询业务数据时', '系统校验数据完整性并记录操作结果'));
  return uniqueBy(rules, (r) => r.name);
}

function buildAcceptanceScenarios(text: string): UpliftAcceptanceScenario[] {
  const scenarios: UpliftAcceptanceScenario[] = [];
  if (/登录|权限|角色|多用户/u.test(text)) scenarios.push(scenario('不同角色登录验收', '已创建领导、财务和管理员账号', '分别登录系统', '各角色只能看到其授权菜单和数据'));
  if (/问数|查询|问题|组合|计算|分析/u.test(text)) scenarios.push(scenario('智能问数验收', '已接入样例财务数据且用户已登录', '用户输入一个组合查询问题', '系统返回与问题匹配的计算结果和数据来源'));
  if (/接口|对接|接进来|同步|外部系统|财务软件/u.test(text)) scenarios.push(scenario('外部数据接入验收', '已配置一个外部系统 mock 接口', '执行数据同步', '系统成功接入数据并展示同步状态'));
  if (/PDF|pdf|Excel|excel|文档|结构化|知识库|上传/u.test(text)) scenarios.push(scenario('文档结构化验收', '准备一份 PDF/Excel/文档样例', '上传并执行结构化', '系统抽取关键财务数据并写入知识库'));
  if (/看板|统计|财务/u.test(text)) scenarios.push(scenario('财务看板验收', '系统已有样例财务数据', '用户打开首页看板', '系统展示关键财务统计信息'));
  if (/问几个问题|验证/u.test(text)) scenarios.push(scenario('业务问题验证验收', '系统已完成样例数据接入和文档入库', '用户连续提问 3 个业务问题', '系统均返回可解释、可追溯的答案'));
  if (scenarios.length === 0) scenarios.push(scenario('核心流程验收', '用户已登录系统', '执行第一版核心业务流程', '系统完成操作并记录结果'));
  return uniqueBy(scenarios, (s) => s.name);
}

function buildOutOfScope(answers: InterviewAnswer[]) {
  const answer = answers.find((a) => /以后再做|很酷/u.test(a.question))?.answer;
  if (!answer || /^无|没有|暂无$/u.test(answer)) return [];
  return splitItems(answer).map((name) => ({ name, reason: '用户明确为后续范围' }));
}

function buildRisks(answers: InterviewAnswer[], text: string) {
  const explicit = answers.find((a) => /失去信任|出错/u.test(a.question))?.answer;
  const risks = splitItems(explicit || '');
  if (/数据.*对不上|接不进来|处理不好/u.test(text) && risks.length === 0) risks.push('数据呈现与问题不匹配、数据接入失败或文档处理不准确');
  return (risks.length ? risks : ['核心数据不完整会影响用户信任']).map((description) => ({
    name: titleOf(description),
    severity: 'high' as const,
    description,
  }));
}

function toDataModel(name: string): UpliftDataModel {
  const base = [
    { name: 'id', type: 'string', required: true },
    { name: 'name', type: 'string', required: true },
    { name: 'status', type: 'string', required: false },
    { name: 'createdAt', type: 'datetime', required: true },
  ];
  if (/财务数据|财务指标/u.test(name)) return { name, fields: [...base, { name: 'period', type: 'string', required: false }, { name: 'amount', type: 'decimal', required: false }, { name: 'source', type: 'string', required: true }] };
  if (/文档|知识库/u.test(name)) return { name, fields: [...base, { name: 'fileName', type: 'string', required: true }, { name: 'content', type: 'text', required: false }, { name: 'sourcePath', type: 'string', required: false }] };
  if (/接口|数据源|同步/u.test(name)) return { name, fields: [...base, { name: 'endpoint', type: 'string', required: false }, { name: 'lastSyncAt', type: 'datetime', required: false }] };
  if (/问数|查询/u.test(name)) return { name, fields: [...base, { name: 'question', type: 'text', required: true }, { name: 'answer', type: 'text', required: false }] };
  return { name, fields: base };
}

function feature(name: string, description: string, priority: 'must' | 'nice' | 'later' = 'must'): UpliftFunction {
  return { name, description, priority };
}

function page(name: string, route: string, description: string): UpliftPage {
  return { name, route, description };
}

function rule(name: string, description: string, trigger: string, outcome: string): UpliftBusinessRule {
  return { name, description, trigger, outcome };
}

function scenario(name: string, given: string, when: string, then: string): UpliftAcceptanceScenario {
  return { name, given, when, then, priority: 'must' };
}

function splitItems(text: string): string[] {
  return clean(text).split(/[、，,；;。\n]/u).map(clean).filter(Boolean).filter((x) => x.length > 1);
}

function titleOf(text: string): string {
  return clean(text).slice(0, 18) || '风险';
}

function labelOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (isRecord(value)) return clean(value.name) || clean(value.role) || clean(value.title) || '';
  return '';
}

function mergeByKey(existing: unknown[], incoming: unknown[], key: string, altKey?: string): Record<string, unknown>[] {
  const map = new Map<string, Record<string, unknown>>();
  for (const item of [...existing, ...incoming]) {
    if (!isRecord(item)) continue;
    const k = normalizeKey(clean(item[key]) || (altKey ? clean(item[altKey]) : ''));
    if (!k) continue;
    if (!map.has(k)) map.set(k, item);
  }
  return [...map.values()];
}

function uniqueBy<T>(items: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = normalizeKey(keyFn(item));
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function preferNonEmptyStringArray(primary: unknown, fallback: unknown): string[] {
  const p = asStringArray(primary);
  return p.length ? p : asStringArray(fallback);
}

function unionStrings(a: string[], b: string[]): string[] {
  return uniqueStrings([...a, ...b]);
}

function uniqueStrings(items: string[]): string[] {
  return [...new Set(items.map(clean).filter(Boolean))];
}

function compact(items: string[]): string[] {
  return items.map(clean).filter(Boolean);
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => labelOf(item)).filter(Boolean);
}

function asArray<T = Record<string, unknown>>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeKey(value: string): string {
  return value.replace(/\s+/g, '').replace(/[：:—–\-（）()]/g, '').toLowerCase();
}
