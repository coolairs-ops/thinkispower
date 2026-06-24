import { AppSchema, Block, BlockType, Page } from './page-schema.types';
import { DataContract, contractPromptBlock } from '../app-contract';

/**
 * Schema 编排（Schema 驱动 S2）——把 LLM 产出规整成合法 AppSchema 的确定性校验门 + 兜底。
 *
 * 设计原则（ADR-0002「hard enforcement 靠校验器不靠提示词」）：零信任 LLM。
 * 模型只编排"哪页放哪些块、绑什么数据"，coerceSchema 把越界项（未知块类型 / 契约外资源
 * / 契约外字段）确定性丢弃；产物全废则退回 fallbackSchema（从契约确定性推默认页）。
 */

const BLOCK_TYPES: BlockType[] = ['kpi', 'table', 'detail', 'form', 'generate', 'qa', 'richtext'];
const GENERIC_TABLES = new Set(['user', 'users', 'account', 'accounts', 'auth', 'role', 'roles', 'permission', 'permissions', 'sysuser', 'session']);

const slug = (s: string, i: number): string =>
  String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || `p${i}`;

const clean = (o: Record<string, unknown>): Record<string, unknown> | undefined => {
  Object.keys(o).forEach((k) => o[k] === undefined && delete o[k]);
  return Object.keys(o).length ? o : undefined;
};

/** 资源名（小写）→契约资源（字段用契约原名）。 */
function resourceIndex(contract: DataContract): Map<string, { name: string; fields: string[] }> {
  const map = new Map<string, { name: string; fields: string[] }>();
  for (const r of contract.resources) map.set(r.name.toLowerCase(), r);
  return map;
}

function coerceProps(type: BlockType, props: Record<string, unknown>, fields: string[]): Record<string, unknown> | undefined {
  const s = (v: unknown): string | undefined => (v == null ? undefined : String(v));
  const title = s(props.title);
  switch (type) {
    case 'table': {
      const badges = Array.isArray(props.badges) ? props.badges.map(String).filter((f) => fields.includes(f)) : undefined;
      const rowActions = Array.isArray(props.rowActions) ? props.rowActions.map(String).slice(0, 4) : undefined;
      return clean({ title, badges: badges?.length ? badges : undefined, rowActions: rowActions?.length ? rowActions : undefined, searchable: props.searchable === true ? true : undefined });
    }
    case 'detail': return clean({ title });
    case 'form': return clean({ title, mode: props.mode === 'edit' ? 'edit' : undefined, submitLabel: s(props.submitLabel) });
    case 'generate': return clean({ title, inputField: s(props.inputField), inputLabel: s(props.inputLabel), button: s(props.button) });
    case 'qa': return clean({ title, placeholder: s(props.placeholder), escalateLabel: s(props.escalateLabel) });
    default: return undefined;
  }
}

function coerceBlock(b: unknown, idx: Map<string, { name: string; fields: string[] }>, dropped: string[], where: string): Block | null {
  const blk = b as { type?: unknown; bind?: unknown; props?: unknown };
  const type = blk?.type as BlockType;
  if (!BLOCK_TYPES.includes(type)) { dropped.push(`${where} 未知块类型「${String(blk?.type)}」`); return null; }
  const props = (blk.props && typeof blk.props === 'object') ? (blk.props as Record<string, unknown>) : {};

  if (type === 'richtext') return { type, props: { html: String((props.html as string) ?? '') } };

  const bind = blk.bind as { resource?: unknown; fields?: unknown } | undefined;
  const res = idx.get(String(bind?.resource ?? '').toLowerCase());
  if (!res) { dropped.push(`${where} 越界资源「${String(bind?.resource)}」`); return null; }

  let fields: string[];
  if (Array.isArray(bind?.fields)) {
    const allow = new Set(res.fields);
    const wanted = (bind!.fields as unknown[]).map(String);
    fields = wanted.filter((f) => allow.has(f));
    const off = wanted.filter((f) => !allow.has(f));
    if (off.length) dropped.push(`${where} 越界字段「${off.join('、')}」`);
    if (!fields.length) fields = res.fields.slice(0, 5);
  } else {
    fields = res.fields.slice(0, 5);
  }

  if (type === 'kpi') return { type, bind: { resource: res.name }, props: { label: String((props.label as string) || `${res.name} 总数`) } };
  // qa（问答/聊天）只绑资源（落上报、不需字段列表）
  if (type === 'qa') return { type, bind: { resource: res.name }, props: coerceProps('qa', props, fields) } as Block;
  return { type, bind: { resource: res.name, fields }, props: coerceProps(type, props, fields) } as Block;
}

