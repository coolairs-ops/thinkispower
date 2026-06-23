import { renderShell, NavItem, esc } from './app-shell.template';

/** 后台能力开关：能力相关栏目按项目实际启用的能力出现，避免规则/知识库等无条件固化。 */
export interface AdminCaps {
  rules?: boolean;     // 启用规则引擎（有业务规则）→ 出「规则配置」
  knowledge?: boolean; // 启用知识库（功能/页面含知识库）→ 出「知识库管理」
}

/**
 * 后台侧栏（参考若依分层）：
 * - 通用恒在：业务数据 / 用户管理 / 角色权限 / 组织部门 / 操作审计 / 系统设置（任何政企后台都要）。
 * - 能力相关：规则配置 / 知识库管理，按 caps 条件出（不再无条件固化——规则/知识库不是每个项目都用）。
 * 删掉若依的系统监控/代码生成/表单构建（不交付）。
 */
export function buildAdminNav(active = 'data', caps: AdminCaps = {}): NavItem[] {
  const items: Omit<NavItem, 'active'>[] = [{ key: 'data', label: '业务数据', icon: 'database' }];
  if (caps.rules) items.push({ key: 'rules', label: '规则配置', icon: 'adjustments' });
  if (caps.knowledge) items.push({ key: 'knowledge', label: '知识库管理', icon: 'books' });
  items.push(
    { key: 'users', label: '用户管理', icon: 'users' },
    { key: 'roles', label: '角色权限', icon: 'lock-access' },
    { key: 'depts', label: '组织部门', icon: 'sitemap' },
    { key: 'audit', label: '操作审计', icon: 'history' },
    { key: 'settings', label: '系统设置', icon: 'settings' },
  );
  return items.map((n) => ({ ...n, active: n.key === active }));
}

/**
 * 从项目信号推断后台能力（无显式开关字段时的务实判定，纯函数）：
 * - rules：结构化需求里有业务规则（business-rule-completion 写入）。
 * - knowledge：方案的功能/页面名提到知识库（暂用关键字，接入正式能力开关后可替换）。
 */
export function deriveAdminCaps(structuredRequirement?: unknown, planSummary?: unknown): AdminCaps {
  const sr = structuredRequirement as { businessRules?: unknown } | null;
  const rules = Array.isArray(sr?.businessRules) && sr!.businessRules.length > 0;
  const ps = planSummary as { features?: unknown; pages?: unknown } | null;
  const names = [ps?.features, ps?.pages]
    .flatMap((arr) => (Array.isArray(arr) ? arr : []))
    .map((x) => (typeof x === 'string' ? x : String((x as { name?: string; label?: string })?.name ?? (x as { label?: string })?.label ?? '')))
    .join(' ');
  const knowledge = /知识库|知识|knowledge/i.test(names);
  return { rules, knowledge };
}

export interface AdminConfig {
  appName: string;
  org?: string;
  themeId?: string;
  user?: string;
  resource: string;
  resourceLabel: string;
  columns: { key: string; label: string; badge?: boolean }[];
  caps?: AdminCaps;
}

/** 后台业务数据列表（toolbar + appData 实时表格 + 行操作）。 */
function renderAdminList(cfg: AdminConfig): string {
  const thead = cfg.columns.map((c) => `<th>${esc(c.label)}</th>`).join('') + '<th style="width:80px">操作</th>';
  const j = JSON.stringify({ resource: cfg.resource, columns: cfg.columns.map((c) => c.key), badges: cfg.columns.map((c) => !!c.badge) }).replace(/</g, '\\u003c');
  return `<div class="h1">${esc(cfg.resourceLabel)}管理</div>
<div class="card"><div style="display:flex;justify-content:space-between;margin-bottom:12px">
<div style="display:flex;gap:8px"><input placeholder="搜索${esc(cfg.resourceLabel)}" style="height:32px;border:.5px solid var(--t-card-border);border-radius:8px;padding:0 10px;background:var(--t-card);color:var(--t-text);width:200px"/><button class="btn" style="height:32px"><i class="ti ti-search"></i> 查询</button></div>
<button class="btn" style="height:32px"><i class="ti ti-plus"></i> 新增</button></div>
<table><thead><tr>${thead}</tr></thead><tbody id="adm-rows"><tr><td colspan="${cfg.columns.length + 1}" class="muted">加载中…</td></tr></tbody></table></div>
<script>(function(){var C=${j};
function txt(v){return v==null?'':String(v).replace(/[&<>]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;'}[c];});}
function cell(v,b){if(b&&v!=null){var m={'D':'b-d','C':'b-c','B':'b-b','A':'b-a'},cls=m[String(v)]||'';return '<td>'+(cls?'<span class="badge '+cls+'">'+txt(v)+'</span>':txt(v))+'</td>';}return '<td>'+txt(v)+'</td>';}
if(!window.appData)return;
window.appData.list(C.resource,{pageSize:50}).then(function(r){var rows=(r&&r.items)||[],tb=document.getElementById('adm-rows');if(!tb)return;tb.innerHTML=rows.length?rows.map(function(row){return '<tr>'+C.columns.map(function(k,i){return cell(row[k],C.badges[i]);}).join('')+'<td><span style="color:var(--t-primary);cursor:pointer">编辑</span></td></tr>';}).join(''):'<tr><td colspan="'+(C.columns.length+1)+'" class="muted">暂无数据</td></tr>';}).catch(function(){});
})();</script>`;
}

/** 后台管理控制台：管理侧栏 + 业务数据列表。与前台同主题皮肤、不同导航与职责。 */
export function renderAdminApp(cfg: AdminConfig): string {
  return renderShell({
    appName: `${cfg.appName} · 管理后台`,
    org: cfg.org,
    themeId: cfg.themeId,
    user: cfg.user,
    nav: buildAdminNav('data', cfg.caps),
    contentHtml: renderAdminList(cfg),
  });
}