function coerceNav(nav: unknown): { icon?: string; label?: string } | undefined {
  const n = nav as { icon?: unknown; label?: unknown } | undefined;
  if (!n || typeof n !== 'object') return undefined;
  return clean({ icon: n.icon == null ? undefined : String(n.icon), label: n.label == null ? undefined : String(n.label) }) as { icon?: string; label?: string } | undefined;
}

/**
 * LLM 产出 JSON → 合法 AppSchema（确定性校验门）。越界块/字段丢弃并记 dropped；
 * 无合法页 → schema=null（调用方兜底）。
 */
export function coerceSchema(raw: unknown, contract: DataContract): { schema: AppSchema | null; dropped: string[] } {
  const dropped: string[] = [];
  const root = raw as { appName?: unknown; pages?: unknown } | null;
  if (!root || typeof root !== 'object' || !Array.isArray(root.pages)) return { schema: null, dropped: ['根结构非法（无 pages 数组）'] };

  const idx = resourceIndex(contract);
  const pages: Page[] = [];
  (root.pages as unknown[]).forEach((p, pi) => {
    const pg = p as { key?: unknown; title?: unknown; nav?: unknown; blocks?: unknown };
    if (!pg || typeof pg !== 'object' || !Array.isArray(pg.blocks)) { dropped.push(`页${pi} 非法（无 blocks）`); return; }
    const blocks: Block[] = [];
    (pg.blocks as unknown[]).forEach((b, bi) => {
      const c = coerceBlock(b, idx, dropped, `页${pi}块${bi}`);
      if (c) blocks.push(c);
    });
    if (!blocks.length) { dropped.push(`页${pi} 无合法块`); return; }
    const title = String((pg.title as string) || `页面${pi + 1}`).slice(0, 20);
    pages.push({ key: slug((pg.key as string) || title, pi), title, nav: coerceNav(pg.nav), blocks });
  });

  if (!pages.length) return { schema: null, dropped };
  return { schema: { appName: String((root.appName as string) || '应用').slice(0, 30), pages }, dropped };
}

/** 无 LLM/产物全废时的确定性兜底：主业务资源出工作台(KPI+列表)，其余资源各一列表页。 */
export function fallbackSchema(appName: string, contract: DataContract): AppSchema {
  const biz = contract.resources.filter((r) => !GENERIC_TABLES.has(r.name.toLowerCase()));
  const list = biz.length ? biz : contract.resources;
  if (!list.length) {
    return { appName, pages: [{ key: 'home', title: '工作台', nav: { icon: 'layout-dashboard', label: '工作台' }, blocks: [{ type: 'richtext', props: { html: '<div class="muted">暂无数据模型</div>' } }] }] };
  }
  const primary = list[0];
  const pages: Page[] = [{
    key: 'dashboard', title: '工作台', nav: { icon: 'layout-dashboard', label: '工作台' },
    blocks: [
      { type: 'kpi', bind: { resource: primary.name }, props: { label: `${primary.name} 总数` } },
      { type: 'table', bind: { resource: primary.name, fields: primary.fields.slice(0, 4) }, props: { title: primary.name, searchable: true, rowActions: ['查看'] } },
    ],
  }];
  for (const r of list.slice(1, 6)) {
    pages.push({
      key: slug(r.name, pages.length), title: r.name, nav: { icon: 'database', label: r.name },
      blocks: [{ type: 'table', bind: { resource: r.name, fields: r.fields.slice(0, 4) }, props: { title: r.name, searchable: true, rowActions: ['查看'] } }],
    });
  }
  return { appName, pages };
}

/** 从 LLM 回复抽 JSON（去 ```json 围栏；失败再截首尾大括号）。 */
export function extractJson(text: string): unknown {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : text;
  try { return JSON.parse(body.trim()); } catch { /* fallthrough */ }
  const s = body.indexOf('{'), e = body.lastIndexOf('}');
  if (s >= 0 && e > s) { try { return JSON.parse(body.slice(s, e + 1)); } catch { /* give up */ } }
  return null;
}

/** 组件库 + 硬约束规格（compose/revise 共用，避免提示词漂移）。 */
const BLOCK_LIBRARY = [
  'AppSchema 形状：{ "appName": string, "pages": [ { "key": string, "title": string, "nav": {"icon","label"}, "blocks": [Block] } ] }',
  'Block 只能是下列组件库类型之一，bind/props 形状如下：',
  '- kpi：单指标卡。{ "type":"kpi", "bind":{"resource"}, "props":{"label"} }',
  '- table：数据列表。{ "type":"table", "bind":{"resource","fields"}, "props":{"title","searchable":bool,"rowActions":[],"badges":[]} }',
  '- detail：单条详情。{ "type":"detail", "bind":{"resource","fields"}, "props":{"title"} }',
  '- form：录入/编辑表单。{ "type":"form", "bind":{"resource","fields"}, "props":{"title","submitLabel"} }',
  '- generate：输入→生成并保存。{ "type":"generate", "bind":{"resource","fields"}, "props":{"title","inputLabel","button"} }',
  '- qa：问答/聊天交互界面（客服咨询/智能问答/自动回复场景用）。发送→自动回复，未知问题可上报人工。{ "type":"qa", "bind":{"resource"}, "props":{"title","placeholder","escalateLabel"} } —— resource 取存放咨询/上报记录的资源。',
  '- richtext：说明性 HTML。{ "type":"richtext", "props":{"html"} }',
  '硬约束：bind.resource 只能取数据契约里的资源名；fields 只能取该资源列出的字段。禁止臆造资源/字段。',
  'tabler 图标名填 nav.icon（如 layout-dashboard/users/login/books）。每页 2~5 个块，贴合该页职责。',
].join('\n');

/** 组件库 + 数据契约 → LLM 编排 prompt（先验约束：块类型只能取库、bind 只能取契约）。 */
export function buildComposePrompt(appName: string, pageLabels: string[], features: string[], contract: DataContract): { system: string; user: string } {
  const system = '你是政企应用的「页面结构编排器」。只输出一个 JSON 对象（AppSchema），不要 markdown 之外的任何解释。\n' + BLOCK_LIBRARY;
  const user = [
    `## 应用\n${appName}`,
    pageLabels.length ? `## 期望页面\n${pageLabels.join('、')}` : '',
    features.length ? `## 功能\n${features.join('、')}` : '',
    contractPromptBlock(contract) || '## 数据契约\n（无，尽量用 richtext 说明）',
    '按上述编排出 AppSchema JSON。',
  ].filter(Boolean).join('\n\n');
  return { system, user };
}

/** 修订 prompt（S5 自迭代用）：据传感器建议改现有 schema，保留合理部分、只改问题、不臆造。 */
export function buildRevisePrompt(current: AppSchema, recommendations: string[], contract: DataContract): { system: string; user: string } {
  const system = '你在**修订**一份现有页面 schema（AppSchema）。只输出修订后的完整 JSON 对象，不要任何解释。\n'
    + '据修复建议改进它：保留合理的页/块，只针对建议指出的问题增删改块或调整 bind/props，不要推倒重来、不要臆造资源/字段。\n'
    + BLOCK_LIBRARY;
  const user = [
    '## 当前 schema\n```json\n' + JSON.stringify({ appName: current.appName, pages: current.pages }) + '\n```',
    '## 修复建议（逐条尽量落实）\n' + recommendations.map((r, i) => `${i + 1}. ${r}`).join('\n'),
    contractPromptBlock(contract) || '## 数据契约\n（无）',
    '输出修订后的完整 AppSchema JSON。',
  ].join('\n\n');
  return { system, user };
}
